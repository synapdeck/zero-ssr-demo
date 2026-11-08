import {Zero} from '@rocicorp/zero';
import postgres from 'postgres';
import {mutators, queries, schema, type Context} from '../src/app/schema.ts';

/**
 * Checks copies against real CVR data while writes run. A clone has to show what
 * its donor shows, its main rows have to match a fresh group's, and its reference
 * counts in the CVR have to equal the donor's, since wrong ones would drop rows
 * too early or keep them forever.
 */
const CACHE_URL = `http://127.0.0.1:${process.env['CACHE_PORT']}`;
const sql = postgres(process.env['PG_URL'] as string, {onnotice: () => {}});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const NAMES = ['search', 'list', 'thread', 'threadChanging', 'total'] as const;
type Name = (typeof NAMES)[number];
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
    context: {userID: 'alice'} as Context,
    storageKey: `${tag}${storageKey++}${Date.now()}`,
    kvStore: 'mem',
    logLevel: 'error',
  });
type Client = ReturnType<typeof newZero>;

type View = {
  readonly data: unknown;
  addListener(cb: (data: unknown, type: string) => void): () => void;
  destroy(): void;
};

function materialize(zero: Client, name: Name): View {
  switch (name) {
    case 'search':
      return zero.materialize(queries.search());
    case 'list':
      return zero.materialize(queries.list());
    case 'thread':
      return zero.materialize(queries.thread());
    case 'threadChanging':
      return zero.materialize(queries.threadChanging());
    case 'total':
      return zero.materialize(queries.total());
  }
}

function live(zero: Client, name: Name): Promise<View> {
  const view = materialize(zero, name);
  return new Promise(resolve => {
    const off = view.addListener((_, type) => {
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

async function refCounts(group: string, name: string) {
  const rows = await sql`
    select r."table", r."rowKey", (r."refCounts"->>q."queryHash")::int as count
    from "zero_0/cvr".rows r
    join "zero_0/cvr".queries q
      on q."clientGroupID" = r."clientGroupID" and r."refCounts" ? q."queryHash"
    where r."clientGroupID" = ${group} and q."queryName" = ${name}`;
  return new Map(
    rows.map(r => [`${r.table}${JSON.stringify(r.rowKey)}`, r.count as number]),
  );
}

const canon = (data: unknown) => JSON.stringify(data);
const stats = {rounds: 0, viewDiffs: 0, freshDiffs: 0, refDiffs: 0, refRows: 0};
const failures: string[] = [];

async function check(
  name: Name,
  donor: Client,
  donorView: View,
  clone: Client,
  view: View,
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
  const a = await refCounts(await donor.clientGroupID, name);
  const b = await refCounts(await clone.clientGroupID, name);
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
const views = {} as Record<Name, View>;
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
const running: [Name, Client, View][] = [];
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
