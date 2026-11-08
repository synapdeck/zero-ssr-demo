_Draft for issue 3491, for review before posting._

# SSR with hydration: a working demonstration

I've been working on this issue from outside Rocicorp, and I'd rather show something running than describe an idea. This is a proposal with working code, and I don't expect it to land as is. In particular, **I can't run your private test suite**: `packages/zero-cache` has no test files in the public repo, so none of this has run against it.

It follows your comment from July: queries reused across client groups, the server connection as its own client group, and request metadata that routes a user's server and client connections together.

The demo is in its own repo, [synapdeck/zero-ssr-demo](https://github.com/synapdeck/zero-ssr-demo), with Zero as a submodule on the branch: `node run.mjs --verify` runs real Postgres, zero-cache and Chromium. [Link to the PR once opened.]

## What's there

One PR, `typedrat/ssr`, in two halves:

- **The client.** A fix for `useQuery` leaking a query when a render never commits, which **affects browsers today and is useful without the rest**. `QuerySnapshotCollector` / `QuerySnapshotProvider`, for complete HTML on the server and hydration with no empty flash. `ZeroPool`, long-lived server instances per user, so a render of a live query needs no round trip.
- **zero-cache.** `affinityKey`, which places a user's connections on one sync worker and is visible to a load balancer. `hydrationClone`, hidden and off by default: `shadow` compares hydrations with what could have been copied, and `on` copies a hydration from a group with the same `(clientSchemaKey, transformationHash)` at the same version. Plus a fuzz test.

Copying happens inside `PipelineDriver.addQuery`, which yields the same row changes a hydration does, so the view syncer and CVR paths are almost untouched. It falls back to hydrating whenever anything doesn't match.

## Results

500,000 issues, 1,000,000 comments, one node, 4 sync workers, medians of 5 first visits per page.

| Page     | Query                              | Hydration: off → on | Browser live: off → on |
| -------- | ---------------------------------- | ------------------- | ---------------------- |
| `search` | Reads ~100,000 rows, returns a few | 753 ms → 33 ms      | 866 ms → 136 ms        |
| `list`   | Returns the 3,400 rows it reads    | 24 ms → 28 ms       | 174 ms → 189 ms        |
| `thread` | Scalar subquery, 404 rows          | 2 ms → 4 ms         | 109 ms → 113 ms        |
| `total`  | Filtered count (falls back)        | 731 ms → 750 ms     | 870 ms → 926 ms        |

**Copying only helps queries that read much more than they return.** For anything else it's no faster and can be slightly slower, because the rows still have to be looked up one by one and written to the new group's CVR. For comparison, a second client joining an already-live group synced 39–71% faster than a new group on row-heavy queries, so copying CVR rows in bulk might capture some of that. I haven't tried it.

Separately from copying, later server renders of a live query took 0.4–1.3 ms through `ZeroPool`, against 18–22 ms for a new `Zero` per request in an earlier, smaller test.

### How often it copies

Those visits are 6 seconds apart, which is the best case: each browser finds a donor on a quiet worker. So I also opened browsers on `search` at once, and the copy rate depends heavily on the shape of the traffic.

| Burst, each connection staying open | Workers | Copied               | Median browser live: off → on                                     |
| ----------------------------------- | ------- | -------------------- | ----------------------------------------------------------------- |
| One browser each for 5 users        | 4       | 5/5, both runs       | 919 ms → 140 ms, and 962 ms → 1,053 ms                            |
| One browser each for 5 users        | 1       | 5/5                  | 4,018 ms → 250 ms                                                 |
| 16 browsers for one user            | 4       | 7/16, all three runs | 2,835 ms → 2,825 ms, 2,871 ms → 3,162 ms, and 2,956 ms → 7,560 ms |
| 16 browsers for one user            | 1       | 16/16                | 12,465 ms → 2,329 ms                                              |

These are few samples each. **I can't explain the two slow runs**, 1,053 ms and 7,560 ms. They came from the same run, while the machine was busier, but I haven't shown that was the cause.

One user with 16 browsers misses because `SyncerAssigner` stops honoring affinity once a worker is 4 groups above the least loaded, so most of them overflow to workers with no donor, and browsers on one worker can't copy from another. That limit trades copies for balance, and it's arbitrary. Popular shared queries, such as logged-out pages under one `affinityKey`, would hit it hardest. In a separate stress run where groups overlapped in their keepalive window, 62 hydrations copied and 60 found no donor. Some of those were first hydrations, and I didn't break down the rest.

## How I checked it

With no suite to run against, I built what I could:

- **Against real CVR data, with writes running:** 20 rounds, 32 copies, 12 pipeline resets from a scalar's value changing. 0 differences between clones and donors, 0 against fresh groups, and 0 refcount differences across 15,059 `cvr.rows` entries. As a negative control in an earlier harness, deliberately tripled refcounts, which the signature check can't see, were caught immediately.
- **Fuzz test:** `pipeline-history.test.ts` drives seeded writes through real `PipelineDriver`s, comparing long-lived pipelines to fresh ones and clones to donors. It found a real bug during development: `Join` and `FlippedJoin` build their own `JoinIndex`, and copies were silently losing child rows. It uses a stand-in for the CVR row list, so it doesn't cover that path by itself.
- **Shadow mode:** of 115 hydrations under writes on real data, 59 had a usable donor to compare with, and none conflicted. 29 of those differed only by the extra state described below.

## Things you'd want to know

- **Long-lived pipelines hold extra state.** Advancing leaves `Cap` entries behind that a fresh hydration wouldn't have, and `EXISTS` can legitimately keep different proof rows than a fresh pipeline. So a clone must take its state and rows from one donor, and a fresh hydration isn't a valid reference for proof rows.
- **Copying can block a worker.** About 100,000 state entries took 36–43 ms in one uninterrupted step, because the donor's state could change if it yielded.
- **A render right after a write is stale.** Replica lag means a render immediately after a Postgres commit showed old data 8 times out of 8. Live sync should correct it once hydrated, but a form post and redirect could briefly show old data, and a crawler could keep it. A real fix needs a way to wait for a replica version.
- **Aggregates hydrate normally.** `GroupBy`'s `#hydrated` flag, synthetic rows and query IDs in table names all need handling.
- **The hold has a user-visible cost.** On a first visit, a user's own edit stays hidden until the server confirms the query, which from reading the code should be about a minute at worst on a stuck connection (not measured). Returning visitors with `cached` rows see it immediately.
- **Multiple nodes are untested.** Pod-level routing needs the load balancer to hash on `affinityKey`. I confirmed that Envoy can do this (`MAGLEV` and a `query_parameter` hash policy) with WebSocket upgrades, against stand-in pods, and through to a real zero-cache with one upstream. I didn't test draining or scaling.

## What I'd like your read on

1. **Is copying state the right approach, or do you want one shared pipeline per query?** Your shared-advance telemetry suggests you may be heading there. Copying leaves advancement as it is, so each group still pays for that, but it's much less invasive.
2. **Is the first-visit hold acceptable?** It's the main user-facing trade-off in the hydration design.
3. **Would you rather review it in pieces?** The commits are ordered so the client half comes first and doesn't depend on any `zero-cache` changes, and the first commit, the `useQuery` leak fix, stands alone. I'm happy to split either out.
