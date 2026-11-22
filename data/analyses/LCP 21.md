## 一句话思路
先判环：若 A 到 B 的距离小于环上某点距 B 的距离，则 A 追不上；否则答案是所有「A 先到」的环点到 B 距离的最大值加一。

## 怎么做
1. 图有 N 个点 N 条边且连通，恰有一个环。用拓扑排序剥掉所有度数为 1 的点，剩下的点就是环上的点。
2. 从 `startA`、`startB` 各跑一次 BFS，得到 `da`、`db`。
3. 对每个环点 `v`，若 `da[v] < db[v]`，说明 A 能先占住这个环点，B 逃不出去，答案至少是 `db[v] + 1`；取所有满足条件的最大值。
4. 若没有任何环点满足 `da[v] < db[v]`，返回 -1。

以示例 1 为例：环是 `1-2-3-4`，`5`、`6` 是树上的点。`startA=3`、`startB=5`。BFS 得 `da[2]=1`、`db[2]=2`，`da[1]=2`、`db[1]=3`，`da[4]=2`、`db[4]=3`，环上每点都满足 `da < db`，最大值 `db[2]+1=3`，输出 3。

```python
from collections import deque
n = len(edges)
deg = [0] * (n + 1)
g = [[] for _ in range(n + 1)]
for a, b in edges:
    g[a].append(b); g[b].append(a)
    deg[a] += 1; deg[b] += 1
q = deque(i for i in range(1, n + 1) if deg[i] == 1)
on_cycle = [True] * (n + 1)
while q:
    u = q.popleft(); on_cycle[u] = False
    for v in g[u]:
        deg[v] -= 1
        if deg[v] == 1: q.append(v)
def bfs(s):
    d = [-1] * (n + 1); d[s] = 0; dq = deque([s])
    while dq:
        u = dq.popleft()
        for v in g[u]:
            if d[v] < 0: d[v] = d[u] + 1; dq.append(v)
    return d
da, db = bfs(startA), bfs(startB)
ans = -1
for v in range(1, n + 1):
    if on_cycle[v] and da[v] < db[v]:
        ans = max(ans, db[v] + 1)
```

## 复杂度
时间 O(n)：拓扑排序与两次 BFS 各扫一遍边，n 为景点数。
空间 O(n)：邻接表、`deg`、`da`、`db`、`on_cycle` 各开 n+1。

## 易错点
- 示例 2 的纯四元环，`startA=1`、`startB=3`，环上每点 `da[v] == db[v]`（如 `da[2]=db[2]=1`），若用 `<=` 判断会误判 A 能追上并返回 3；必须严格 `da[v] < db[v]`，全不满足时返回 -1。
- 忘记 `+1`：示例 1 中 `db[2]=2`，但答案 3 是因为 A 先走到 2 后 B 还要再走一步才被堵死；只取 `max(db[v])` 会少算一回合。

## 如果面试官追问
若要求输出具体追逐方案（每回合两人位置）？答：在满足 `da[v] < db[v]` 的环点里取 `db[v]` 最大的 `v`，A 沿最短路走向 `v`，B 沿最短路逃向 `v`，最后一步 A 踏入 B 所在点。
