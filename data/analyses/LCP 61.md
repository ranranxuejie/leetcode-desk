## 一句话思路
把相邻两天的温差压成符号（-1/0/1），两数组逐位比较，相同就累加连续长度并取最大值。

## 怎么做
1. 长度 n 天只有 n-1 段趋势，循环 `i` 从 1 到 n-1，每段用 `sign(x[i]-x[i-1])` 表示。
2. 用 `(a > b) - (a < b)` 得到 -1/0/1，避免写 if 分支。
3. 两段符号相等则 `cur += 1`，否则 `cur = 0`，每轮更新 `best = max(best, cur)`。
4. 返回 `best`，注意它是「趋势段数」，正好等于题面要的 `n`。

以示例 1 为例：`temperatureA` 的差分为 `[-3,0,0,13]` → 符号 `[-1,0,0,1]`；`temperatureB` 差分为 `[-2,-16,0,1]` → 符号 `[-1,-1,0,1]`。逐位比较：第 0 位相同 `cur=1`，第 1 位 `0≠-1` 归零，第 2 位相同 `cur=1`，第 3 位相同 `cur=2`，`best=2`，与输出一致。

```python
def temperatureTrend(temperatureA, temperatureB):
    best = cur = 0
    for i in range(1, len(temperatureA)):
        a = temperatureA[i] - temperatureA[i - 1]
        b = temperatureB[i] - temperatureB[i - 1]
        sa = (a > 0) - (a < 0)
        sb = (b > 0) - (b < 0)
        cur = cur + 1 if sa == sb else 0
        best = max(best, cur)
    return best
```

## 复杂度
时间：O(n)，n 为天数，单次遍历。
空间：O(1)，只开 `best/cur/sa/sb` 几个标量。

## 易错点
- 输入 `[1,1,1]` 与 `[2,2,2]` → 若用 `a == b` 直接比差值会得 0≠0 判成不同，或误把平稳当不同；正确做法是先把差值压成符号再比，`0 == 0` 才算趋势相同。
- 输入 `[5,10,16,-6,15,11,3]` 与 `[16,22,23,23,25,3,-16]` → 若把 `cur` 初值设成 1 或返回 `cur+1`，会把段数当天数多算 1；正确做法是 `cur` 从 0 起、返回 `best` 本身，因为 n 段趋势对应 n 天跨度。

## 如果面试官追问
问：若要求返回最长区间的起止下标而非长度？
答：在 `cur` 归零处记录 `start = i - cur`，`best` 更新时同步存 `(start, i)`，仍是 O(n)。
