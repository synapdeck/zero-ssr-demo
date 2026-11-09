// Compares hydrationClone off and on with real Postgres, zero-cache and
// Chromium. See README.md. Everything it starts is stopped when it finishes.
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {chromium, type Browser} from 'playwright';
import {PAGES, type PageName} from '../src/app/schema.ts';
import {report, type BurstResult, type PageResult} from './report.ts';
import {
  BUILD,
  log,
  ok,
  PORTS,
  keepLog,
  removeReplica,
  sleep,
  start,
  startCache,
  startPostgres,
  stop,
  stopAll,
  stopPostgres,
  waitFor,
  zeroLog,
  type Sql,
} from './services.ts';

const {values: args} = parseArgs({
  options: {
    'issues': {type: 'string', default: '500000'},
    'visits': {type: 'string', default: '5'},
    'workers': {type: 'string', default: '4'},
    'verify': {type: 'boolean', default: false},
    'burst': {type: 'string', default: '0'},
    'burst-runs': {type: 'string', default: '1'},
    'verify-rounds': {type: 'string', default: '3'},
    'verify-mode': {type: 'string', default: 'on'},
    'ssr-zero': {type: 'string', default: 'pool'},
  },
});
const ISSUES = Number(args.issues);
const VISITS = Number(args.visits);
const WORKERS = Number(args.workers);
const BURST = Number(args.burst);
const BURST_RUNS = Number(args['burst-runs']);
const USERS = ['alice', 'other1', 'other2', 'other3', 'other4'];
// How long a client group's view syncer outlives its last connection. Visits
// wait this long so that each browser is placed like a new user's, not on a
// crowded worker full of groups that have just left.
const KEEPALIVE_MS = 6000;

const median = (v: number[]) => {
  const s = v.toSorted((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};

type Hydration = {hash: string; ms: number; rowsRead: number};

const HYDRATE_EVENT =
  /\[\s*'pid=(?:(?!\]\s).)*?'zeroEvent=query-pipeline-hydrate-finish'(?:(?!\]\s).)*?\]/gs;
const EVENT_FIELD = /'(\w+)=([^']*)'/g;

/** Every hydration zero-cache logged, in order. */
function hydrations(): Hydration[] {
  return Array.from(zeroLog().matchAll(HYDRATE_EVENT), ([block]) => {
    const f = Object.fromEntries(
      Array.from(block.matchAll(EVENT_FIELD), m => [m[1], m[2]]),
    );
    return {
      hash: f['queryHash'],
      ms: Number(f['hydrationTimeMs']),
      rowsRead: Number(f['hydrationRowsRead']),
    };
  });
}

/** The hash zero-cache uses for each named query, from the CVR. */
async function queryHashes(sql: Sql): Promise<Record<string, string>> {
  const rows = await sql<{queryName: string; queryHash: string}[]>`
    select distinct "queryName", "queryHash" from "zero_0/cvr".queries
    where "queryName" is not null`;
  return Object.fromEntries(rows.map(r => [r.queryName, r.queryHash]));
}

/** A write that has to reach the page if its view is really live. */
const LIVE_WRITES: Record<
  PageName,
  (sql: Sql, id: string) => Promise<unknown>
> = {
  search: (sql, id) =>
    sql`insert into comment values (${id},'i5',${'needle ' + id})`,
  list: (sql, id) => sql`insert into issue values (${id},'live','alice',-1000)`,
  thread: (sql, id) =>
    sql`insert into comment values (${id},'i5','thread live')`,
  total: (sql, id) =>
    sql`insert into comment values (${id},'i10',${'needle ' + id})`,
};

const pageURL = (page: PageName, user = 'alice') =>
  `http://127.0.0.1:${PORTS.ssr}/?page=${page}&user=${user}`;

async function startSSR() {
  const ssr = start('node', ['dist/server/ssr-server.js'], {
    SSR_PORT: String(PORTS.ssr),
    CACHE_PORT: String(PORTS.cache),
    SSR_ZERO: args['ssr-zero'],
  });
  await waitFor('ssr server', () =>
    ok(`http://127.0.0.1:${PORTS.ssr}/browser.js`),
  );
  return ssr;
}

async function visit(browser: Browser, sql: Sql, page: PageName, n: number) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  const pageErrors: string[] = [];
  tab.on('pageerror', e => pageErrors.push(e.message));
  const response = await tab.goto(pageURL(page), {waitUntil: 'load'});
  if (!response?.ok()) {
    throw new Error(`${page}: ${response?.status()} ${await response?.text()}`);
  }
  await tab.waitForFunction(() => window.__liveAtMs !== undefined, undefined, {
    timeout: 30_000,
  });
  const before = await tab.evaluate(() => window.__trace.at(-1));
  const id = `live${page}${n}${Date.now()}`;
  await LIVE_WRITES[page](sql, id);
  const live = await tab
    .waitForFunction(b => window.__trace.at(-1) !== b, before, {timeout: 5000})
    .then(
      () => true,
      () => false,
    );
  const seen = await tab.evaluate(() => ({
    liveAtMs: window.__liveAtMs ?? NaN,
    trace: window.__trace,
    recoverableErrors: window.__recoverableErrors,
  }));
  await sql`delete from comment where id=${id}`;
  await sql`delete from issue where id=${id}`;
  await context.close();
  return {
    renderMs: Number(response.headers()['x-render-ms']),
    liveAtMs: seen.liveAtMs,
    flashed: seen.trace.includes('(empty)') || seen.trace.includes('loading'),
    errors: seen.recoverableErrors.length + pageErrors.length,
    live,
  };
}

