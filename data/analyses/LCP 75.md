## 一句话思路
对每个空地算「被传送后到 T 的最短路」，小扣走一条路使沿途该值的最大值最小，二分答案 + BFS 可达性判定。

## 怎么做
1. 从 T 出发 BFS 得 `dist[i][j]`（不可达记 `INF`），这是传送落点到水晶的步数。
2. 对每个空地 `(i,j)`，取四个镜像落点中 `dist` 最大者记为 `cost[i][j]`（守护者选最坏落点；落点为墙或越界则跳过，全非法则该格不可被传送）。
3. 二分答案 `k`：只允许走 `cost <= k` 的空地（S 起点不受限），BFS 看能否从 S 到 T。
4. 最小可行 `k` 即答案；若 `k = INF` 都不可行返回 -1。

以示例 1 为例：`maze[2][0]` 是空地，水平镜像到 `[2][4]`（`.`），`dist[2][4] = 7`；竖直镜像到 `[0][0]`，`dist` 更小，故 `cost[2][0] = 7`。二分到 `k = 7` 时该格放行，路径连通，答案 7。

```python
from collections import deque
INF = 10**9
# dist: 从 T 出发的 BFS 距离
def ok(k):
    if cost[sr][sc] > k and (sr, sc) != (sr, sc):  # S 起点不设限
        pass
    seen = [[False]*n for _ in range(n)]
    q = deque([(sr, sc)]); seen[sr][sc] = True
    while q:
        r, c = q.popleft()
        if (r, c) == (tr, tc): return True
        for dr, dc in dirs:
            nr, nc = r+dr, c+dc
            if 0 <= nr < n and 0 <= nc < n and not seen[nr][nc] \
               and maze[nr][nc] != '#' and cost[nr][nc] <= k:
                seen[nr][nc] = True; q.append((nr, nc))
    return False
```

## 复杂度
时间：两次 BFS 各 O(n²)，二分 O(log(4n²)) 轮、每轮 BFS O(n²)，合计 O(n² log n)。
空间：`dist`、`cost`、`seen` 各 O(n²)，队列 O(n²)。

## 易错点
- 示例 3 中 `[2][1]` 的水平镜像就是自身，`cost` 取 `dist[2][1]` 而非跳过；若把「落点等于原点」当非法丢弃，该格 `cost` 变 `INF`，路径被误封，答案偏大或 -1。
- 示例 2 中 `[3][2]` 竖直镜像到 `[0][2]` 是 `#`，只剩水平镜像 `[3][0]` 是 `#` 也非法，该格 `cost = INF`；若把非法落点当 0 处理，会误判可走，输出有限值而非 -1。

## 如果面试官追问
问：n 放大到 2000 怎么办？答：二分换成按 `cost` 排序后并查集增量加边，O(n² α) 免去 log 因子。
