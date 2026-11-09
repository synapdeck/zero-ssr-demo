I built SSR for Zero, including copying hydrations between client groups, to make
this proposal concrete. I'm not at Rocicorp and can't run your private tests, so
none of this has run against them, and I don't expect it to merge as is.

PR: [rocicorp/mono#6742](https://github.com/rocicorp/mono/pull/6742)
Demo: [synapdeck/zero-ssr-demo](https://github.com/synapdeck/zero-ssr-demo).
`pnpm bench --verify` runs Postgres, zero-cache and Chromium.

It follows your July comment: the server connection is its own client group,
queries are reused across client groups, and request metadata routes a user's
server and browser connections together. On the client side, the PR has:

- A fix for `useQuery` leaking a query when a render never commits. This affects
  browsers today.
- `QuerySnapshotCollector` and `QuerySnapshotProvider`, for complete HTML from the
  server and hydration with no empty flash.
- Warnings when a query hydrates without a server snapshot, saying whether the
  server rendered it with other args, the same args (so the context differs), or
  not at all.

And in zero-cache:

- `affinityKey`, which puts a user's connections on one sync worker. A load
  balancer can hash on it too.
- `hydrationClone`, hidden and `off` by default. `on` copies a hydration from
  another group on the same worker when the query and the row keys of the tables
  it reads match, at the same version. `shadow` hydrates normally and compares the
  result with what it could have copied.

Copying happens in `PipelineDriver.addQuery` and yields the same row changes as a
hydration, so the view syncer and CVR code barely change. Queries with scalar
subqueries and aggregates are copied too. When anything doesn't match, it hydrates
normally.

With 500,000 issues, 1,000,000 comments, one node and 4 sync workers, these are
medians of 5 first visits per page, 6 s apart:

| Page     | Query                              | Hydration: off → on | Browser live: off → on |
| -------- | ---------------------------------- | ------------------- | ---------------------- |
| `search` | Reads ~100,000 rows, returns a few | 760 ms → 7 ms       | 885 ms → 108 ms        |
| `list`   | Returns the 3,400 rows it reads    | 30 ms → 26 ms       | 177 ms → 162 ms        |
| `thread` | Scalar subquery, 404 rows          | 3 ms → 4 ms         | 109 ms → 112 ms        |
| `total`  | Count that reads ~100,000 rows     | 741 ms → 9 ms       | 843 ms → 97 ms         |

Copying only helps queries that read far more rows than they return. Otherwise
it's about the same, because each row is still looked up and written to the new
group's CVR. A second client joining an already-live group synced 39–71% faster
than a new group on row-heavy queries, so copying CVR rows in bulk might help
there. I haven't tried it.

The PR doesn't decide how a server gets its `Zero` instances. The demo keeps one
per user, in a small cache that's app code, so their queries stay live between
renders. Compared with a new `Zero` per request, repeat renders (with copying on)
took, as medians over three runs:

| Page     | One `Zero` per user | New `Zero` per request |
| -------- | ------------------- | ---------------------- |
| `search` | 0.8 ms              | 25–36 ms               |
| `list`   | 1.9 ms              | 75–297 ms              |
| `thread` | 0.7 ms              | 65–867 ms              |
| `total`  | 0.5 ms              | 59–947 ms              |

A new `Zero` per request varies a lot from run to run, because every render
creates and tears down a client group. Logging every wait for a donor in one of
those runs showed none, so it isn't the copying.

Visits 6 s apart are the best case for copying. Opening browsers on `search` at the
same time, with connections left open, over 3 runs:

| Burst                      | Workers | Copied | Median browser live: off → on   | Slowest browser: off → on       |
| -------------------------- | ------- | ------ | ------------------------------- | ------------------------------- |
| 1 browser each for 5 users | 4       | 5/5    | 908–1,669 ms → 123–135 ms       | 1,640–1,781 ms → 158–169 ms     |
| 1 browser each for 5 users | 1       | 5/5    | 3,713–3,793 ms → 195–209 ms     | 3,716–3,794 ms → 199–214 ms     |
| 16 browsers for one user   | 4       | 13/16  | 3,460–4,041 ms → 1,117–1,135 ms | 4,247–4,841 ms → 1,143–1,169 ms |
| 16 browsers for one user   | 1       | 16/16  | 12,203–12,368 ms → 474–528 ms   | 12,234–12,378 ms → 494–536 ms   |

Browsers that arrive together can't copy from each other unless one waits, so a
hydration waits for one of the same query already in progress on its worker, and
copies it. It started first and would share the worker anyway, so waiting takes
no longer than hydrating alongside it. With 16 browsers for one user on 4 workers,
the server's group and the browsers spread 5, 5, 5 and 2. The 4 browsers with the
server's group copy from it, and on each other worker the first browser hydrates
and the rest copy from it: 13 of 16.

A key spreads to another worker once its workers have 4 more groups than the least
loaded one, and then stays on as few workers as that allows. I picked the limit
arbitrarily. Shared keys, such as logged-out pages, would hit it hardest. With
copying off, affinity is ignored, which is why the off column is balanced rather
than one worker taking 8 of 17 groups.

To check correctness without your test suite:

- Against real CVR data with writes running: 105 checks, 225 copies, and 80
  pipeline resets from scalar changes. There were no differences between a clone
  and its donor or a fresh group, and no refcount differences across 75,195
  `cvr.rows` entries. In an earlier harness, refcounts I deliberately tripled,
  which the signature check can't see, were caught immediately.
- A fuzz test, `pipeline-history.test.ts`, sends seeded writes through real
  `PipelineDriver`s, and compares long-lived pipelines with fresh ones and clones
  with donors, aggregates included. It caught a real bug: `Join` and
  `FlippedJoin` build their own `JoinIndex`, and copies were dropping child rows.
  It uses a stand-in for the CVR row list, so it doesn't cover that path.
- The same check in shadow mode: of 455 hydrations, 243 had a donor at the same
  version, and none conflicted. 77 of those differed only by the extra state
  described below. Of the rest, 191 had no donor on the worker and 21 had one at
  another version.

Some things you'd want to know:

- Long-lived pipelines carry extra state: `Cap` entries left behind by advancing,
  and `EXISTS` proof rows that can differ from a fresh pipeline's. So a clone takes
  its state and rows from a single donor, and a fresh hydration isn't a valid
  reference for proof rows.
- Copying blocks the worker, because the donor could change if the copy yielded.
  Operator state is copied in bulk, so 100,000 entries take 6–9 ms in memory and
  about 50 ms once spilled to SQLite.
- To copy aggregates, `GroupBy`'s flag for whether it has been fetched moved into
  its storage, so that all of an operator's state is there.
- A hydration also waits briefly for a donor that is advancing or writing its CVR
  rows: at most half of what the donor's hydration took, capped at 250 ms. A
  hydration in progress is waited for without a limit unless it makes no progress
  for 5 s.
- A group a version behind or ahead of every donor hydrates normally. Moving it to
  the donor's version first would recover those, but the group's other queries
  would have to advance too. I didn't try it.
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
