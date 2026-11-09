# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `per-request`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 726 ms → 40 ms | 880 ms → 169 ms | 810 ms | 23.9 ms |
| list | Returns what it reads | 3400 → 0 | 22 ms → 25 ms | 239 ms → 265 ms | 211 ms | 107.8 ms |
| thread | Scalar subquery | 404 → 1 | 2 ms → 3 ms | 788 ms → 179 ms | 91 ms | 74.1 ms |
| total | Aggregate (always hydrates) | 100003 → 100003 | 721 ms → 698 ms | 1604 ms → 1635 ms | 783 ms | 1584.0 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |

## 16 browsers for one user at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|
| off | 0/16 | 777 ms | 2895 ms | 5631 ms |
| on | 7/16 | 770 ms | 2764 ms | 2873 ms |

## One browser each for 5 users at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|
| off | 0/5 | 769 ms | 916 ms | 1732 ms |
| on | 5/5 | 44 ms | 187 ms | 246 ms |
