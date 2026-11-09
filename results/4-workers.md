# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `pool`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 760 ms → 7 ms | 885 ms → 108 ms | 830 ms | 0.8 ms |
| list | Returns what it reads | 3400 → 0 | 30 ms → 26 ms | 177 ms → 162 ms | 101 ms | 1.9 ms |
| thread | Scalar subquery | 404 → 1 | 3 ms → 4 ms | 109 ms → 112 ms | 27 ms | 0.7 ms |
| total | Filtered count | 100003 → 0 | 741 ms → 9 ms | 843 ms → 97 ms | 787 ms | 0.5 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |

## Verification with writes running

| Checks | Copies | Scalar resets | Clone vs donor differences | Clone vs fresh differences | CVR rows compared | CVR refcount differences | Hydration failures |
|---|---|---|---|---|---|---|---|
| 105 | 225 | 80 | 0 | 0 | 75195 | 0 | 0 |
