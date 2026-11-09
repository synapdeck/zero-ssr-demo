# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `fresh`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 734 ms → 9 ms | 1648 ms → 152 ms | 831 ms | 38.2 ms |
| list | Returns what it reads | 3400 → 0 | 26 ms → 27 ms | 255 ms → 241 ms | 93 ms | 83.2 ms |
| thread | Scalar subquery | 404 → 1 | 3 ms → 3 ms | 151 ms → 128 ms | 27 ms | 23.8 ms |
| total | Filtered count | 100003 → 0 | 730 ms → 8 ms | 1591 ms → 123 ms | 780 ms | 32.4 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
