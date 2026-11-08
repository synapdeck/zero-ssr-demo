import {PAGES, type PageName} from '../src/app/schema.ts';

export type PageResult = {
  firstRenderMs: number;
  laterRenderMs: number;
  browserLiveMs: number;
  hydrationMs: number;
  rowsRead: number;
  flashes: number;
  errors: number;
  liveUpdates: string;
};

export type BurstResult = {
  browsers: number;
  copied: number;
  hydrationMs: number;
  liveMs: number;
  slowestLiveMs: number;
};

type Modes<T> = Record<'off' | 'on', T>;

export type Report = {
  issues: number;
  workers: number;
  visits: number;
  burst: number;
  users: number;
  results: Modes<Record<PageName, PageResult>>;
  bursts: Modes<{one: BurstResult; many: BurstResult}> | undefined;
  verified:
    | {
        result: {
          rounds?: number;
          viewDiffs?: number;
          freshDiffs?: number;
          refRows?: number;
          refDiffs?: number;
          failures?: string[];
        };
        copied: number;
        scalarResets: number;
        hydrationFailures: number;
      }
    | undefined;
};

const KINDS: Record<PageName, string> = {
  search: 'Reads a lot, returns little',
  list: 'Returns what it reads',
  thread: 'Scalar subquery',
  total: 'Aggregate (always hydrates)',
};

const ms = (n: number) => (Number.isFinite(n) ? `${Math.round(n)} ms` : '-');

function burstTable(title: string, b: Modes<BurstResult>) {
  return [
    ``,
    title,
    ``,
    `| hydrationClone | Copied | Hydration | Browser live | Slowest browser |`,
    `|---|---|---|---|---|`,
    ...(['off', 'on'] as const).map(
      mode =>
        `| ${mode} | ${b[mode].copied}/${b[mode].browsers} | ${ms(b[mode].hydrationMs)} | ` +
        `${ms(b[mode].liveMs)} | ${ms(b[mode].slowestLiveMs)} |`,
    ),
  ];
}

/** The results as Markdown. */
export function report(r: Report): string {
  const {off, on} = r.results;
  const lines = [
    `# hydrationClone off vs on`,
    ``,
    `${r.issues} issues, ${r.issues * 2} comments, ${r.workers} sync workers, one node, ` +
      `${r.visits} first visits per page, each in a new Chromium context.`,
    ``,
    `"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is`,
    `the time from navigation start until the browser's own view of the query is complete.`,
    `"Rows read" leaves out the rows a copy looks up to send, so it shows why \`search\` gets`,
    `faster but not what \`list\` costs.`,
    ``,
    `| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |`,
    `|---|---|---|---|---|---|---|`,
    ...PAGES.map(
      p =>
        `| ${p} | ${KINDS[p]} | ${off[p].rowsRead} → ${on[p].rowsRead} | ` +
        `${ms(off[p].hydrationMs)} → ${ms(on[p].hydrationMs)} | ` +
        `${ms(off[p].browserLiveMs)} → ${ms(on[p].browserLiveMs)} | ` +
        `${ms(on[p].firstRenderMs)} | ` +
        `${Number.isFinite(on[p].laterRenderMs) ? `${on[p].laterRenderMs.toFixed(1)} ms` : '-'} |`,
    ),
    ``,
    `| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |`,
    `|---|---|---|---|`,
    ...PAGES.map(
      p =>
        `| ${p} | ${off[p].flashes} / ${on[p].flashes} | ${off[p].errors} / ${on[p].errors} | ` +
        `${off[p].liveUpdates} / ${on[p].liveUpdates} |`,
    ),
  ];
  if (r.bursts) {
    const {off: a, on: b} = r.bursts;
    lines.push(
      ...burstTable(
        `## ${r.burst} browsers for one user at once on \`search\``,
        {
          off: a.one,
          on: b.one,
        },
      ),
      ...burstTable(
        `## One browser each for ${r.users} users at once on \`search\``,
        {off: a.many, on: b.many},
      ),
    );
  }
  if (r.verified) {
    const v = r.verified;
    const x = v.result;
    lines.push(
      ``,
      `## Verification with writes running`,
      ``,
      `| Rounds | Copies | Scalar resets | Clone vs donor differences | Clone vs fresh differences | CVR rows compared | CVR refcount differences | Hydration failures |`,
      `|---|---|---|---|---|---|---|---|`,
      `| ${x.rounds} | ${v.copied} | ${v.scalarResets} | ${x.viewDiffs} | ${x.freshDiffs} | ` +
        `${x.refRows} | ${x.refDiffs} | ${v.hydrationFailures} |`,
      ...(x.failures ?? []).map(f => `- ${f}`),
    );
  }
  return `${lines.join('\n')}\n`;
}
