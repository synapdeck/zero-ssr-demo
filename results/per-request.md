# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `per-request`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 779 ms → 12 ms | 1229 ms → 131 ms | 894 ms | 24.5 ms |
| list | Returns what it reads | 3400 → 0 | 27 ms → 31 ms | 298 ms → 421 ms | 213 ms | 296.9 ms |
| thread | Scalar subquery | 404 → 1 | 3 ms → 5 ms | 254 ms → 346 ms | 99 ms | 470.6 ms |
| total | Filtered count | 100003 → 0 | 783 ms → 11 ms | 1955 ms → 947 ms | 852 ms | 946.7 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
