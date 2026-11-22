## 一句话思路
把每个格子拆成「顺着传送带走（代价 0）」和「改方向走（代价 1）」两种边，跑 0-1 BFS 求 start 到 end 的最小代价。

## 怎么做
1. 建 `dist` 二维数组，全部初始化为 `2**31 - 1`，`dist[start[0]][start[1]] = 0`，用双端队列 `dq` 存 `(i, j)`。
2. 每次从队首弹出 `(i, j)`，枚举四个方向 `(di, dj)`，算出 `ni, nj`，越界就跳过。
3. 若 `matrix[i][j]` 指向的方向恰好是 `(di, dj)`，则 `w = 0`，否则 `w = 1`；`nd = dist[i][j] + w`，若 `nd < dist[ni][nj]` 就更新，`w == 0` 时 `appendleft`，否则 `append`。
4. 队列空后返回 `dist[end[0]][end[1]]`。

以示例 1 的 `matrix = [">>v","v^<","<><"]`、`start = [0,1]` 为例：从 `(0,1)` 出发，`matrix[0][1]` 是 `'>'`，向右到 `(0,2)` 代价 0；向下到 `(1,1)` 代价 1。到 `(1,1)` 时 `matrix[1][1]` 是 `'^'`，向左到 `(1,0)` 代价 1，累计 `dist[1][0] = 2`；但若在 `(1,1)` 施法改成 `'<'`，则向左代价 0，`dist[1][0] = 1`，再顺 `matrix[1][0] = 'v'` 到 `(2,0)` 仍是 1，与答案一致。

```python
from collections import deque
INF = 2**31 - 1
dist = [[INF] * len(matrix[0]) for _ in range(len(matrix))]
dist[start[0]][start[1]] = 0
dq = deque([tuple(start)])
dirs = {'^': (-1, 0), 'v': (1, 0), '<': (0, -1), '>': (0, 1)}
while dq:
    i, j = dq.popleft()
    for ch, (di, dj) in dirs.items():
        ni, nj = i + di, j + dj
        if not (0 <= ni < len(matrix) and 0 <= nj < len(matrix[0])):
            continue
        w = 0 if matrix[i][j] == ch else 1
        if dist[i][j] + w < dist[ni][nj]:
            dist[ni][nj] = dist[i][j] + w
            (dq.appendleft if w == 0 else dq.append)((ni, nj))
return dist[end[0]][end[1]]
```

## 复杂度
时间：`O(m*n)`，每个格子最多入队常数次，边权只有 0/1。
空间：`O(m*n)`，`dist` 表加双端队列，`m`、`n` 为行列数。

## 易错点
- 用普通 BFS 按层数当步数：示例 1 中 `(0,1)→(0,2)→(1,2)` 是 2 层但代价 0，会错答 2；必须用 0-1 BFS 或 Dijkstra，代价 0 的边 `appendleft`。
- 把「施法」理解成永久改方向：示例 1 里 `(1,1)` 改成 `'<'` 只对这一次经过生效，之后 `matrix` 不变；若真去改 `matrix[1][1]`，后续从别的路径回到 `(1,1)` 会算出错误代价。

## 如果面试官追问
若要求输出具体施法位置序列？答：在 `dist` 更新时额外记 `pre[ni][nj] = (i, j)` 和该步是否施法，最后从 `end` 回溯到 `start` 即得方案。
