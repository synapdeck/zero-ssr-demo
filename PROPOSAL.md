I built SSR for Zero, including copying hydrations between client groups, to make
this proposal concrete. I'm not at Rocicorp and can't run your private tests, so
none of this has run against them, and I don't expect it to merge as is.

PR: [link once opened]
Demo: [synapdeck/zero-ssr-demo](https://github.com/synapdeck/zero-ssr-demo).
`pnpm bench --verify` runs Postgres, zero-cache and Chromium.

It follows your July comment: the server connection is its own client group,
queries are reused across client groups, and request metadata routes a user's
server and browser connections together. On the client side, the PR has:

- A fix for `useQuery` leaking a query when a render never commits. This affects
  browsers today.
- `QuerySnapshotCollector` and `QuerySnapshotProvider`, for complete HTML from the
  server and hydration with no empty flash.

And in zero-cache:

- `affinityKey`, which puts a user's connections on one sync worker. A load
  balancer can hash on it too.
- `hydrationClone`, hidden and `off` by default. `on` copies a hydration from
  another group on the same worker with the same
  `(clientSchemaKey, transformationHash)` at the same version. `shadow` hydrates
  normally and compares the result with what it could have copied.

Copying happens in `PipelineDriver.addQuery` and yields the same row changes as a
hydration, so the view syncer and CVR code barely change. When anything doesn't
match, it hydrates normally.

With 500,000 issues, 1,000,000 comments, one node and 4 sync workers, these are
medians of 5 first visits per page, 6 s apart:

| Page     | Query                              | Hydration: off → on | Browser live: off → on |
| -------- | ---------------------------------- | ------------------- | ---------------------- |
| `search` | Reads ~100,000 rows, returns a few | 737 ms → 32 ms      | 864 ms → 137 ms        |
| `list`   | Returns the 3,400 rows it reads    | 22 ms → 27 ms       | 161 ms → 163 ms        |
| `thread` | Scalar subquery, 404 rows          | 2 ms → 5 ms         | 106 ms → 103 ms        |
| `total`  | Filtered count (falls back)        | 706 ms → 746 ms     | 852 ms → 920 ms        |

Copying only helps queries that read far more rows than they return. Otherwise
it's about the same or slightly slower, because each row is still looked up and
written to the new group's CVR. A second client joining an already-live group
synced 39–71% faster than a new group on row-heavy queries, so copying CVR rows in
bulk might help there. I haven't tried it.

The PR doesn't decide how a server gets its `Zero` instances. The demo keeps one
per user, in a small cache that's app code, so their queries stay live between
renders. Compared with a new `Zero` per request, repeat renders (with copying on)
took:

| Page     | One `Zero` per user | New `Zero` per request |
| -------- | ------------------- | ---------------------- |
| `search` | 0.8 ms              | 24 ms                  |
| `list`   | 1.9 ms              | 108 ms                 |
| `thread` | 0.6 ms              | 74 ms                  |
| `total`  | 0.6 ms              | 1,584 ms               |

Copying keeps per-request renders of `search` cheap, but anything that can't be
copied hydrates again on every request.

Visits 6 s apart are the best case for copying. Opening browsers on `search` at the
same time, with connections left open:

| Burst                      | Workers | Runs | Copied | Median browser live: off → on   | Slowest browser: off → on       |
| -------------------------- | ------- | ---- | ------ | ------------------------------- | ------------------------------- |
| 1 browser each for 5 users | 4       | 9    | 5/5    | 892–948 ms → 158–193 ms         | 1,700–1,845 ms → 214–269 ms     |
| 1 browser each for 5 users | 1       | 1    | 5/5    | 4,237 ms → 440 ms               | 4,245 ms → 446 ms               |
| 16 browsers for one user   | 4       | 9    | 7/16   | 2,669–2,999 ms → 2,744–3,076 ms | 5,657–6,052 ms → 2,823–3,128 ms |
| 16 browsers for one user   | 1       | 1    | 16/16  | 12,548 ms → 926 ms              | 12,558 ms → 981 ms              |

With 16 browsers for one user on 4 workers, the affinity worker gets the server's
group and 7 browsers, and the other workers get 3 each. A worker interleaves the
hydrations it holds, so its last one finishes after all of them. Copying finishes
the affinity worker's 7 by about 0.4 s instead of about 5.7 s, which is why the
slowest browser gets twice as fast. The median browser is one of the other 9,
which hydrate normally. They did the same work with copying on, but finished
50–100 ms later. I think the copied browsers' sync traffic now overlaps their
hydrations instead of following them, but I haven't confirmed it.

One earlier run had a median of 4,336 ms with copying on. In that run the median
hydration took 1,194 ms instead of about 800 ms, which copying doesn't change on a
worker with no donor, and it didn't happen in the 9 runs above.

Most of the 16 browsers for one user miss because `SyncerAssigner` stops honoring
affinity once a worker has 4 more groups than the least loaded one, and the
overflow lands on workers with no donor. I picked that limit arbitrarily. Shared
keys, such as logged-out pages, would hit it hardest. In a separate stress run
with overlapping keepalives, 62 hydrations copied and 60 found no donor. Some of
those 60 were first hydrations, and I didn't break down the rest.

To check correctness without your test suite:

- Against real CVR data with writes running: 105 checks, 184 copies, and 80
  pipeline resets from scalar changes. There were no differences between a clone
  and its donor or a fresh group, and no refcount differences across 74,649
  `cvr.rows` entries. In an earlier harness, refcounts I deliberately tripled, which the
  signature check can't see, were caught immediately.
- A fuzz test, `pipeline-history.test.ts`, sends seeded writes through real
  `PipelineDriver`s, and compares long-lived pipelines with fresh ones and clones
  with donors. It caught a real bug: `Join` and `FlippedJoin` build their own
  `JoinIndex`, and copies were dropping child rows. It uses a stand-in for the CVR
  row list, so it doesn't cover that path.
- In shadow mode, 59 of 115 hydrations under writes had a donor, and none
  conflicted. 29 differed only by the extra state described below.

Some things you'd want to know:

- Long-lived pipelines carry extra state: `Cap` entries left behind by advancing,
  and `EXISTS` proof rows that can differ from a fresh pipeline's. So a clone takes
  its state and rows from a single donor, and a fresh hydration isn't a valid
  reference for proof rows.
- Copying blocks the worker. About 100,000 state entries took 36–43 ms in one step,
  because the donor could change if the copy yielded.
- A render right after a write is stale (8 of 8 times) because of replica lag. Live
  sync corrects it after hydration, but a form post and redirect can briefly show
  old data, and a crawler can keep it. A fix needs a way to wait for a replica
  version.
- Aggregates always hydrate normally. Copying them would need handling for
  `GroupBy`'s `#hydrated` flag, synthetic rows, and query IDs in table names.
- On a first visit, a user's own edit stays hidden until the server confirms the
  query. From reading the code, the worst case is about a minute on a stuck
  connection, but I didn't measure it. Returning visitors with `cached` rows see
  the edit immediately.
- Multiple nodes are untested. I confirmed that Envoy can route on `affinityKey`
  (`MAGLEV` with a `query_parameter` hash) with WebSocket upgrades, against
  stand-in pods and one real zero-cache. I didn't test draining or scaling.

What I'd like your take on:

1. Is copying state the right approach, or do you want one shared pipeline per
   query? Your shared-advance telemetry suggests the latter. With copying, each
   group still pays for its own advancement, but it's much less invasive.
2. Is the first-visit hold acceptable? It's the main trade-off users would see.
3. Would you rather review this in pieces? The client half comes first in the
   commits and doesn't depend on the zero-cache changes. The first commit, the
   `useQuery` fix, stands alone.
