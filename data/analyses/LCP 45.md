## 一句话思路
以 `(r, c, v)` 为状态做 BFS，速度 v 有上界，用 visited 三维数组去重，避免同一格不同速度反复入队。

## 怎么做
1. 状态是 `(r, c, v)`，起点 `(position[0], position[1], 1)`，入队前标记 visited。
2. 每次弹出，向四邻扩展，新速度 `nv = v + terrain[r][c] - terrain[nr][nc] - obstacle[nr][nc]`。
3. `nv <= 0` 直接丢弃；否则若 `(nr, nc, nv)` 未访问则入队。
4. 所有状态跑完后，收集所有 `v == 1` 且非起点的格子，按行列排序返回。

关键中间值：示例 2 从 `(1,1)` 出发，`terrain[1][1]=6`，走向 `(0,1)` 时 `nv = 1 + 6 - 0 - 6 = 1`，恰好为 1，所以 `(0,1)` 入选；而走向 `(1,0)` 时 `nv = 1 + 6 - 0 - 7 = 0`，被丢弃。

```python
from collections import deque
n, m = len(terrain), len(terrain[0])
sr, sc = position
seen = {(sr, sc, 1)}
q = deque([(sr, sc, 1)])
res = set()
while q:
    r, c, v = q.popleft()
    if v == 1 and (r, c) != (sr, sc):
        res.add((r, c))
    for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < n and 0 <= nc < m:
            nv = v + terrain[r][c] - terrain[nr][nc] - obstacle[nr][nc]
            if nv > 0 and (nr, nc, nv) not in seen:
                seen.add((nr, nc, nv))
                q.append((nr, nc, nv))
return sorted([list(p) for p in res])
```

## 复杂度
时间：O(n·m·V)，V 为速度上界（约 100·100·100 量级），每个状态扩展 4 次。
空间：O(n·m·V)，visited 三维集合与队列各占一份。

## 易错点
- 起点本身速度为 1，若直接收集 `v == 1` 会把起点也算进去 → 输出多出 `position` → 收集时排除 `(sr, sc)`。
- 只按 `(r, c)` 去重 → 同一格以不同速度到达时被误剪，漏掉后续能回到 1 的路径 → 必须用 `(r, c, v)` 三元组去重。

## 如果面试官追问
问：速度上界怎么定，能不能不开三维数组？
答：`nv` 不超过 `1 + 100·(n+m)` 量级，可用 `dict` 按 `(r,c)` 存已访问速度集合，省空间但常数更大。
