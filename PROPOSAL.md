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
- `ZeroPool`, long-lived server-side `Zero` instances per user, so rendering a live
  query needs no round trip.

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
| `search` | Reads ~100,000 rows, returns a few | 753 ms → 33 ms      | 866 ms → 136 ms        |
| `list`   | Returns the 3,400 rows it reads    | 24 ms → 28 ms       | 174 ms → 189 ms        |
| `thread` | Scalar subquery, 404 rows          | 2 ms → 4 ms         | 109 ms → 113 ms        |
| `total`  | Filtered count (falls back)        | 731 ms → 750 ms     | 870 ms → 926 ms        |

Copying only helps queries that read far more rows than they return. Otherwise
it's about the same or slightly slower, because each row is still looked up and
written to the new group's CVR. A second client joining an already-live group
synced 39–71% faster than a new group on row-heavy queries, so copying CVR rows in
bulk might help there. I haven't tried it. Separately, repeat server renders of a
live query through `ZeroPool` took 0.4–1.3 ms, against 18–22 ms for a new `Zero`
per request (in an earlier, smaller test).

Visits 6 s apart are the best case for copying. Opening browsers on `search` at the
same time, with connections left open:

| Burst                      | Workers | Copied               | Median browser live: off → on                                     |
| -------------------------- | ------- | -------------------- | ----------------------------------------------------------------- |
| 1 browser each for 5 users | 4       | 5/5, both runs       | 919 ms → 140 ms, and 962 ms → 1,053 ms                            |
| 1 browser each for 5 users | 1       | 5/5                  | 4,018 ms → 250 ms                                                 |
| 16 browsers for one user   | 4       | 7/16, all three runs | 2,835 ms → 2,825 ms, 2,871 ms → 3,162 ms, and 2,956 ms → 7,560 ms |
| 16 browsers for one user   | 1       | 16/16                | 12,465 ms → 2,329 ms                                              |

There are only a few samples each. I can't explain the 1,053 ms and 7,560 ms
results. Both came from one run while the machine was busier, but I haven't
confirmed that's the cause.

Most of the 16 browsers for one user miss because `SyncerAssigner` stops honoring
affinity once a worker has 4 more groups than the least loaded one, and the
overflow lands on workers with no donor. I picked that limit arbitrarily. Shared
keys, such as logged-out pages, would hit it hardest. In a separate stress run
with overlapping keepalives, 62 hydrations copied and 60 found no donor. Some of
those 60 were first hydrations, and I didn't break down the rest.

To check correctness without your test suite:

- Against real CVR data with writes running: 20 rounds, 32 copies, and 12 pipeline
  resets from scalar changes. There were no differences between a clone and its
  donor or a fresh group, and no refcount differences across 15,059 `cvr.rows`
  entries. In an earlier harness, refcounts I deliberately tripled, which the
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
