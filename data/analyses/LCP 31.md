## 一句话思路
用 BFS 搜索状态 `(t, r, c, s1, s2)`，`s1/s2` 记录两张卷轴是否已用，按时间层推进即可。

## 怎么做
1. 状态是 `(t, r, c, used1, used2)`，`t` 从 0 到 `len(maze)-1`，每层只从上一层的可达状态扩展。
2. 每步枚举 5 个动作（上下左右停），目标格在 `maze[t+1]` 为 `"."` 才可直接走。
3. 若目标格是 `"#"`，可用临时消除术（只对 `t+1` 生效）或永久消除术（此后一直空），分别置 `used1/used2`。
4. 到达 `(n-1, m-1)` 即返回 `True`；时间用完仍未到则 `False`。

以示例 2 为例：`maze` 只有 2 层，终点 `(1,2)`。`t=0` 从 `(0,0)` 出发，一步最多到 `(0,1)` 或 `(1,0)`，`t=1` 时距终点曼哈顿距离仍为 2，时间不够，返回 `False`。

```python
from collections import deque
n, m, T = len(maze), len(maze[0][0]), len(maze)
seen = {(0, 0, 0, 0, 0)}
q = deque([(0, 0, 0, 0, 0)])
while q:
    t, r, c, u1, u2 = q.popleft()
    if (r, c) == (n - 1, m - 1): return True
    if t + 1 >= T: continue
    for dr, dc in ((1,0),(-1,0),(0,1),(0,-1),(0,0)):
        nr, nc = r + dr, c + dc
        if not (0 <= nr < n and 0 <= nc < m): continue
        if maze[t+1][nr][nc] == ".":
            st = (t+1, nr, nc, u1, u2)
            if st not in seen: seen.add(st); q.append(st)
        else:
            if not u1:
                st = (t+1, nr, nc, 1, u2)
                if st not in seen: seen.add(st); q.append(st)
            if not u2:
                st = (t+1, nr, nc, u1, 1)
                if st not in seen: seen.add(st); q.append(st)
return False
```

## 复杂度
时间：`O(T·N·M·4)`，`T=len(maze)`，状态数上限 `T·N·M·4`。
空间：`seen` 集合存同量状态，队列同阶，无额外大数组。

## 易错点
- 输入 `maze` 只有 1 层（`T=1`）且起点即终点：若先判 `t+1>=T` 再判终点，会漏掉 `(0,0)==(n-1,m-1)` 直接返回 `True` 的情况，正确做法是出队时先判终点。
- 永久消除术用在 `(nr,nc)` 后，后续层该格应视为空地，但代码里若只改 `used2` 而不在判断时特判「已永久消除的格子」，会在 `maze[t+1][nr][nc]=="#"` 处再次被拦，正确做法是永久消除后把该坐标记入集合，判断时优先查集合。

## 如果面试官追问
问：若卷轴数量改为 `k` 个，状态怎么变？
答：把 `used1/used2` 换成 `k+1` 进制掩码或直接记剩余次数，状态数乘 `(k+1)`，BFS 不变。
