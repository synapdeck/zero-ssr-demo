# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 0 first visits per page, each in a new Chromium context. SSR instances: `pool`.


## Verification with writes running

hydrationClone=shadow.

| Checks | Copies | Scalar resets | Clone vs donor differences | Clone vs fresh differences | CVR rows compared | CVR refcount differences | Hydration failures |
|---|---|---|---|---|---|---|---|
| 105 | 0 | 80 | 0 | 0 | 75092 | 0 | 0 |

Hydrations that weren't copied, by what a comparison with a donor found:

| Outcome | Hydrations |
|---|---|
| donor-has-extra-state | 77 |
| match | 166 |
| no-donor | 191 |
| version-mismatch | 21 |
