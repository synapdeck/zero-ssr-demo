# hydrationClone off vs on

500000 issues, 1000000 comments, 1 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `pool`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 832 ms → 9 ms | 956 ms → 113 ms | 865 ms | 0.8 ms |
| list | Returns what it reads | 3400 → 0 | 29 ms → 29 ms | 183 ms → 175 ms | 111 ms | 1.8 ms |
| thread | Scalar subquery | 404 → 1 | 2 ms → 4 ms | 101 ms → 117 ms | 28 ms | 0.7 ms |
| total | Filtered count | 100003 → 0 | 725 ms → 9 ms | 820 ms → 95 ms | 789 ms | 0.5 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |

## 16 browsers for one user at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/16 | 730 ms | 12232 ms | 12244 ms |
| 1 | on | 16/16 | 8 ms | 474 ms | 494 ms |
| 2 | off | 0/16 | 743 ms | 12368 ms | 12378 ms |
| 2 | on | 16/16 | 9 ms | 496 ms | 512 ms |
| 3 | off | 0/16 | 732 ms | 12203 ms | 12234 ms |
| 3 | on | 16/16 | 8 ms | 528 ms | 536 ms |

## One browser each for 5 users at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/5 | 712 ms | 3756 ms | 3759 ms |
| 1 | on | 5/5 | 8 ms | 209 ms | 214 ms |
| 2 | off | 0/5 | 720 ms | 3793 ms | 3794 ms |
| 2 | on | 5/5 | 8 ms | 195 ms | 199 ms |
| 3 | off | 0/5 | 706 ms | 3713 ms | 3716 ms |
| 3 | on | 5/5 | 8 ms | 196 ms | 199 ms |
