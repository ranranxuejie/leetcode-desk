## 一句话思路
把状态扩成 `(城市, 剩余电量)` 跑 Dijkstra，边权是充电时间或行驶时间，因为两者都非负。

## 怎么做
1. 状态定为 `(u, e)`，`e` 是到达 `u` 时的剩余电量，`dist[u][e]` 记最小时间，起点 `dist[start][0] = 0`。
2. 每个状态两种转移：充 1 单位电到 `(u, e+1)`，代价 `charge[u]`；走一条边到 `(v, e-w)`，代价 `w`，要求 `e >= w`。
3. 用堆按时间弹出，第一次弹出 `u == end` 的状态即为答案。

以示例 1 为例，`start=1, cnt=6`：从 `(1,0)` 起，先充电到 `(1,3)` 花 `3*10=30`，再走边 `1-3` 距离 3 到 `(3,0)`，时间 33；在 3 充到 `(3,5)` 花 `5*1=5`，走 `3-0` 距离 5 到 `(0,0)`，总 43。注意 `(1,3)` 时若贪心充满到 6 会多花 30，被堆里更小的 `(1,3)` 分支淘汰。

```python
import heapq
n = len(charge)
dist = [[float('inf')] * (cnt + 1) for _ in range(n)]
dist[start][0] = 0
pq = [(0, start, 0)]
while pq:
    t, u, e = heapq.heappop(pq)
    if t > dist[u][e]:
        continue
    if u == end:
        return t
    if e < cnt and t + charge[u] < dist[u][e + 1]:
        dist[u][e + 1] = t + charge[u]
        heapq.heappush(pq, (t + charge[u], u, e + 1))
    for v, w in adj[u]:
        if e >= w and t + w < dist[v][e - w]:
            dist[v][e - w] = t + w
            heapq.heappush(pq, (t + w, v, e - w))
```

## 复杂度
时间 `O((n*cnt + m*cnt) log(n*cnt))`，`n` 是城市数、`cnt` 是电量上限，堆贡献 log。
空间 `O(n*cnt)`，即 `dist` 表和堆。

## 易错点
- 起点电量是 0 而非 `cnt`：若把 `dist[start]` 初始化成满电，示例 1 会直接走 `1-0` 距离 4 得 4，漏掉正确答案 43。必须从 `(start, 0)` 出发。
- 充电只允许 +1 逐格推进，不能一步充到 `cnt`：示例 2 中城市 0 只需充 2 单位（`charge[0]=4`），若一次充满 8 会多花 24。逐格转移让堆自然选出最优电量。

## 如果面试官追问
问：若要求输出具体路线和每站充电量怎么办？
答：在 `dist` 旁存 `(前驱状态, 动作)`，终点回溯即可还原充电与行驶序列。
