## 一句话思路
对 `increase` 求三维前缀和得到每天累计属性，再对每个 `requirements[i]` 二分找第一个三项都达标的日期。

## 怎么做
1. 把 `increase` 原地累加成前缀和，`increase[d]` 变成第 `d+1` 天的累计 C/R/H。
2. 对每个需求，先判断最后一天是否三项都够，不够直接记 `-1`。
3. 够则二分 `[0, n-1]`，找第一个 `increase[mid]` 三项均 `>=` 需求的 `mid`，答案是 `mid+1`。
4. 三项必须同时满足，所以判断条件是 `and` 连接，不能拆成三次独立二分。

以示例 1 为例，累加后 `increase = [[2,8,4],[4,13,4],[14,22,12]]`。需求 `[2,11,3]` 二分时 `mid=0` 得 `(2,8,4)`，R=8<11 不达标，`lo=1`；`mid=1` 得 `(4,13,4)` 三项全过，答案 `1+1=2`。

```python
n = len(increase)
for d in range(1, n):
    for k in range(3):
        increase[d][k] += increase[d-1][k]
res = []
for c, r, h in requirements:
    if increase[-1][0] < c or increase[-1][1] < r or increase[-1][2] < h:
        res.append(-1)
        continue
    lo, hi = 0, n - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if increase[mid][0] >= c and increase[mid][1] >= r and increase[mid][2] >= h:
            hi = mid
        else:
            lo = mid + 1
    res.append(lo + 1)
```

## 复杂度
时间：O(n + m log n)，n 为 `increase` 长度做前缀和，m 为 `requirements` 长度各二分一次。
空间：O(1) 额外空间，前缀和原地改在 `increase` 上，只开了 `res` 输出数组。

## 易错点
- 需求为 `[0,0,0]`（示例 3）→ 若二分下界写成 `lo=1` 或答案写成 `lo` 而非 `lo+1`，会错成 `1` 或 `0` 偏移 → 第 0 天属性全 0 已满足，正确返回 `0`，即 `lo=0` 时输出 `lo+1` 前要先处理这个边界，或统一用 `lo+1` 且 `lo` 从 0 起。
- 某天增量为 0（如示例 2 的 `[10,10,0]`）→ 若用「三项分别二分再取 max」会得到错误日期，因为三项达标日期不同 → 必须三项 `and` 一起二分，取第一个同时满足的下标。

## 如果面试官追问
问：若 `requirements` 也按 C 排序，能否更快？
答：可以，排序后指针单调右移，整体降到 O(n + m log m)，省掉每次二分的 log n。
