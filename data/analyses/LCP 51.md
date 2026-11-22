## 一句话思路
料理数 ≤8，直接枚举 2^8 个子集，逐个校验五种食材用量不超 `materials`，取饱腹达标的最大美味度。

## 怎么做
1. 用 `mask` 从 0 到 `(1<<n)-1` 遍历所有制作方案，`n = len(cookbooks)`。
2. 对每个 `mask`，累加被选中料理的五种食材用量与 `(x, y)`。
3. 若任一食材用量超过 `materials[j]`，跳过该方案。
4. 若 `y >= limit`，用 `x` 更新答案；全程无解返回 `-1`。

以示例 1 为例，`mask = 0b011`（料理 0、1）：食材用量为 `[3,2,4,1,2]`，恰好等于 `materials`，饱腹 `2+4=6 ≥ 5`，美味 `3+2=5`；而 `mask = 0b100`（仅料理 2）用量 `[3,2,4,1,0]` 合法，饱腹 6、美味 7，最终答案 7。

```python
n = len(cookbooks)
ans = -1
for mask in range(1 << n):
    use = [0] * 5
    x = y = 0
    for i in range(n):
        if mask >> i & 1:
            for j in range(5):
                use[j] += cookbooks[i][j]
            x += attribute[i][0]
            y += attribute[i][1]
    if all(use[j] <= materials[j] for j in range(5)) and y >= limit:
        ans = max(ans, x)
return ans
```

## 复杂度
时间：`O(2^n · n · 5)`，`n = len(cookbooks) ≤ 8`，约 1 万次内层操作。
空间：`O(1)`，只开长度 5 的 `use` 和两个累加器。

## 易错点
- `limit` 很小但食材不够时，容易只判饱腹不判食材：如 `materials = [0,0,0,0,0]`、任一 `cookbooks[i]` 非零，若漏掉 `use[j] <= materials[j]` 会把非法方案算进答案，正确做法是食材校验与饱腹校验必须同时成立。
- 空集 `mask = 0` 时 `y = 0`，若 `limit` 恰为 0 会误判合法；本题 `limit >= 1` 所以安全，但把 `ans` 初始化为 `0` 而非 `-1` 会在无解时返回 0，正确做法是初始 `-1` 且只在 `y >= limit` 时更新。

## 如果面试官追问
问：料理数放大到 40 怎么办？
答：2^40 枚举不可行，需按饱腹做背包 DP，`dp[y]` 存最大美味度，食材维度无法压缩时改用搜索剪枝。
