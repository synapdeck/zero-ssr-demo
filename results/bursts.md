# hydrationClone off vs on

500000 issues, 1000000 comments, 4 sync workers, one node, 0 first visits per page, each in a new Chromium context. SSR instances: `pool`.


## 16 browsers for one user at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/16 | 812 ms | 2818 ms | 5983 ms |
| 1 | on | 7/16 | 816 ms | 2977 ms | 3026 ms |
| 2 | off | 0/16 | 810 ms | 2838 ms | 6002 ms |
| 2 | on | 7/16 | 791 ms | 2946 ms | 2985 ms |
| 3 | off | 0/16 | 792 ms | 2815 ms | 5889 ms |
| 3 | on | 7/16 | 783 ms | 2814 ms | 2895 ms |
| 4 | off | 0/16 | 803 ms | 2735 ms | 5958 ms |
| 4 | on | 7/16 | 779 ms | 2823 ms | 2926 ms |
| 5 | off | 0/16 | 785 ms | 2737 ms | 5727 ms |
| 5 | on | 7/16 | 778 ms | 2843 ms | 2902 ms |
| 6 | off | 0/16 | 858 ms | 2999 ms | 5972 ms |
| 6 | on | 7/16 | 845 ms | 3076 ms | 3128 ms |

## One browser each for 5 users at once on `search`

| Run | hydrationClone | Copied | Hydration | Browser live | Slowest browser |
|---|---|---|---|---|---|
| 1 | off | 0/5 | 777 ms | 912 ms | 1755 ms |
| 1 | on | 5/5 | 51 ms | 174 ms | 253 ms |
| 2 | off | 0/5 | 811 ms | 948 ms | 1845 ms |
| 2 | on | 5/5 | 50 ms | 180 ms | 269 ms |
| 3 | off | 0/5 | 796 ms | 934 ms | 1832 ms |
| 3 | on | 5/5 | 51 ms | 176 ms | 238 ms |
| 4 | off | 0/5 | 801 ms | 934 ms | 1844 ms |
| 4 | on | 5/5 | 44 ms | 158 ms | 214 ms |
| 5 | off | 0/5 | 765 ms | 892 ms | 1728 ms |
| 5 | on | 5/5 | 49 ms | 172 ms | 256 ms |
| 6 | off | 0/5 | 781 ms | 907 ms | 1742 ms |
| 6 | on | 5/5 | 49 ms | 193 ms | 256 ms |
