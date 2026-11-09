# hydrationClone off vs on

500000 issues, 1000000 comments, 1 sync workers, one node, 5 first visits per page, each in a new Chromium context. SSR instances: `pool`.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
the time from navigation start until the browser's own view of the query is complete.
"Rows read" leaves out the rows a copy looks up to send, so it shows why `search` gets
faster but not what `list` costs.

| Page | Query | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
|---|---|---|---|---|---|---|
| search | Reads a lot, returns little | 100003 → 0 | 743 ms → 32 ms | 863 ms → 127 ms | 875 ms | 0.8 ms |
| list | Returns what it reads | 3400 → 0 | 28 ms → 74 ms | 187 ms → 334 ms | 108 ms | 10.0 ms |
| thread | Scalar subquery | 404 → 1 | 2 ms → 4 ms | 112 ms → 111 ms | 31 ms | 0.7 ms |
| total | Aggregate (always hydrates) | 100003 → 100003 | 737 ms → 757 ms | 841 ms → 1058 ms | 810 ms | 0.6 ms |

| Page | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
|---|---|---|---|
| search | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| list | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| thread | 0 / 0 | 0 / 0 | 5/5 / 5/5 |
| total | 0 / 0 | 0 / 0 | 5/5 / 5/5 |

## 16 browsers for one user at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|
| off | 0/16 | 750 ms | 12548 ms | 12558 ms |
| on | 16/16 | 37 ms | 926 ms | 981 ms |

## One browser each for 5 users at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|
| off | 0/5 | 797 ms | 4237 ms | 4245 ms |
| on | 5/5 | 48 ms | 440 ms | 446 ms |
