import {execSync, spawn, type ChildProcess} from 'node:child_process';
import {closeSync, openSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import postgres from 'postgres';

export const ROOT = join(import.meta.dirname, '..');
export const BUILD = join(ROOT, '.build');
export const PORTS = {api: 17601, ssr: 17602, cache: 17848};
export const ZERO_LOG = join(BUILD, 'zero-cache.log');
const REPLICA = join(BUILD, 'replica.db');

export type Sql = postgres.Sql;

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const log = (...a: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), ...a);

export async function waitFor(
  what: string,
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 120_000,
) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export const ok = (url: string) =>
  fetch(url, {signal: AbortSignal.timeout(1000)}).then(
    r => r.ok,
    () => false,
  );

const processes = new Set<ChildProcess>();

/** Starts a process in its own group, so that stopping it stops its children. */
export function start(
  command: string,
  args: string[],
  env: Record<string, string>,
  stdout: 'ignore' | 'pipe' | number = 'ignore',
) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: {...process.env, ...env},
    stdio: ['ignore', stdout, stdout === 'ignore' ? 'inherit' : stdout],
    detached: true,
  });
  processes.add(child);
  child.on('exit', () => processes.delete(child));
  return child;
}

export function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) {
    return Promise.resolve();
  }
  const exited = new Promise<void>(r => child.once('exit', () => r()));
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return Promise.resolve();
  }
  return exited;
}

export const stopAll = () => Promise.all(Array.from(processes, stop));

let pg: StartedPostgreSqlContainer | undefined;

/** Starts and seeds Postgres, returning its URL and a connection. */
export async function startPostgres(issues: number) {
  pg = await new PostgreSqlContainer('postgres:16')
    .withCommand([
      'postgres',
      '-c',
      'wal_level=logical',
      '-c',
      'max_wal_senders=10',
      '-c',
      'max_replication_slots=10',
    ])
    .start();
  const url = pg.getConnectionUri();
  const sql = postgres(url, {onnotice: () => {}});
  log(`seeding ${issues} issues and ${issues * 2} comments`);
  await sql.unsafe(`
    CREATE TABLE issue (id text PRIMARY KEY, title text NOT NULL, owner text NOT NULL, rank int NOT NULL);
    CREATE INDEX ON issue(owner, rank);
    CREATE TABLE comment (id text PRIMARY KEY, "issueID" text NOT NULL, body text NOT NULL);
    CREATE INDEX ON comment("issueID");
    INSERT INTO issue SELECT 'i'||g, 'title '||g||' '||repeat('x',80),
      CASE WHEN g%5=0 THEN 'alice' ELSE 'other'||(g%5) END, g FROM generate_series(1,${issues}) g;
    INSERT INTO comment SELECT 'c'||g, 'i'||(g%${issues}+1), 'comment '||g||' '||repeat('y',120)
      FROM generate_series(1,${issues * 2}) g;
    INSERT INTO comment SELECT 'needle'||g, 'i'||(${issues}-g*5), 'the needle '||g FROM generate_series(1,3) g;
    INSERT INTO comment SELECT 'thread'||g, 'i5', 'thread comment '||g FROM generate_series(1,400) g;
    ANALYZE;
  `);
  return {url, sql};
}

export const stopPostgres = () => pg?.stop();

function portsOpen(ports: number[]) {
  const open = execSync('ss -ltn').toString();
  return ports.some(p => open.includes(`:${p} `));
}

let cache: ChildProcess | undefined;

/** Restarts zero-cache with the given `hydrationClone` mode. */
export async function startCache(
  pgURL: string,
  mode: 'off' | 'shadow' | 'on',
  workers: number,
  level = 'info',
) {
  if (cache) {
    await stop(cache);
  }
  // A draining zero-cache holds its ports after it was told to stop.
  await waitFor(
    'zero-cache to release its ports',
    () => !portsOpen([PORTS.cache, PORTS.cache + 1]),
  );
  const out = openSync(ZERO_LOG, 'w');
  cache = start(
    join(ROOT, 'node_modules/.bin/zero-cache'),
    [],
    {
      ZERO_ADMIN_PASSWORD: 'demo',
      ZERO_UPSTREAM_DB: pgURL,
      ZERO_REPLICA_FILE: REPLICA,
      ZERO_QUERY_URL: `http://127.0.0.1:${PORTS.api}/query`,
      // Never called, because the demo has no mutators. Without one, zero-cache
      // expects to verify tokens itself.
      ZERO_MUTATE_URL: `http://127.0.0.1:${PORTS.api}/mutate`,
      ZERO_PORT: String(PORTS.cache),
      ZERO_NUM_SYNC_WORKERS: String(workers),
      ZERO_LOG_LEVEL: level,
      ZERO_HYDRATION_CLONE: mode,
    },
    out,
  );
  closeSync(out);
  await waitFor(
    'zero-cache',
    () => ok(`http://127.0.0.1:${PORTS.cache}/`),
    180_000,
  );
}

/** Removes the replica and its SQLite side files. */
export function removeReplica() {
  for (const suffix of ['', '-shm', '-wal', '-wal2']) {
    rmSync(REPLICA + suffix, {force: true});
  }
}

export const zeroLog = () => readFileSync(ZERO_LOG, 'utf8');
