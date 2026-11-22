## 一句话思路
先对 S、每个 M、每个 O 做 BFS 得两两距离，再用状压 DP 求「按某顺序触发全部机关」的最短路径。

## 怎么做
1. 把 S、T、所有 M、所有 O 的坐标收集成 `pts`，从每个点跑一次 BFS，得到 `dist[i][j]`；不可达记 `INF`。
2. 预处理 `toM[i][j]`：从机关 i 出发，经某个石堆 O 到机关 j 的最短距离，即 `min(dist[i][o] + dist[o][j])`。
3. 状压 DP：`dp[mask][i]` 表示已触发 `mask` 集合、最后停在机关 i 的最小步数，转移 `dp[mask|1<<j][j] = min(dp[mask][i] + toM[i][j])`。
4. 答案是 `min(dp[full][i] + dist[i][T])`，起点到第一个机关用 `min(dist[S][o] + dist[o][i])`。

以示例 1 `["S#O","M..","M.T"]` 为例：S=(0,0)，O=(0,2)，M0=(1,0)，M1=(2,0)，T=(2,2)。`dist[S][O]=4`，`dist[O][M0]=3`，`dist[O][M1]=4`，`dist[M0][O]=3`，`dist[M1][T]=2`。初始 `dp[01][0]=4+3=7`，转移 `dp[11][1]=7+3+4=14`，加 `dist[M1][T]=2` 得 16。

```python
INF = 2**31 - 1
# dist: 所有关键点两两 BFS 距离
toM = [[min(dist[i][o] + dist[o][j] for o in O_idx) for j in M_idx] for i in M_idx]
dp = [[INF] * m for _ in range(1 << m)]
for i in range(m):
    dp[1 << i][i] = min(dist[S][o] + dist[o][M_idx[i]] for o in O_idx)
for mask in range(1 << m):
    for i in range(m):
        if dp[mask][i] == INF: continue
        for j in range(m):
            if mask >> j & 1: continue
            dp[mask | 1 << j][j] = min(dp[mask | 1 << j][j], dp[mask][i] + toM[i][j])
ans = min(dp[(1 << m) - 1][i] + dist[M_idx[i]][T] for i in range(m)) if m else dist[S][T]
```

## 复杂度
时间：BFS 是 O((M+O)·R·C)，DP 是 O(2^M·M²)，M≤16。
空间：`dist` 开 (M+O+2)²，`dp` 开 2^M·M，BFS 队列 O(R·C)。

## 易错点
- M 数量为 0 时，`dp` 为空、`min()` 报错 → 直接返回 `dist[S][T]`；示例 3 若漏判会崩。
- 机关间转移必须经石堆，不能直接用 `dist[M_i][M_j]` → 示例 1 中 `dist[M0][M1]=1`，但正确是 `3+4=7`，用错会得 10 而非 16。
- 某石堆到某机关不可达时 `dist` 为 `INF`，`INF+INF` 在 Python 不会溢出但会污染 `min` → 初始化 `toM` 时对 `INF` 做过滤或最后判 `>= INF` 返回 -1。

## 如果面试官追问
问：若 M 增到 20 怎么办？答：状压 2^20·20 仍可跑，但需把 `toM` 预计算改成对每个 M 只 BFS 一次并复用，避免 O(M²·R·C)。