async function runMode(mode: 'off' | 'on', browser: Browser, sql: Sql) {
  log(`hydrationClone=${mode}: starting`);
  await startCache(pgURL, mode, WORKERS);
  const ssr = await startSSR();
  const pages = {} as Record<PageName, Awaited<ReturnType<typeof visit>>[]>;
  for (const page of PAGES) {
    pages[page] = [];
    for (let i = 0; i < VISITS; i++) {
      pages[page].push(await visit(browser, sql, page, i));
      await sleep(KEEPALIVE_MS);
    }
    log(`hydrationClone=${mode}: ${page} done`);
  }
  const hashes = await queryHashes(sql);
  const events = hydrations();
  keepLog(`visits-${mode}`);
  await stop(ssr);
  const summary = {} as Record<PageName, PageResult>;
  for (const page of PAGES) {
    const visits = pages[page];
    // The first hydration is the server's own: there is nothing to copy from yet.
    const ours = events.filter(e => e.hash === hashes[page]).slice(1);
    summary[page] = {
      firstRenderMs: visits[0].renderMs,
      laterRenderMs: median(visits.slice(1).map(v => v.renderMs)),
      browserLiveMs: median(visits.map(v => v.liveAtMs)),
      hydrationMs: median(ours.map(e => e.ms)),
      rowsRead: median(ours.map(e => e.rowsRead)),
      flashes: visits.filter(v => v.flashed).length,
      errors: visits.reduce((n, v) => n + v.errors, 0),
      liveUpdates: `${visits.filter(v => v.live).length}/${visits.length}`,
    };
  }
  return summary;
}

/**
 * Browsers arriving together and staying connected, unlike the spaced-out
 * visits above, so that groups pile up on a worker. A hydration that read far
 * less than the server's own was copied.
 */
let burstCount = 0;

async function runBurst(
  mode: 'off' | 'on',
  browser: Browser,
  sql: Sql,
  users: string[],
): Promise<BurstResult> {
  await startCache(pgURL, mode, WORKERS);
  const ssr = await startSSR();
  // The servers' own hydrations, which are the donors.
  const owners = [...new Set(users)];
  await Promise.all(owners.map(user => fetch(pageURL('search', user))));
  const contexts = await Promise.all(users.map(() => browser.newContext()));
  const liveAt = await Promise.all(
    users.map(async (user, i) => {
      const tab = await contexts[i].newPage();
      await tab.goto(pageURL('search', user), {waitUntil: 'load'});
      await tab.waitForFunction(
        () => window.__liveAtMs !== undefined,
        undefined,
        {timeout: 60_000},
      );
      return tab.evaluate(() => window.__liveAtMs ?? NaN);
    }),
  );
  await sleep(500);
  const hashes = await queryHashes(sql);
  const events = hydrations().filter(e => e.hash === hashes['search']);
  keepLog(`burst-${++burstCount}-${mode}-${users.length}`);
  const mostRead = Math.max(...events.map(e => e.rowsRead));
  const copied = events.filter(e => e.rowsRead < mostRead / 100);
  // Whatever copied was a browser, as was anything past each server's own.
  const browsers = events.slice(owners.length);
  await Promise.all(contexts.map(c => c.close()));
  await stop(ssr);
  return {
    browsers: browsers.length,
    copied: copied.length,
    hydrationMs: median(browsers.map(e => e.ms)),
    liveMs: median(liveAt),
    slowestLiveMs: Math.max(...liveAt),
  };
}

