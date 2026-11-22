## 一句话思路
用滑动窗口维护「每个品种计数 ≤ cnt」的最长合法右边界，对每个右端点累加合法左端点个数。

## 怎么做
1. 用 `left` 指向窗口左端，`freq` 字典记录窗口内各品种数量，`ans` 累加答案。
2. 右指针 `right` 从 0 遍历，把 `flowers[right]` 计入 `freq`。
3. 当 `freq[flowers[right]] > cnt` 时，不断右移 `left` 并减少对应计数，直到该品种数量回到 `cnt`。
4. 此时以 `right` 结尾的合法区间有 `right - left + 1` 个，累加进 `ans`。

以 `flowers = [1,2,3,2], cnt = 1` 为例：`right=3` 时 `freq[2]` 变为 2，超过 `cnt`，`left` 从 0 移到 1，`freq[1]` 减为 0，窗口变 `[2,3,2]` 中 `left=1`，贡献 `3-1+1=3` 个区间。

```python
freq = {}
left = ans = 0
for right, x in enumerate(flowers):
    freq[x] = freq.get(x, 0) + 1
    while freq[x] > cnt:
        freq[flowers[left]] -= 1
        left += 1
    ans += right - left + 1
return ans
```

关键点：`while` 条件只看 `freq[x]`，因为只有新加入的 `x` 可能超限，其他品种在上一轮已合法。

## 复杂度
时间：O(n)，`right` 和 `left` 各最多移动 n 次，`freq` 操作 O(1)。
空间：O(k)，`freq` 字典最多存 k 个不同品种，k ≤ n。

## 易错点
1. 输入 `flowers = [5,3,3,3], cnt = 2`：若 `while` 写成 `if`，`right=3` 时 `freq[3]=3 > 2` 只减一次 `left` 到 1，窗口 `[3,3,3]` 仍超限，答案偏大。正确做法是用 `while` 持续收缩直到 `freq[3] <= 2`，`left` 应移到 2。
2. 输入 `flowers = [1,1,1], cnt = 1`：若在 `while` 后忘记累加 `right - left + 1` 而用固定窗口长度，会漏算短区间。正确做法是每个 `right` 都累加当前合法左端点个数 `right - left + 1`，因为以 `right` 结尾的任意 `left' >= left` 都合法。

## 如果面试官追问
问：若要求输出所有美观区间的具体方案而非计数？
答：在累加处枚举 `left'` 从 `left` 到 `right` 收集区间，总输出量可能 O(n²)，需按输出规模计复杂度。
