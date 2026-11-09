# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 0 first visits per page, each in a new Chromium context. SSR instances: `pool`.


## 16 browsers for one user at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/16 | 782 ms | 3460 ms | 4261 ms |
| 1 | on | 13/16 | 12 ms | 1135 ms | 1169 ms |
| 2 | off | 0/16 | 915 ms | 4041 ms | 4841 ms |
| 2 | on | 13/16 | 11 ms | 1122 ms | 1143 ms |
| 3 | off | 0/16 | 788 ms | 3510 ms | 4247 ms |
| 3 | on | 13/16 | 12 ms | 1117 ms | 1163 ms |

## One browser each for 5 users at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/5 | 761 ms | 908 ms | 1640 ms |
| 1 | on | 5/5 | 9 ms | 123 ms | 158 ms |
| 2 | off | 0/5 | 758 ms | 1669 ms | 1702 ms |
| 2 | on | 5/5 | 10 ms | 135 ms | 169 ms |
| 3 | off | 0/5 | 811 ms | 1000 ms | 1781 ms |
| 3 | on | 5/5 | 8 ms | 123 ms | 166 ms |
