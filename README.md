# zero-ssr-demo

A demo for [Zero issue 3491](https://bugs.rocicorp.dev/p/zero/issue/3491) (SSR).
It runs Postgres, zero-cache and Chromium, and compares `hydrationClone` off and
on. Zero is the `mono` submodule, on the `typedrat/ssr` branch of
[synapdeck/rocicorp-mono](https://github.com/synapdeck/rocicorp-mono). You need
Docker, Node 24 and pnpm.

```sh
git clone --recurse-submodules https://github.com/synapdeck/zero-ssr-demo
cd zero-ssr-demo
(cd mono && pnpm install && pnpm exec playwright install chromium)

node run.mjs            # About 5 minutes
node run.mjs --verify   # About 10 minutes, and also checks CVR data
```

Set `ZERO_MONO` to use a different checkout of Zero. The demo uses ports 17544 to 17849. It prints the results and writes them to `.build/results.md`, and
zero-cache's log goes to `.build/zero-cache.log`. `results/` has runs from my
machine.

| Option            | Default |                                                                     |
| ----------------- | ------- | ------------------------------------------------------------------- |
| `--issues`        | 500000  | Issues to seed, with twice as many comments                         |
| `--visits`        | 5       | First visits per page, each in a new browser context                |
| `--workers`       | 4       | Sync workers                                                        |
| `--burst`         | 0       | Also open this many browsers at once on `search`, and 1 per 5 users |
| `--verify`        | off     | Also check CVR data                                                 |
| `--verify-rounds` | 3       | Rounds of those checks                                              |

The SSR server renders each page from a long-lived `ZeroPool` instance. Chromium
then hydrates the page and connects as its own client group, so zero-cache runs
each query twice: once for the server's group, and once for the browser's.
Copying the hydration targets the second run.

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
