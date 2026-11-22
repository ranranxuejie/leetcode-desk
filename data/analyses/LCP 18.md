## 一句话思路
排序 `drinks` 后对每个 `staple[i]` 二分找 `x - staple[i]` 的上界，累加下标数。

## 怎么做
1. 把 `drinks` 升序排序，得到可二分的有序数组。
2. 遍历 `staple`，对每个 `s` 算出剩余预算 `rest = x - s`。
3. 用 `bisect_right(drinks, rest)` 得到 `drinks` 中 `<= rest` 的元素个数 `k`，累加 `k`。
4. 每步累加后对 `1000000007` 取模，最后返回。

以示例 1 为例：`drinks` 排序后为 `[2,5,5]`。当 `s = 10` 时 `rest = 5`，`bisect_right([2,5,5], 5) = 3`，贡献 3 种；`s = 20` 时 `rest = -5`，返回 0；`s = 5` 时 `rest = 10`，返回 3。合计 `3 + 0 + 3 = 6`。

```python
from bisect import bisect_right

MOD = 1000000007
drinks.sort()
ans = 0
for s in staple:
    rest = x - s
    if rest < drinks[0]:
        continue
    ans = (ans + bisect_right(drinks, rest)) % MOD
return ans
```

关键点：`bisect_right` 而不是 `bisect_left`，因为价格等于 `rest` 时也算合法方案（示例 1 中 `10 + 5 = 15` 恰好等于 `x`，必须计入）。

## 复杂度
时间：排序 `drinks` 是 O(m log m)，遍历 `staple` 做 n 次二分是 O(n log m)。
空间：只用了排序的 O(log m) 栈空间和常数变量，没有额外数组。

## 易错点
- `staple = [10,20,5], drinks = [5,5,2], x = 15` 用 `bisect_left` → 会把 `10+5=15` 这种恰好等于 `x` 的方案漏掉，得到 4 而不是 6 → 必须用 `bisect_right`。
- `staple = [100000], drinks = [100000], x = 1` 时 `rest = -99999`，若直接 `bisect_right` 返回 0 没问题，但若先做 `x - s` 后不判断就访问 `drinks[0]` 做比较，空数组场景会越界 → 先判 `rest < drinks[0]` 再二分，或依赖 `bisect_right` 对负值天然返回 0。

## 如果面试官追问
问：如果要求输出所有具体方案而不是计数？答：排序后对每个 `staple[i]` 用 `bisect_right` 定位上界，再遍历 `drinks[0:k]` 逐个输出 `(i, j)`，复杂度升到 O(方案数)。
