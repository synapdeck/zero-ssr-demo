# zero-ssr-demo

A demo for [Zero issue 3491](https://bugs.rocicorp.dev/p/zero/issue/3491) (SSR).
It runs Postgres, zero-cache and Chromium, and compares `hydrationClone` off and
on. Zero is the `mono` submodule, on the `typedrat/ssr` branch of
[synapdeck/rocicorp-mono](https://github.com/synapdeck/rocicorp-mono). You need
Docker, Node 24 and pnpm.

```sh
git clone --recurse-submodules https://github.com/synapdeck/zero-ssr-demo
cd zero-ssr-demo
pnpm zero                              # Builds Zero from the submodule
pnpm exec playwright install chromium

pnpm bench             # About 5 minutes
pnpm bench --verify    # About 10 minutes, and also checks CVR data
```

`@rocicorp/zero` is installed from `mono/packages/zero`, so after changing the
submodule, run `pnpm zero` again to rebuild it and reinstall.

The app is in `src/`: the SSR and query servers, and the browser bundle.
`bench/` starts Postgres with Testcontainers, zero-cache, the servers and
Chromium, and stops them all when it finishes. It uses ports 17601 to 17849,
prints the results and writes them to `.build/results.md`. zero-cache's log goes
to `.build/zero-cache.log`, with a copy kept for each phase. `results/` has runs from my machine.

| Option            | Default |                                                                     |
| ----------------- | ------- | ------------------------------------------------------------------- |
| `--issues`        | 500000  | Issues to seed, with twice as many comments                         |
| `--visits`        | 5       | First visits per page, each in a new browser context. 0 skips them. |
| `--workers`       | 4       | Sync workers                                                        |
| `--burst`         | 0       | Also open this many browsers at once on `search`, and 1 per 5 users |
| `--burst-runs`    | 1       | Repeat the bursts, alternating off and on                           |
| `--verify`        | off     | Also check CVR data                                                 |
| `--verify-rounds` | 3       | Rounds of those checks                                              |
| `--ssr-zero`      | pool    | `pool`, `per-request` or `fresh`: how the SSR server gets a `Zero`  |

The SSR server renders each page from a long-lived `Zero` instance for the user,
kept in `src/server/zero-pool.ts`. Chromium then hydrates the page and connects
as its own client group, so zero-cache runs each query twice: once for the
server's group, and once for the browser's. Copying the hydration targets the
second run.

| Page     | Query                                      | Shows                                                     |
| -------- | ------------------------------------------ | --------------------------------------------------------- |
| `search` | Reads every issue a user owns, returns few | The best case                                             |
| `list`   | Top 1,000 issues with comments             | Little gain, because rows still go to the new group's CVR |
| `thread` | Scalar subquery                            | Scalar subqueries can be copied                           |
| `total`  | Filtered count                             | Aggregates fall back to a normal hydration                |

Each visit also commits a write and checks that it reaches the page. `--verify`
runs a client group next to a donor while writes happen, including writes that
change a scalar's value. The clone must match its donor and a fresh group, and its
`cvr.rows` refcounts must equal the donor's.

It doesn't test multiple zero-cache nodes (routing on `affinityKey` was only tried
with Envoy and stand-in pods), zero-cache's private test suite, or real data and
load.