async function runBursts(mode: 'off' | 'on', browser: Browser, sql: Sql) {
  log(`hydrationClone=${mode}: ${BURST} browsers for one user`);
  const one = await runBurst(
    mode,
    browser,
    sql,
    Array.from({length: BURST}, () => 'alice'),
  );
  log(`hydrationClone=${mode}: one browser each for ${USERS.length} users`);
  const many = await runBurst(mode, browser, sql, USERS);
  return {one, many};
}

async function runVerify() {
  const mode = args['verify-mode'];
  if (mode !== 'on' && mode !== 'shadow') {
    throw new Error(`--verify-mode must be on or shadow, not ${mode}`);
  }
  log(
    `verifying with hydrationClone=${mode} against real CVR data with writes running`,
  );
  await startCache(pgURL, mode, WORKERS, 'debug');
  const child = start(
    'node',
    ['bench/verify.ts'],
    {
      CACHE_PORT: String(PORTS.cache),
      PG_URL: pgURL,
      VERIFY_ROUNDS: args['verify-rounds'],
    },
    'pipe',
  );
  let out = '';
  child.stdout?.on('data', d => (out += d));
  const code = await new Promise<number | null>(r => child.on('exit', r));
  const text = zeroLog();
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  // What each hydration that wasn't copied found when compared with a donor.
  const outcomes: Record<string, number> = {};
  for (const [, outcome] of text.matchAll(/hydration clone: ([a-z-]+)/g)) {
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return {
    mode,
    outcomes,
    code,
    result: out.trim() ? JSON.parse(out.trim().split('\n').at(-1)!) : {},
    copied: count(/hydration copied/g),
    scalarResets: count(/Scalar subquery value changed/g),
    hydrationFailures: count(/hydrate-failed/g),
  };
}

let failed = false;
let pgURL = '';
let sql: Sql | undefined;
let browser: Browser | undefined;
try {
  // A replica left from an earlier run doesn't match the new database.
  rmSync(BUILD, {recursive: true, force: true});
  mkdirSync(BUILD, {recursive: true});
  ({url: pgURL, sql} = await startPostgres(ISSUES));
  start('node', ['dist/server/api-server.js'], {API_PORT: String(PORTS.api)});
  browser = await chromium.launch();
  const results =
    VISITS > 0
      ? {
          off: await runMode('off', browser, sql),
          on: await runMode('on', browser, sql),
        }
      : undefined;
  let bursts;
  if (BURST > 0) {
    bursts = {off: {one: [], many: []}, on: {one: [], many: []}} as NonNullable<
      Parameters<typeof report>[0]['bursts']
    >;
    // Alternating modes, so that drift over the run affects both alike.
    for (let i = 0; i < BURST_RUNS; i++) {
      for (const mode of ['off', 'on'] as const) {
        const {one, many} = await runBursts(mode, browser, sql);
        bursts[mode].one.push(one);
        bursts[mode].many.push(many);
      }
    }
  }
  const verified = args.verify ? await runVerify() : undefined;
  const text = report({
    ssrZero: args['ssr-zero'],
    issues: ISSUES,
    workers: WORKERS,
    visits: VISITS,
    burst: BURST,
    users: USERS.length,
    results,
    bursts,
    verified,
  });
  writeFileSync(join(BUILD, 'results.md'), text);
  console.log(`\n${text}`);
  failed = verified !== undefined && verified.code !== 0;
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser?.close();
  await sql?.end({timeout: 1});
  await stopAll();
  await stopPostgres();
  // The zero-cache log stays in .build for after a failure.
  if (!failed) {
    removeReplica();
  }
}
process.exit(failed ? 1 : 0);
