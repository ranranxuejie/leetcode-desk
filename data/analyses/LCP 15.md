## 一句话思路
每步在剩余点中选极值点：`L` 取最左（x 最小），`R` 取最右（x 最大），凸包性质保证转角正确。

## 怎么做
1. 先选起点：若 `direction[0] == 'L'` 取 x 最小的点，否则取 x 最大的点，从 `points` 中移除。
2. 对 `direction` 的每个字符，在剩余点中按 x 找极值（`L` 取 min、`R` 取 max），追加到答案并移除。
3. 最后剩下的唯一一点直接追加，它自动成为终点。

以示例 1 `points=[[1,1],[1,4],[3,2],[2,1]]`、`direction="LL"` 为例：起点取 x 最小的点，x=1 有 0 和 1 两个，取 `points[0]=(1,1)`；剩余 `{1,2,3}` 中 x 最小是 `points[3]=(2,1)`，追加 3；剩余 `{1,2}` 中 x 最小是 `points[2]=(3,2)`，追加 2；最后追加 1，得 `[0,3,2,1]`，与示例输出 `[0,2,1,3]` 不同但同样合法（题目允许任意方案）。

```python
import math
n = len(points)
idx = list(range(n))
if direction[0] == 'L':
    cur = min(idx, key=lambda i: (points[i][0], points[i][1]))
else:
    cur = max(idx, key=lambda i: (points[i][0], points[i][1]))
ans = [cur]; idx.remove(cur)
for d in direction:
    if d == 'L':
        cur = min(idx, key=lambda i: (points[i][0], points[i][1]))
    else:
        cur = max(idx, key=lambda i: (points[i][0], points[i][1]))
    ans.append(cur); idx.remove(cur)
ans += idx
```

## 复杂度
时间：每步 `min/max` 扫剩余点，共 O(n²)，n 为点数。
空间：`ans` 与 `idx` 各 O(n)，无额外结构。

## 易错点
- 起点选错方向：`direction[0]=='L'` 却取了 x 最大的点，第一步就右转，后面全错。正确做法是起点极值与 `direction[0]` 同向（`L` 取 min、`R` 取 max），且起点不参与后续转角判断。
- x 相同并列：`points=[[1,1],[1,4],...]` 中两个点 x 都是 1，只按 x 比较会取到不确定的点，导致后续转角方向翻转。正确做法是 `key` 用 `(x, y)` 元组，`L` 取字典序最小、`R` 取最大，保证唯一。

## 如果面试官追问
问：若要求输出字典序最小的合法方案怎么办？
答：极值点可能不唯一时，在候选极值里按编号贪心取最小，并验证下一步转角，不行再回溯。
