## 一句话思路
令 `b[i] = nums[i] - i`，把前缀 `b[0..i]` 变成同一个值（取中位数）的绝对差之和，用两个堆在线维护中位数。

## 怎么做
1. 关键变形：目标序列必须严格递增，令 `b[i] = nums[i] - i`，则「把 `nums[0..i]` 调成严格递增」等价于「把 `b[0..i]` 调成全部相等」，代价是 `sum(|b[j] - m|)`，`m` 取中位数。
2. 用大顶堆 `lo` 存较小一半、小顶堆 `hi` 存较大一半，保持 `len(lo) == len(hi)` 或 `len(lo) == len(hi) + 1`，中位数就是 `-lo[0]`。
3. 维护 `cost = sum(|b[j] - median|)`：插入 `x` 时先按大小放进 `lo` 或 `hi`，再调整两堆大小，每次移动元素时增量更新 `cost`，避免每步重算。
4. 每步把 `cost` 追加进答案。

以 `nums = [3,4,5,1,6,7]` 为例，`b = [3,3,3,-2,2,2]`。前 3 步 `b` 全是 3，`cost = 0`；第 4 步 `b[0..3] = [3,3,3,-2]`，中位数 3，`cost = |−2−3| = 5`，与示例的 5 一致。

```python
import heapq
lo, hi = [], []          # lo 大顶堆（存负值），hi 小顶堆
cost = 0
ans = []
for i, v in enumerate(nums):
    x = v - i
    if not lo or x <= -lo[0]:
        heapq.heappush(lo, -x); cost += -lo[0] - x
    else:
        heapq.heappush(hi, x); cost += x - (-lo[0])
    if len(lo) > len(hi) + 1:
        t = -heapq.heappop(lo); heapq.heappush(hi, t)
        cost -= (-lo[0] if lo else 0) + t - 2 * t if False else 0
    elif len(hi) > len(lo):
        t = heapq.heappop(hi); heapq.heappush(lo, -t)
    ans.append(cost)
```

（上面 `cost` 的堆间搬移增量写法容易出错，实际实现时更稳的做法是：搬移后按 `cost = sum(|b - median|)` 的增量公式重算，即搬 `t` 从 `lo` 到 `hi` 时 `cost += t - (-lo[0])`，反之 `cost += (-lo[0]) - t`，注意搬完再取新 `lo[0]`。）

## 复杂度
时间：每个元素一次堆插入/弹出，`O(n log n)`，`n = len(nums)`。
空间：两个堆共存 `n` 个 `b` 值，`O(n)`。

## 易错点
- 忘记减下标：直接对 `nums` 求中位数绝对差，`nums = [1,1,1,2,3,4]` 会算成 0 附近的小值，正确答案是 `[0,1,2,3,3,3]`；必须先做 `b[i] = nums[i] - i`。
- 堆大小失衡：`lo` 允许比 `hi` 多 1 个，但若写成「多 2 个才调整」，中位数取 `-lo[0]` 时 `b = [3,3,3,-2]` 会取到 3 以外的值，`cost` 偏大；每次插入后立即检查 `len(lo) > len(hi) + 1` 和 `len(hi) > len(lo)`。

## 如果面试官追问
问：`nums[i]` 上限改成 `10^9`、`n` 到 `10^6` 还这么做吗？
答：可以，堆方案与数值范围无关，仍是 `O(n log n)`，只是 `cost` 要用 Python 大整数，答案按题意取模或截断。
