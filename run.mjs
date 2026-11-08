#!/usr/bin/env node
/* oxlint-disable no-console -- This is a command-line script. */
// Runs real Postgres, zero-cache and Chromium with hydrationClone off and on. See
// README.md. Everything it starts is stopped again when it finishes.
import {spawn, execSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
// A checkout of the branch under test, with `pnpm install` run in it.
const REPO = resolve(HERE, process.env.ZERO_MONO ?? 'mono');
if (!existsSync(join(REPO, 'node_modules'))) {
  console.error(
    `No installed checkout at ${REPO}. Run \`git submodule update --init\` and \`pnpm install\` in it, or set ZERO_MONO.`,
  );
  process.exit(1);
}
const BUILD = join(HERE, '.build');
const requireFrom = pkg => createRequire(join(REPO, pkg, 'package.json'));
const esbuild = requireFrom('packages/zero-cache')('esbuild');
const postgres = requireFrom('packages/zero-cache')('postgres');
const {chromium} = createRequire(join(REPO, 'package.json'))('playwright');

const {values: args} = parseArgs({
  options: {
    'issues': {type: 'string', default: '500000'},
    'visits': {type: 'string', default: '5'},
    'workers': {type: 'string', default: '4'},
    'verify': {type: 'boolean', default: false},
    'burst': {type: 'string', default: '0'},
    'verify-rounds': {type: 'string', default: '3'},
  },
});

const PORTS = {pg: 17544, api: 17601, ssr: 17602, cache: 17848};
const CONTAINER = 'zero-ssr-clone-demo-pg';
const PG_URL = `postgresql://user:password@127.0.0.1:${PORTS.pg}/postgres`;
const REPLICA = join(BUILD, 'replica.db');
const ZERO_LOG = join(BUILD, 'zero-cache.log');
const PAGES = ['search', 'list', 'thread', 'total'];
const USERS = ['alice', 'other1', 'other2', 'other3', 'other4'];
// How long a client group's view syncer outlives its last connection. Visits wait
// this long so that each browser is placed like a new user's, not on a crowded
// worker full of groups that have just left.
const KEEPALIVE_MS = 6000;

const TS_EXTENSION = /\.tsx?$/;
const EVENT_FIELD = /'(\w+)=([^']*)'/g;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = v => {
  const s = v.toSorted((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};
const round = n => (Number.isFinite(n) ? Math.round(n) : '-');

const processes = new Set();
function start(name, command, argv, env, cwd = HERE) {
  const child = spawn(command, argv, {
    cwd,
    env: {...process.env, ...env},
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
  child.demoName = name;
  processes.add(child);
  child.on('exit', () => processes.delete(child));
  return child;
}
function stop(child) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  const exited = new Promise(r => child.once('exit', r));
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return Promise.resolve();
  }
  return exited;
}
function portsOpen(ports) {
  const open = execSync('ss -ltn').toString();
  return ports.some(p => open.includes(`:${p} `));
}
async function waitFor(what, fn, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const ok = url =>
  fetch(url, {signal: AbortSignal.timeout(1000)}).then(
    r => r.ok,
    () => false,
  );

function build() {
  mkdirSync(BUILD, {recursive: true});
  const common = {
    bundle: true,
    logLevel: 'warning',
    jsx: 'automatic',
    logOverride: {'empty-import-meta': 'silent'},
    // The sources import Zero as `zero-mono/...`, so that they build against
    // whichever checkout REPO is.
    alias: {'zero-mono': REPO},
    nodePaths: [
      join(REPO, 'packages/zero-react/node_modules'),
      join(REPO, 'packages/zero-cache/node_modules'),
    ],
    define: {'process.env.NODE_ENV': '"production"'},
  };
  for (const entry of ['api-server.ts', 'ssr-server.tsx']) {
    esbuild.buildSync({
      ...common,
      entryPoints: [join(HERE, 'src', entry)],
      outfile: join(BUILD, entry.replace(TS_EXTENSION, '.cjs')),
      platform: 'node',
      format: 'cjs',
      target: 'node22',
    });
  }
  esbuild.buildSync({
    ...common,
    entryPoints: [join(HERE, 'src/verify.ts')],
    outfile: join(BUILD, 'verify.mjs'),
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: {
      js: "import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);",
    },
  });
  esbuild.buildSync({
    ...common,
    entryPoints: [join(HERE, 'src/browser.tsx')],
    outfile: join(BUILD, 'browser.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    define: {...common.define, 'process.env': '{}'},
  });
}

async function startPostgres() {
  execSync(`docker rm -f ${CONTAINER} 2>/dev/null || true`, {shell: '/bin/sh'});
  execSync(
    `docker run -d --rm --name ${CONTAINER} -e POSTGRES_USER=user ` +
      `-e POSTGRES_PASSWORD=password -e POSTGRES_DB=postgres ` +
      `-p 127.0.0.1:${PORTS.pg}:5432 postgres:16 -c wal_level=logical ` +
      `-c max_wal_senders=10 -c max_replication_slots=10`,
    {stdio: 'ignore'},
  );
  await waitFor('postgres', () => {
    try {
      execSync(`docker exec ${CONTAINER} pg_isready -U user -d postgres`, {
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  });
  await sleep(1000);
  const sql = postgres(PG_URL, {onnotice: () => {}});
  const n = Number(args.issues);
  log(`seeding ${n} issues and ${n * 2} comments`);
  await sql.unsafe(`
    CREATE TABLE issue (id text PRIMARY KEY, title text NOT NULL, owner text NOT NULL, rank int NOT NULL);
    CREATE INDEX ON issue(owner, rank);
    CREATE TABLE comment (id text PRIMARY KEY, "issueID" text NOT NULL, body text NOT NULL);
    CREATE INDEX ON comment("issueID");
    INSERT INTO issue SELECT 'i'||g, 'title '||g||' '||repeat('x',80),
      CASE WHEN g%5=0 THEN 'alice' ELSE 'other'||(g%5) END, g FROM generate_series(1,${n}) g;
    INSERT INTO comment SELECT 'c'||g, 'i'||(g%${n}+1), 'comment '||g||' '||repeat('y',120)
      FROM generate_series(1,${n * 2}) g;
    INSERT INTO comment SELECT 'needle'||g, 'i'||(${n}-g*5), 'the needle '||g FROM generate_series(1,3) g;
    INSERT INTO comment SELECT 'thread'||g, 'i5', 'thread comment '||g FROM generate_series(1,400) g;
    ANALYZE;
  `);
  return sql;
}

let cache;
async function startCache(mode, level = 'info') {
  if (cache) {
    await stop(cache);
  }
  // A draining zero-cache holds its ports after it was told to stop.
  await waitFor(
    'zero-cache to release its ports',
    () => !portsOpen([PORTS.cache, PORTS.cache + 1]),
  );
  writeFileSync(ZERO_LOG, '');
  const out = spawn(
    'sh',
    [
      '-c',
      `exec node ../../packages/zero-cache/src/server/runner/main.ts >> "${ZERO_LOG}" 2>&1`,
    ],
    {
      cwd: join(REPO, 'apps/zbugs'),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ZERO_ADMIN_PASSWORD: 'demo',
        ZERO_UPSTREAM_DB: PG_URL,
        ZERO_REPLICA_FILE: REPLICA,
        ZERO_QUERY_URL: `http://127.0.0.1:${PORTS.api}/query`,
        // Never called, because the demo has no mutators. Without one, zero-cache
        // expects to verify tokens itself.
        ZERO_MUTATE_URL: `http://127.0.0.1:${PORTS.api}/mutate`,
        ZERO_PORT: String(PORTS.cache),
        ZERO_NUM_SYNC_WORKERS: args.workers,
        ZERO_LOG_LEVEL: level,
        ZERO_HYDRATION_CLONE: mode,
      },
    },
  );
  out.demoName = 'zero-cache';
  processes.add(out);
  out.on('exit', () => processes.delete(out));
  cache = out;
  await waitFor(
    'zero-cache',
    () => ok(`http://127.0.0.1:${PORTS.cache}/`),
    180_000,
  );
}

/** Every hydration zero-cache logged, for the app's queries. */
function hydrationEvents() {
  const text = readFileSync(ZERO_LOG, 'utf8');
  const events = [];
  for (const [block] of text.matchAll(
    /\[\s*'pid=(?:(?!\]\s).)*?'zeroEvent=query-pipeline-hydrate-finish'(?:(?!\]\s).)*?\]/gs,
  )) {
    const f = Object.fromEntries(
      Array.from(block.matchAll(EVENT_FIELD), m => [m[1], m[2]]),
    );
    events.push({
      hash: f.queryHash,
      ms: Number(f.hydrationTimeMs),
      rowsRead: Number(f.hydrationRowsRead),
      rows: Number(f.hydrationRowCount),
    });
  }
  return events;
}

/** A write that has to reach the page if its view is really live. */
const LIVE_WRITES = {
  search: sql => id =>
    sql`insert into comment values (${id},'i5',${'needle ' + id})`,
  list: sql => id => sql`insert into issue values (${id},'live','alice',-1000)`,
  thread: sql => id =>
    sql`insert into comment values (${id},'i5','thread live')`,
  total: sql => id =>
    sql`insert into comment values (${id},'i10',${'needle ' + id})`,
};

async function visit(browser, sql, page, n) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  const pageErrors = [];
  tab.on('pageerror', e => pageErrors.push(e.message));
  const response = await tab.goto(
    `http://127.0.0.1:${PORTS.ssr}/?page=${page}`,
    {waitUntil: 'load'},
  );
  if (!response.ok()) {
    throw new Error(`${page}: ${response.status()} ${await response.text()}`);
  }
  await tab.waitForFunction('window.__liveAtMs !== undefined', undefined, {
    timeout: 30_000,
  });
  const before = await tab.evaluate(() => window.__trace.at(-1));
  const id = `live${page}${n}${Date.now()}`;
  await LIVE_WRITES[page](sql)(id);
  let live = true;
  await tab
    .waitForFunction(b => window.__trace.at(-1) !== b, before, {timeout: 5000})
    .catch(() => {
      live = false;
    });
  const seen = await tab.evaluate(() => ({
    liveAtMs: window.__liveAtMs,
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

async function runMode(mode, browser, sql) {
  log(`hydrationClone=${mode}: starting`);
  await startCache(mode);
  const ssr = start('ssr', 'node', [join(BUILD, 'ssr-server.cjs')], {
    SSR_PORT: String(PORTS.ssr),
    CACHE_PORT: String(PORTS.cache),
    BUILD_DIR: BUILD,
  });
  await waitFor('ssr server', () => ok(`http://127.0.0.1:${PORTS.ssr}/hashes`));
  const hashes = await (
    await fetch(`http://127.0.0.1:${PORTS.ssr}/hashes`)
  ).json();
  const pages = {};
  for (const page of PAGES) {
    const visits = [];
    for (let i = 0; i < Number(args.visits); i++) {
      visits.push(await visit(browser, sql, page, i));
      await sleep(KEEPALIVE_MS);
    }
    log(`hydrationClone=${mode}: ${page} done`);
    pages[page] = visits;
  }
  const events = hydrationEvents();
  await stop(ssr);
  const summary = {};
  for (const page of PAGES) {
    const visits = pages[page];
    // The first hydration is the server's own: there is nothing to copy from yet.
    const hydrations = events.filter(e => e.hash === hashes[page]).slice(1);
    summary[page] = {
      firstRenderMs: visits[0].renderMs,
      laterRenderMs: median(visits.slice(1).map(v => v.renderMs)),
      browserLiveMs: median(visits.map(v => v.liveAtMs)),
      hydrationMs: median(hydrations.map(e => e.ms)),
      rowsRead: median(hydrations.map(e => e.rowsRead)),
      rowsSent: median(hydrations.map(e => e.rows)),
      hydrations: hydrations.length,
      flashes: visits.filter(v => v.flashed).length,
      errors: visits.reduce((n, v) => n + v.errors, 0),
      liveUpdates: `${visits.filter(v => v.live).length}/${visits.length}`,
    };
  }
  return summary;
}

/**
 * Browsers arriving together and staying connected, unlike the spaced-out visits
 * above, so that groups pile up on a worker. A hydration that read far less than
 * the server's own was copied.
 */
async function runBurst(mode, browser, users) {
  await startCache(mode);
  const ssr = start('ssr', 'node', [join(BUILD, 'ssr-server.cjs')], {
    SSR_PORT: String(PORTS.ssr),
    CACHE_PORT: String(PORTS.cache),
    BUILD_DIR: BUILD,
  });
  await waitFor('ssr server', () => ok(`http://127.0.0.1:${PORTS.ssr}/hashes`));
  const hashes = await (
    await fetch(`http://127.0.0.1:${PORTS.ssr}/hashes`)
  ).json();
  const urlOf = user =>
    `http://127.0.0.1:${PORTS.ssr}/?page=search&user=${user}`;
  // The servers' own hydrations, which are the donors.
  const owners = [...new Set(users)];
  await Promise.all(owners.map(user => fetch(urlOf(user))));
  const contexts = [];
  const open = async user => {
    const context = await browser.newContext();
    contexts.push(context);
    const tab = await context.newPage();
    await tab.goto(urlOf(user), {waitUntil: 'load'});
    await tab.waitForFunction('window.__liveAtMs !== undefined', undefined, {
      timeout: 60_000,
    });
    return tab.evaluate(() => window.__liveAtMs);
  };
  const liveAt = await Promise.all(users.map(open));
  await sleep(500);
  const hydrations = hydrationEvents().filter(e => e.hash === hashes.search);
  const mostRead = Math.max(...hydrations.map(e => e.rowsRead));
  const copied = hydrations.filter(e => e.rowsRead < mostRead / 100);
  // Whatever copied was a browser, as was anything past each server's own.
  const browsers = hydrations.slice(owners.length);
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

async function runVerify() {
  log('verifying copies against real CVR data with writes running');
  await startCache('on', 'debug');
  const code = await new Promise(resolve => {
    const child = spawn('node', [join(BUILD, 'verify.mjs')], {
      cwd: HERE,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        CACHE_PORT: String(PORTS.cache),
        PG_URL,
        VERIFY_ROUNDS: args['verify-rounds'],
      },
    });
    processes.add(child);
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.on('exit', c => {
      processes.delete(child);
      verifyOutput = out.trim();
      resolve(c);
    });
  });
  const logText = readFileSync(ZERO_LOG, 'utf8');
  return {
    code,
    result: verifyOutput
      ? JSON.parse(verifyOutput.split('\n').at(-1))
      : undefined,
    copied: (logText.match(/hydration copied/g) ?? []).length,
    scalarResets: (logText.match(/Scalar subquery value changed/g) ?? [])
      .length,
    hydrationFailures: (logText.match(/hydrate-failed/g) ?? []).length,
  };
}
let verifyOutput = '';

function report(results, verified, burst, burstUsers) {
  const lines = [
    `# hydrationClone off vs on`,
    ``,
    `${args.issues} issues, ${Number(args.issues) * 2} comments, ${args.workers} sync workers, one node, ` +
      `${args.visits} first visits per page in a new Chromium context.`,
    ``,
    `"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is`,
    `navigation start to the browser's own view of the query being complete.`,
    `"Rows read" is the hydration's own count. A copy still looks up each row it sends, which`,
    `that count leaves out, so it shows why \`search\` gets faster and not what \`list\` costs.`,
    ``,
    `| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |`,
    `|---|---|---|---|---|---|---|`,
  ];
  const kinds = {
    search: 'Reads a lot, returns little',
    list: 'Returns what it reads',
    thread: 'Scalar subquery',
    total: 'Aggregate (always hydrates)',
  };
  for (const page of PAGES) {
    const a = results.off[page];
    const b = results.on[page];
    lines.push(
      `| ${page} | ${kinds[page]} | ${round(a.rowsRead)} → ${round(b.rowsRead)} | ` +
        `${round(a.hydrationMs)} ms → ${round(b.hydrationMs)} ms | ` +
        `${round(a.browserLiveMs)} ms → ${round(b.browserLiveMs)} ms | ` +
        `${round(b.firstRenderMs)} ms | ${Number.isNaN(b.laterRenderMs) ? '-' : `${b.laterRenderMs.toFixed(1)} ms`} |`,
    );
  }
  lines.push(
    ``,
    `| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |`,
    `|---|---|---|---|`,
  );
  for (const page of PAGES) {
    const a = results.off[page];
    const b = results.on[page];
    lines.push(
      `| ${page} | ${a.flashes} / ${b.flashes} | ${a.errors} / ${b.errors} | ${a.liveUpdates} / ${b.liveUpdates} |`,
    );
  }
  if (burst.on) {
    lines.push(
      ``,
      `## ${args.burst} browsers at once on \`search\``,
      ``,
      `| hydrationClone | Copied | Hydration | Browser live | Slowest browser |`,
      `|---|---|---|---|---|`,
    );
    for (const mode of ['off', 'on']) {
      const b = burst[mode];
      lines.push(
        `| ${mode} | ${b.copied}/${b.browsers} | ${round(b.hydrationMs)} ms | ${round(b.liveMs)} ms | ${round(b.slowestLiveMs)} ms |`,
      );
    }
    lines.push(
      ``,
      `## One browser each for ${USERS.length} users at once on \`search\``,
      ``,
      `| hydrationClone | Copied | Hydration | Browser live | Slowest browser |`,
      `|---|---|---|---|---|`,
    );
    for (const mode of ['off', 'on']) {
      const b = burstUsers[mode];
      lines.push(
        `| ${mode} | ${b.copied}/${b.browsers} | ${round(b.hydrationMs)} ms | ${round(b.liveMs)} ms | ${round(b.slowestLiveMs)} ms |`,
      );
    }
  }
  if (verified) {
    const r = verified.result ?? {};
    lines.push(
      ``,
      `## Verification with writes running`,
      ``,
      `| Rounds | Copies | Scalar resets | Clone vs donor differences | Clone vs fresh differences | CVR rows compared | CVR refcount differences | Hydration failures |`,
      `|---|---|---|---|---|---|---|---|`,
      `| ${r.rounds} | ${verified.copied} | ${verified.scalarResets} | ${r.viewDiffs} | ${r.freshDiffs} | ${r.refRows} | ${r.refDiffs} | ${verified.hydrationFailures} |`,
    );
    for (const f of r.failures ?? []) {
      lines.push(`- ${f}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

let failed = false;
let sql;
let browser;
try {
  rmSync(BUILD, {recursive: true, force: true});
  log('building');
  build();
  sql = await startPostgres();
  start('api', 'node', [join(BUILD, 'api-server.cjs')], {
    API_PORT: String(PORTS.api),
  });
  browser = await chromium.launch();
  const results = {};
  for (const mode of ['off', 'on']) {
    results[mode] = await runMode(mode, browser, sql);
  }
  const burst = {};
  const burstUsers = {};
  if (Number(args.burst) > 0) {
    for (const mode of ['off', 'on']) {
      log(`hydrationClone=${mode}: burst of ${args.burst}`);
      burst[mode] = await runBurst(
        mode,
        browser,
        Array.from({length: Number(args.burst)}).fill('alice'),
      );
      log(`hydrationClone=${mode}: one browser each for ${USERS.length} users`);
      burstUsers[mode] = await runBurst(mode, browser, USERS);
    }
  }
  const verified = args.verify ? await runVerify() : undefined;
  const text = report(results, verified, burst, burstUsers);
  writeFileSync(join(BUILD, 'results.md'), text);
  console.log(`\n${text}`);
  failed = verified !== undefined && verified.code !== 0;
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser?.close();
  await sql?.end({timeout: 1});
  await Promise.all(Array.from(processes, stop));
  execSync(`docker rm -f ${CONTAINER} 2>/dev/null || true`, {shell: '/bin/sh'});
  // The build is kept for the results, and for the zero-cache log after a failure.
  if (!failed) {
    rmSync(REPLICA, {force: true});
  }
}
process.exit(failed ? 1 : 0);
