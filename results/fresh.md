# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `fresh`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 729 ms → 32 ms | 1600 ms → 189 ms | 843 ms | 64.8 ms |
| list | Returns what it reads | 3400 → 0 | 22 ms → 28 ms | 243 ms → 254 ms | 106 ms | 89.5 ms |
| thread | Scalar subquery | 404 → 1 | 2 ms → 3 ms | 129 ms → 136 ms | 25 ms | 28.2 ms |
| total | Aggregate (always hydrates) | 100003 → 100003 | 690 ms → 731 ms | 1539 ms → 1688 ms | 753 ms | 833.0 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |

## 16 browsers for one user at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|
| off | 0/32 | 786 ms | 9632 ms | 12609 ms |
| on | 17/32 | 70 ms | 4620 ms | 4902 ms |

## One browser each for 5 users at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|
| off | 0/10 | 773 ms | 1697 ms | 3226 ms |
| on | 10/10 | 43 ms | 227 ms | 358 ms |
