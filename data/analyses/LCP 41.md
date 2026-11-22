## 一句话思路
对每个 `"."` 落黑子后做 BFS：每步扫描八个方向找可翻白棋并翻转，直到不再变化，取最大值。

## 怎么做
1. 枚举 `chessboard` 中每个 `"."`，复制棋盘后在该位置放 `"X"`。
2. 用队列驱动：每轮遍历棋盘上所有 `"X"`，沿八个方向找「连续 `"O"` 后接 `"X"`」的线段，把中间 `"O"` 全翻成 `"X"` 并计数。
3. 只要本轮有翻转就再扫一轮，因为新翻出的黑棋可能形成新的包围。
4. 所有落子点取最大翻转数。

以示例 2 `[".X.",".O.","XO."]` 落 `[2,2]` 为例：先变 `[" .X."," .O.","XOX"]`，第一轮从 `[2,2]` 向上看 `[1,1]="O"`、`[0,1]="X"`，翻 1 枚；`[2,2]` 向左看 `[2,1]="O"`、`[2,0]="X"`，再翻 1 枚，共 2。

```python
dirs = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]
def count(b, r, c):
    b[r][c] = "X"
    total = 0
    changed = True
    while changed:
        changed = False
        for i in range(n):
            for j in range(m):
                if b[i][j] != "X":
                    continue
                for dx, dy in dirs:
                    x, y, line = i + dx, j + dy, []
                    while 0 <= x < n and 0 <= y < m and b[x][y] == "O":
                        line.append((x, y)); x += dx; y += dy
                    if line and 0 <= x < n and 0 <= y < m and b[x][y] == "X":
                        for a, c2 in line:
                            b[a][c2] = "X"
                        total += len(line); changed = True
    return total
```

## 复杂度
时间：每个空位 O(nm) 次扫描，每次扫描 O(nm·8)，共 O((nm)³)，n,m ≤ 8 时约 2.6e7。
空间：每轮复制棋盘 O(nm)，队列/递归栈可忽略。

## 易错点
- 输入 `["....X.","....X.","XOOO..",...]` 落 `[2,4]` 时，若只扫一遍就返回，会漏掉后续连锁翻转；必须用 `changed` 循环到稳定，示例 1 答案是 3 而非 1。
- 方向扫描时若把 `line` 判空写成 `if 0 <= x < n ...` 而不检查 `line`，会把「紧邻就是 `"X"`」误判为可翻；正确做法是 `line` 非空且终点为 `"X"` 才翻转。

## 如果面试官追问
若棋盘扩到 30×30，暴力 O((nm)³) 会超时，怎么办？
答：预处理每个方向的可翻线段，落子只影响经过该点的八条线，增量更新即可降到 O(nm·8·max(n,m))。
