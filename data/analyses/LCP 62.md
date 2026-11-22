## 一句话思路
统计每个点的入度与出度，找「入度 = 点数-1 且出度 = 0」的唯一顶点，用出度为零先锁定候选。

## 怎么做
1. 用 `set` 收集所有出现过的地点，得到顶点数 `n`；同时用两个 `dict` 记 `indeg`、`outdeg`。
2. 遍历 `path`，对每条 `[a, b]` 做 `outdeg[a] += 1`、`indeg[b] += 1`。
3. 只挑 `outdeg.get(v, 0) == 0` 的点当候选——枢纽不可能有出边，这一步把候选压到极少。
4. 对候选检查 `indeg.get(v, 0) == n - 1`，成立即返回 `v`，否则 `-1`。

以示例 1 `path = [[0,1],[0,3],[1,3],[2,0],[2,3]]` 为例：顶点集 `{0,1,2,3}`，`n = 4`。遍历后 `indeg = {1:1, 3:3, 0:1}`，`outdeg = {0:2, 1:1, 2:2}`。出度为 0 的只有 `3`，再查 `indeg[3] == 3 == n-1`，返回 `3`。

```python
from collections import defaultdict

indeg, outdeg = defaultdict(int), defaultdict(int)
nodes = set()
for a, b in path:
    outdeg[a] += 1
    indeg[b] += 1
    nodes.add(a); nodes.add(b)
n = len(nodes)
for v in nodes:
    if outdeg[v] == 0 and indeg[v] == n - 1:
        return v
return -1
```

注意 `defaultdict` 读不存在的键会写入 0，所以判断出度用 `outdeg[v] == 0` 是安全的，但别在循环里对 `nodes` 边遍历边改。

## 复杂度
时间 O(V + E)：`path` 长度 E 决定遍历，顶点集 V 决定候选扫描。
空间 O(V)：`indeg`、`outdeg`、`nodes` 各存一份顶点。

## 易错点
- 输入 `path = [[0,1]]`：若把 `n` 当成 `max(地点)+1` 或 `len(path)+1`，会算成 2 或 3，`indeg[1]=1` 对不上 `n-1`，误返 `-1`。正确做法是用 `set` 收集真实顶点数，此例 `n=2`，返回 `1`。
- 输入示例 2 这类有环图：若只检查「入度最大」就返回，会挑到 `0`（`indeg[0]=3`）而漏掉它 `outdeg[0]=2` 非零。必须先卡 `outdeg[v] == 0` 再验入度，两个条件缺一不可。

## 如果面试官追问
问：若图里有多个出度为 0 的点怎么办？
答：逐个验 `indeg == n-1`，最多只有一个能过，其余自然落空返回 `-1`。
