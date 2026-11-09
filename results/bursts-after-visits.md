# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `pool`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 744 ms → 8 ms | 867 ms → 109 ms | 824 ms | 0.8 ms |
| list | Returns what it reads | 3400 → 0 | 26 ms → 27 ms | 192 ms → 178 ms | 133 ms | 1.7 ms |
| thread | Scalar subquery | 404 → 1 | 3 ms → 4 ms | 113 ms → 114 ms | 30 ms | 0.7 ms |
| total | Filtered count | 100003 → 0 | 725 ms → 10 ms | 828 ms → 111 ms | 841 ms | 0.6 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |

## 16 browsers for one user at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/16 | 815 ms | 3672 ms | 4377 ms |
| 1 | on | 13/16 | 15 ms | 1189 ms | 1203 ms |
| 2 | off | 0/16 | 813 ms | 3649 ms | 4413 ms |
| 2 | on | 13/16 | 13 ms | 1123 ms | 1177 ms |
| 3 | off | 0/16 | 797 ms | 3502 ms | 3514 ms |
| 3 | on | 13/16 | 13 ms | 1146 ms | 1209 ms |

## One browser each for 5 users at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/5 | 759 ms | 1699 ms | 1706 ms |
| 1 | on | 5/5 | 10 ms | 137 ms | 169 ms |
| 2 | off | 0/5 | 1067 ms | 2322 ms | 2357 ms |
| 2 | on | 5/5 | 9 ms | 115 ms | 152 ms |
| 3 | off | 0/5 | 762 ms | 946 ms | 1661 ms |
| 3 | on | 5/5 | 10 ms | 128 ms | 186 ms |
