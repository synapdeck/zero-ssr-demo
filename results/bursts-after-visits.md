# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `pool`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 770 ms → 44 ms | 921 ms → 157 ms | 903 ms | 0.8 ms |
| list | Returns what it reads | 3400 → 0 | 23 ms → 31 ms | 179 ms → 199 ms | 110 ms | 2.5 ms |
| thread | Scalar subquery | 404 → 1 | 2 ms → 4 ms | 105 ms → 110 ms | 24 ms | 0.7 ms |
| total | Aggregate (always hydrates) | 100003 → 100003 | 735 ms → 719 ms | 844 ms → 897 ms | 838 ms | 0.5 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |

## 16 browsers for one user at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/16 | 817 ms | 2760 ms | 6052 ms |
| 1 | on | 7/16 | 796 ms | 2901 ms | 2947 ms |
| 2 | off | 0/16 | 780 ms | 2702 ms | 5706 ms |
| 2 | on | 7/16 | 772 ms | 2759 ms | 2834 ms |
| 3 | off | 0/16 | 779 ms | 2669 ms | 5657 ms |
| 3 | on | 7/16 | 762 ms | 2744 ms | 2823 ms |

## One browser each for 5 users at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/5 | 773 ms | 924 ms | 1700 ms |
| 1 | on | 5/5 | 51 ms | 167 ms | 217 ms |
| 2 | off | 0/5 | 776 ms | 898 ms | 1745 ms |
| 2 | on | 5/5 | 48 ms | 169 ms | 218 ms |
| 3 | off | 0/5 | 773 ms | 901 ms | 1734 ms |
| 3 | on | 5/5 | 44 ms | 159 ms | 218 ms |
