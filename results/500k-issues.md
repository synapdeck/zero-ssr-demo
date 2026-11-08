# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 5 first visits per page in a new Chromium context.

"Hydration" is what zero-cache logged for the browser's client group. "Browser live" is
navigation start to the browser's own view of the query being complete.
"Rows read" is the hydration's own count. A copy still looks up each row it sends, which
that count leaves out, so it shows why `search` gets faster and not what `list` costs.

| Page   | Query                       | Rows read: off → on | Hydration: off → on | Browser live: off → on | First SSR render | Later SSR renders |
| ------ | --------------------------- | ------------------- | ------------------- | ---------------------- | ---------------- | ----------------- |
| search | Reads a lot, returns little | 100003 → 0          | 753 ms → 33 ms      | 866 ms → 136 ms        | 869 ms           | 0.5 ms            |
| list   | Returns what it reads       | 3400 → 0            | 24 ms → 28 ms       | 174 ms → 189 ms        | 103 ms           | 1.3 ms            |
| thread | Scalar subquery             | 404 → 1             | 2 ms → 4 ms         | 109 ms → 113 ms        | 27 ms            | 0.5 ms            |
| total  | Aggregate (always hydrates) | 100003 → 100003     | 731 ms → 750 ms     | 870 ms → 926 ms        | 821 ms           | 0.4 ms            |

| Page   | Empty flashes: off / on | Hydration errors: off / on | Live updates reached the page: off / on |
| ------ | ----------------------- | -------------------------- | --------------------------------------- |
| search | 0 / 0                   | 0 / 0                      | 5/5 / 5/5                               |
| list   | 0 / 0                   | 0 / 0                      | 5/5 / 5/5                               |
| thread | 0 / 0                   | 0 / 0                      | 5/5 / 5/5                               |
| total  | 0 / 0                   | 0 / 0                      | 5/5 / 5/5                               |

## Verification with writes running

| Rounds | Copies | Scalar resets | Clone vs donor differences | Clone vs fresh differences | CVR rows compared | CVR refcount differences | Hydration failures |
| ------ | ------ | ------------- | -------------------------- | -------------------------- | ----------------- | ------------------------ | ------------------ |
| 20     | 32     | 12            | 0                          | 0                          | 15059             | 0                        | 0                  |
