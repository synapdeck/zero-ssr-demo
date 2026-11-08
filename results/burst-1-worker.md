# hydrationClone off vs on

500000 issues, 1000000 comments, 1 sync workers, one node, 1 first visits per page in a new Chromium context.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
navigation start to the browser's own view of the query being complete.
"Rows read" is the hydration's own count. A copy still looks up each row it sends, which
that count leaves out, so it shows why `search` gets faster and not what `list` costs.

| Page   | Query                       | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
| ------ | --------------------------- | ------------------- | ------------------- | ---------------------- | ---------------- | ----------------- |
| search | Reads a lot, returns little | 100003 → 0          | 1429 ms → 30 ms     | 3323 ms → 943 ms       | 810 ms           | -                 |
| list   | Returns what it reads       | 3400 → 0            | 31 ms → 45 ms       | 363 ms → 311 ms        | 112 ms           | -                 |
| thread | Scalar subquery             | 404 → 1             | 3 ms → 5 ms         | 154 ms → 172 ms        | 41 ms            | -                 |
| total  | Aggregate (always hydrates) | 100003 → 100003     | 734 ms → 746 ms     | 1679 ms → 1798 ms      | 837 ms           | -                 |

| Page   | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
| ------ | ----------------------- | -------------------------- | --------------------------------------- |
| search | 0 / 0                   | 0 / 0                      | 1/1 / 1/1                               |
| list   | 0 / 0                   | 0 / 0                      | 1/1 / 1/1                               |
| thread | 0 / 0                   | 0 / 0                      | 1/1 / 1/1                               |
| total  | 0 / 0                   | 0 / 0                      | 1/1 / 1/1                               |

## 16 browsers at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
| -------------- | ------ | --------- | ------------ | --------------- |
| off            | 0/16   | 752 ms    | 12465 ms     | 12478 ms        |
| on             | 16/16  | 82 ms     | 2329 ms      | 2487 ms         |

## One browser each for 5 users at once on `search`

| hydrationClone | Copied | Hydration | Browser live | Slowest browser |
| -------------- | ------ | --------- | ------------ | --------------- |
| off            | 0/5    | 765 ms    | 4018 ms      | 4023 ms         |
| on             | 5/5    | 30 ms     | 250 ms       | 314 ms          |
