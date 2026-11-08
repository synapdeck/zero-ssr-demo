# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 1 first visits per page in a new Chromium context.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
navigation start to the browser's own view of the query being complete.
"Rows read" is the hydration's own count. A copy still looks up each row it sends, which
that count leaves out, so it shows why `search` gets faster and not what `list` costs.

| Page   | Query                       | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
| ------ | --------------------------- | ------------------- | ------------------- | ---------------------- | ---------------- | ----------------- |
| search | Reads a lot, returns little | 100003 → 0          | 710 ms → 30 ms      | 1656 ms → 986 ms       | 849 ms           | -                 |
| list   | Returns what it reads       | 3400 → 0            | 23 ms → 41 ms       | 304 ms → 284 ms        | 97 ms            | -                 |
| thread | Scalar subquery             | 404 → 1             | 3 ms → 4 ms         | 133 ms → 150 ms        | 31 ms            | -                 |
| total  | Aggregate (always hydrates) | 100003 → 100003     | 681 ms → 741 ms     | 1522 ms → 1734 ms      | 829 ms           | -                 |

| Page   | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
| ------ | ----------------------- | -------------------------- | --------------------------------------- |
| search | 0 / 0                   | 0 / 0                      | 1/1 / 1/1                               |
| list   | 0 / 0                   | 0 / 0                      | 1/1 / 1/1                               |
| thread | 0 / 0                   | 0 / 0                      | 1/1 / 1/1                               |
| total  | 0 / 0                   | 0 / 0                      | 1/1 / 1/1                               |

## 16 browsers at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
| -------------- | ------ | --------- | ------------ | --------------- |
| off            | 0/16   | 846 ms    | 2835 ms      | 5807 ms         |
| on             | 7/16   | 807 ms    | 2825 ms      | 2982 ms         |

## One browser each for 5 users at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
| -------------- | ------ | --------- | ------------ | --------------- |
| off            | 0/5    | 770 ms    | 919 ms       | 1684 ms         |
| on             | 5/5    | 34 ms     | 140 ms       | 206 ms          |
