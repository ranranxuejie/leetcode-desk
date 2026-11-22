## 一句话思路
枚举蓄水次数 k，每个缸缺的水靠升级桶补足，总操作数 = k + Σ升级量，取最小。

## 怎么做
1. 设最终蓄水 k 次，则第 i 个缸每次至少要 `ceil(vat[i]/k)` 的桶容量，升级量是 `max(0, ceil(vat[i]/k) - bucket[i])`。
2. k 的上界取 `max(vat)`（桶容量至少 1 时，蓄 max(vat) 次必然够），从 1 枚举到上界。
3. 每个 k 累加升级量，记录 `k + 总升级量` 的最小值。

以 `bucket=[1,3], vat=[6,8]` 为例：k=3 时，缸 0 需 `ceil(6/3)=2`，升级 `2-1=1`；缸 1 需 `ceil(8/3)=3`，升级 `3-3=0`；总操作 `3+1=4`。k=4 时升级量为 0，总操作 4，同样最优。

```python
best = float('inf')
for k in range(1, max(vat) + 1):
    up = 0
    for b, v in zip(bucket, vat):
        need = (v + k - 1) // k
        if need > b:
            up += need - b
    best = min(best, k + up)
return best
```

注意 `vat[i]=0` 时 `need=0`，`need > b` 不成立，不产生升级量，符合示例 2 中缸 0 的处理。

## 复杂度
时间：O(max(vat) · n)，外层枚举 k 到 10^4，内层扫 n ≤ 100。
空间：O(1)，只用了 `best`、`up` 两个标量。

## 易错点
- `bucket=[0], vat=[5]` → 若从 k=0 开始枚举会除零，若漏算 `need - 0` 会少算升级 → 正确做法是 k 从 1 起，且升级量按 `need - b` 累加，b=0 时全额计入。
- `bucket=[10000], vat=[1]` → 若上界取 `max(bucket)` 或 `sum(vat)` 会多枚举甚至死循环 → 上界必须是 `max(vat)`，因为 k 超过 max(vat) 后升级量恒为 0、总操作只增不减。

## 如果面试官追问
问：n 扩大到 10^5、vat 到 10^9 怎么办？
答：k 的枚举范围爆炸，改为对每个缸枚举「蓄水次数」的候选值（`ceil(vat[i]/j)` 只有 O(√vat) 个），再用堆维护各缸当前升级量取全局最优。
