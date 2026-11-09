# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `pool`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 737 ms → 32 ms | 864 ms → 137 ms | 824 ms | 0.8 ms |
| list | Returns what it reads | 3400 → 0 | 22 ms → 27 ms | 161 ms → 163 ms | 127 ms | 1.9 ms |
| thread | Scalar subquery | 404 → 1 | 2 ms → 5 ms | 106 ms → 103 ms | 30 ms | 0.6 ms |
| total | Aggregate (always hydrates) | 100003 → 100003 | 706 ms → 746 ms | 852 ms → 920 ms | 886 ms | 0.6 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |

## 16 browsers for one user at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|
| off | 0/16 | 792 ms | 2731 ms | 5800 ms |
| on | 7/16 | 1194 ms | 4336 ms | 5332 ms |

## One browser each for 5 users at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|
| off | 0/5 | 813 ms | 987 ms | 1830 ms |
| on | 5/5 | 46 ms | 164 ms | 250 ms |

## Verification with writes running

| Checks | Copies | Scalar resets | Clone vs donor differences | Clone vs fresh differences | CVR rows compared | CVR refcount differences | Hydration failures |
|---|---|---|---|---|---|---|---|
| 105 | 184 | 80 | 0 | 0 | 74649 | 0 | 0 |
