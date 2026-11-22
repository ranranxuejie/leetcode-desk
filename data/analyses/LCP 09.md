## 一句话思路
BFS 按层扩展，用 `max_reach` 记录已能一步跳达的最右位置，避免对每个点重复扫描左侧。

## 怎么做
1. 建 `dist` 数组，`dist[0]=0`，队列存位置，`max_reach` 初始为 0。
2. 出队位置 `i`，先算右跳 `i + jump[i]`：若 `>= n` 直接返回 `dist[i]+1`，否则若未访问则入队。
3. 左跳不枚举 0..i-1，而是把 `max_reach+1 .. i-1` 这段未访问点全部入队（它们都能一步到 `i`），并推进 `max_reach`。
4. 每层 BFS 保证第一次到达即最短。

以 `jump=[2,5,1,1,1,1]` 为例：出队 0，右跳 2 入队，`dist[2]=1`；`max_reach` 从 0 推到 1，位置 1 入队 `dist[1]=1`。出队 2 时右跳 3，左跳区间 `max_reach+1=2` 到 `1` 为空，不重复入队。

```python
from collections import deque
n = len(jump)
dist = [-1] * n
dist[0] = 0
q = deque([0])
max_reach = 0
while q:
    i = q.popleft()
    r = i + jump[i]
    if r >= n:
        return dist[i] + 1
    if dist[r] == -1:
        dist[r] = dist[i] + 1
        q.append(r)
    while max_reach < i:
        max_reach += 1
        if dist[max_reach] == -1:
            dist[max_reach] = dist[i] + 1
            q.append(max_reach)
```

## 复杂度
时间 O(n)：每个位置至多入队一次，`max_reach` 单调推进。
空间 O(n)：`dist` 数组和队列各占 n。

## 易错点
- 输入 `jump=[1,1,1]`：若左跳写成枚举 `0..i-1` 全入队，同一层会重复入队已访问点，队列膨胀到 O(n²)；正确做法是用 `max_reach` 只推进未访问区间。
- 输入 `jump=[10000]`（n=1）：若先判 `r>=n` 再判 `dist[r]`，`r=10000` 越界访问 `dist[10000]` 报错；正确做法是先判 `r>=n` 直接返回，再访问 `dist[r]`。

## 如果面试官追问
要求输出具体跳跃路径怎么办？
答：`dist` 改为记录前驱 `prev[pos]`，右跳和左跳入队时都记 `prev[新点]=i`，最后从弹出点回溯到 0 再反转。
