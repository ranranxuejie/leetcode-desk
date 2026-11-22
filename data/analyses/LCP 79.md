## 一句话思路
按 mantra 逐字符做多源 BFS：每个字符从上一字符的所有出现位置同时出发，取最近距离，累加移动次数再加提取次数。

## 怎么做
1. 预处理：把 matrix 中每个字母的所有坐标存进字典 `pos[c] = [(i,j),...]`，若 mantra 中某字符不在字典里直接返回 -1。
2. 维护 `cur` 为上一字符所有可达位置的 `(距离, i, j)` 集合，初始为 `{(0,0,0)}`（起点 [0,0]，距离 0）。
3. 对 mantra 每个字符 c，从 `cur` 中所有位置作为多源起点跑 BFS，遇到第一个 `matrix[i][j]==c` 的格子即停，把该字符所有等距（或更远但同层）的格子收集为新 `cur`；每步移动 +1，提取本身再 +1。
4. 累加所有字符的最短移动距离 + len(mantra) 次提取操作。

以 `matrix=["sd","ep"], mantra="speed"` 为例：起点 (0,0) 是 's'，距离 0，提取 +1；找 'p' 时从 (0,0) 出发，BFS 到 (1,1) 距离 2，提取 +1；找 'e' 时从 (1,1) 出发，到 (1,0) 距离 1……关键中间值：处理完 "sp" 后 `cur={(2,1,1)}`，累计移动 2、提取 2。

```python
from collections import deque
pos = {}
for i, row in enumerate(matrix):
    for j, ch in enumerate(row):
        pos.setdefault(ch, []).append((i, j))
if any(c not in pos for c in mantra):
    return -1
cur = [(0, 0, 0)]  # (dist, i, j)
total = 0
for c in mantra:
    dq = deque(cur); seen = {(i, j) for _, i, j in cur}
    best = None; nxt = []
    while dq:
        d, i, j = dq.popleft()
        if best is not None and d > best: break
        if matrix[i][j] == c:
            best = d; nxt.append((d, i, j)); continue
        for di, dj in ((1,0),(-1,0),(0,1),(0,-1)):
            ni, nj = i+di, j+dj
            if 0 <= ni < len(matrix) and 0 <= nj < len(matrix[0]) and (ni,nj) not in seen:
                seen.add((ni,nj)); dq.append((d+1, ni, nj))
    total += best + 1
    cur = nxt
return total
```

## 复杂度
时间：O(len(mantra) · R·C)，每个字符最多扫一遍全图。
空间：O(R·C) 存 pos 与 seen，队列最多 R·C 个元素。

## 易错点
- mantra 有重复字符（如 "speed" 两个 e）→ 若把 `cur` 只留一个最近位置，会漏掉同层其他等距格子导致后续绕远 → 必须保留所有 `d == best` 的位置进 `nxt`。
- 起点 (0,0) 本身可能就是 mantra[0] → 若忘记初始 `cur` 含距离 0 的起点，会多算一次移动 → 初始就放 `(0,0,0)`，提取只 +1 不加移动。

## 如果面试官追问
若 matrix 规模到 10^4×10^4 而 mantra 很短怎么办？答：预处理每个字母的坐标表，用曼哈顿距离在候选集上取 min，避免全图 BFS。
