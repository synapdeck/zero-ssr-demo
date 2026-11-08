/* oxlint-disable no-console, @typescript-eslint/no-explicit-any -- Demo code. */
import postgres from 'postgres';
import {hashOfNameAndArgs} from 'zero-mono/packages/zero-protocol/src/query-hash.ts';
import {Zero} from 'zero-mono/packages/zero/src/zero.ts';
import {mutators, queries, schema} from './schema.ts';

/**
 * Checks copies against real CVR data while writes run. A clone has to show what
 * its donor shows, its main rows have to match a fresh group's, and its reference
 * counts in the CVR have to equal the donor's, since wrong ones would drop rows
 * too early or keep them forever.
 */
const CACHE_URL = `http://127.0.0.1:${process.env['CACHE_PORT']}`;
const sql = postgres(process.env['PG_URL'] as string, {onnotice: () => {}});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const NAMES = ['search', 'list', 'thread', 'threadChanging', 'total'];
// The proof rows under an EXISTS may legitimately differ from a fresh group's.
const ROUNDS = Number(process.env['VERIFY_ROUNDS'] ?? 3);

let storageKey = 0;
const newZero = (tag: string) =>
  new Zero({
    cacheURL: CACHE_URL,
    schema,
    mutators,
    userID: 'alice',
    auth: 'user:alice',
    context: {userID: 'alice'},
    storageKey: `${tag}${storageKey++}${Date.now()}`,
    kvStore: 'mem',
    logLevel: 'error',
  } as any) as any;

function live(zero: any, name: string): Promise<any> {
  const view = zero.materialize((queries as any)[name]());
  return new Promise(resolve => {
    const off = view.addListener((_: unknown, type: string) => {
      if (type === 'complete') {
        off();
        resolve(view);
      }
    });
  });
}

let seq = Date.now();
async function write() {
  const s = ++seq;
  // Leaves the issues the scalar queries resolve to alone.
  const id = () => `i${5 * (3 + Math.floor(Math.random() * 1200))}`;
  const rank = () => Math.floor(Math.random() * 6000);
  const ops = [
    () =>
      sql`insert into issue values (${`n${s}`},${`new ${s}`},'alice',${rank()})`,
    () => sql`delete from issue where id=${id()}`,
    () => sql`update issue set rank=${rank()} where id=${id()}`,
    () => sql`update issue set title=${`t${s}`} where id=${id()}`,
    () =>
      sql`insert into comment values (${`nc${s}`},${id()},${`needle ${s}`})`,
    () => sql`delete from comment where "issueID"=${id()}`,
  ];
  await ops[s % ops.length]();
}

// Removing and restoring the issue a scalar resolved to changes its value twice,
// which resets every pipeline of each client group that has the query.
async function changeScalar() {
  const [row] = await sql`select * from issue where id='i10'`;
  await sql`delete from issue where id='i10'`;
  await sleep(250);
  await sql`insert into issue values (${row.id},${row.title},${row.owner},${row.rank})`;
  await sleep(250);
}

async function refCounts(group: string, hash: string) {
  const rows = await sql`
    select "table", "rowKey", ("refCounts"->>${hash})::int as count
    from "zero_0/cvr".rows
    where "clientGroupID" = ${group} and "refCounts" ? ${hash}`;
  return new Map(
    rows.map(r => [`${r.table}${JSON.stringify(r.rowKey)}`, r.count as number]),
  );
}

const canon = (data: unknown) => JSON.stringify(data);
const stats = {rounds: 0, viewDiffs: 0, freshDiffs: 0, refDiffs: 0, refRows: 0};
const failures: string[] = [];

async function check(
  name: string,
  donor: any,
  donorView: any,
  clone: any,
  view: any,
) {
  stats.rounds++;
  // A scalar change rehydrates every query in a group, which takes a while.
  for (let i = 0; i < 300 && canon(donorView.data) !== canon(view.data); i++) {
    await sleep(100);
  }
  if (canon(donorView.data) !== canon(view.data)) {
    stats.viewDiffs++;
    failures.push(`${name}: clone shows something other than its donor`);
  }
  const fresh = newZero('fresh');
  const freshView = await live(fresh, name);
  if (canon(freshView.data) !== canon(view.data)) {
    stats.freshDiffs++;
    failures.push(`${name}: clone shows something other than a fresh group`);
  }
  freshView.destroy();
  await fresh.close();
  const hash = hashOfNameAndArgs(name, []);
  const a = await refCounts(await donor.clientGroupID, hash);
  const b = await refCounts(await clone.clientGroupID, hash);
  stats.refRows += b.size;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) !== b.get(key)) {
      stats.refDiffs++;
      if (failures.length < 10) {
        failures.push(
          `${name}: ${key} donor=${a.get(key)} clone=${b.get(key)}`,
        );
      }
    }
  }
}

const donor = newZero('donor');
const views: Record<string, any> = {};
for (const name of NAMES) {
  views[name] = await live(donor, name);
}
await sleep(300);

for (let round = 0; round < ROUNDS; round++) {
  for (const name of NAMES) {
    for (let i = 0; i < 6; i++) {
      await write();
    }
    await sleep(250);
    const clone = newZero('clone');
    const view = await live(clone, name);
    if (name === 'threadChanging') {
      await changeScalar();
    }
    for (let i = 0; i < 6; i++) {
      await write();
    }
    await sleep(900);
    await check(name, donor, views[name], clone, view);
    view.destroy();
    await clone.close();
    await sleep(5500);
  }
}

let writing = true;
const writer = (async () => {
  while (writing) {
    await write();
    await sleep(15);
  }
})();
const running: [string, any, any][] = [];
for (const name of NAMES) {
  const clone = newZero('busy');
  running.push([name, clone, await live(clone, name)]);
  await sleep(150);
}
writing = false;
await writer;
await sleep(1500);
for (const [name, clone, view] of running) {
  await check(name, donor, views[name], clone, view);
  view.destroy();
  await clone.close();
}

console.log(JSON.stringify({...stats, failures}));
await donor.close();
await sql.end({timeout: 1});
process.exit(failures.length ? 2 : 0);
