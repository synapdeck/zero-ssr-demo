# SSR and hydration copying demo

A reproducible demonstration for
[issue 3491](https://bugs.rocicorp.dev/p/zero/issue/3491), SSR for Zero. This is a
proposal with working code, not something finished: see "What this doesn't show"
below.

It runs real Postgres, real zero-cache, and real Chromium, and compares
`hydrationClone` off and on. Zero comes from the `mono` submodule, which tracks
the branch proposed upstream, so this repo holds only the demo.

## Running it

You need Docker, Node 24 and pnpm.

```sh
git submodule update --init
(cd mono && pnpm install && pnpm exec playwright install chromium)

node run.mjs            # Timings, about 5 minutes
node run.mjs --verify   # Also checks CVR data, about 10 minutes
```

To test another checkout of Zero instead, such as a newer push of the branch, set
`ZERO_MONO` to its path. `git submodule update --remote` moves the submodule to
the branch's latest commit.

It starts everything it needs on ports 17544 to 17849, and stops it all when it
finishes. The results are printed and written to `.build/results.md`, and
`results/500k-issues.md` holds a run at the default size. After a failure the
zero-cache log stays in `.build/zero-cache.log`.

| Option            | Default |                                                                            |
| ----------------- | ------- | -------------------------------------------------------------------------- |
| `--issues`        | 500000  | Issues to seed, with twice as many comments                                |
| `--visits`        | 5       | First visits per page, each in a new browser context                       |
| `--workers`       | 4       | Sync workers                                                               |
| `--burst`         | 0       | Also open this many browsers at once on `search`, and one each for 5 users |
| `--verify`        | off     | Also run the checks against CVR data                                       |
| `--verify-rounds` | 3       | Rounds of those checks                                                     |

## What it runs

An SSR server renders each page from a long-lived instance in a `ZeroPool`, and
Chromium hydrates it and connects as its own client group. That is the double
hydration in the issue: zero-cache runs the same query for the server's group and
again for the browser's.

| Page     | Query                                         | What it shows                                                                                    |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `search` | Reads every issue a user owns to return a few | Where copying helps most                                                                         |
| `list`   | Top 1,000 issues with comments                | Where it barely helps, because the rows still have to be read and written to the new group's CVR |
| `thread` | A scalar subquery                             | That those can be copied                                                                         |
| `total`  | A filtered count                              | The fallback: aggregates always hydrate                                                          |

Each visit also commits a write and checks that it reaches the page, because a
copy that stopped updating would look fine until then.

`--verify` runs a client group next to a donor while writes run, including writes
that change a scalar's value and reset the pipelines. A clone has to show what its
donor shows, and match a fresh group. Its reference counts in `cvr.rows` have to
equal the donor's, since wrong ones would drop rows too early or keep them forever.

## The branch

`typedrat/ssr` holds everything: a fix for `useQuery` leaking a query when a
render never commits, `QuerySnapshotCollector` and `QuerySnapshotProvider` from
server render to hydration, `ZeroPool` for long-lived instances per user,
`affinityKey` so that a user's connections share a worker, and copying hydrations
behind `hydrationClone`.

## What this doesn't show

- **Multiple nodes.** It runs one zero-cache. Across nodes, a load balancer has to
  route on `affinityKey`, which was only tried with Envoy against stand-in pods.
- **The rest of zero-cache's tests.** They aren't in the public repo, so this has
  never run against them.
- **Production load.** The data is synthetic and the numbers are from one machine.
