## 一句话思路
从 `target` 反向记忆化搜索：每个位置只需考虑「步行到最近的可整除点再坐公交」，状态数被除法压到对数级。

## 怎么做
1. 定义 `dfs(x)` 为从 0 到 `x` 的最少时间，边界 `dfs(0)=0`，答案取 `dfs(target) % (10**9+7)`。
2. 对每个 `jump[i]`，若 `jump[i] > 1`，令 `q = x // jump[i]`，候选为 `dfs(q) + cost[i] + (x - q*jump[i]) * inc`（先坐到 `q*jump[i]` 再走 inc 步上来）。
3. 同时考虑「坐过头再往回走」：`q2 = q + 1`，候选为 `dfs(q2) + cost[i] + (q2*jump[i] - x) * dec`。
4. 纯步行候选 `x * inc` 兜底；所有候选取 min 存入 memo。

以示例 1 `target=31, inc=5, dec=3, jump=[6], cost=[10]` 为例：`dfs(31)` 时 `q=31//6=5`，正向候选 `dfs(5)+10+(31-30)*5`；`dfs(5)` 时 `q=0`，候选 `dfs(0)+10+5*5=35` 与 `dfs(1)+10+(6-5)*3`，最终 `dfs(31)=33`。

```python
from functools import lru_cache
MOD = 10**9 + 7

@lru_cache(None)
def dfs(x):
    if x == 0:
        return 0
    best = x * inc
    for j, c in zip(jump, cost):
        q = x // j
        best = min(best, dfs(q) + c + (x - q * j) * inc)
        if q + 1 <= x:
            best = min(best, dfs(q + 1) + c + ((q + 1) * j - x) * dec)
    return best

return dfs(target) % MOD
```

## 复杂度
时间：`O(len(jump) * log_j(target))`，每次除法把 `x` 缩小 `jump[i]` 倍，状态数对数级。
空间：`O(log_j(target))` 个 memo 条目，递归栈同阶。

## 易错点
- 只写正向候选 `dfs(q) + cost + (x-q*j)*inc`，漏掉 `q+1` 的回退分支 → 示例 1 中 `dfs(5)` 会算成 35 而非 33，因为从 6 走回 5 只需 3。必须两个方向都试。
- 递归里对 `x` 直接取模再参与比较 → `x*inc` 与 `dfs(q)+...` 大小关系被破坏，答案偏小。正确做法是全程用 Python 大整数算最小值，只在最终 `return` 时 `% MOD`。

## 如果面试官追问
问：若 `target` 降到 `10^6` 但 `jump` 有 1000 个怎么办？
答：仍用记忆化，但先按 `jump[i]` 去重并剔除「代价更高且倍数更小」的支配项，状态数不变、每层常数从 10 降到有效公交数。
