## 一句话思路
按位独立：NAND 链对每一位只有「全 1 则翻转、否则置 1」两种结局，用线段树维护区间按位与即可。

## 怎么做
1. 对第 b 位，`y NAND a` 的结果是 `not(y & a_b)`：若 `a_b=0` 则结果恒为 1，若 `a_b=1` 则结果取反。
2. 所以链 `y NAND arr[0] NAND ... ` 中，只要遇到某个 `arr[i]` 该位为 0，之后该位恒为 1；否则该位等于 `not y_b` 反复翻转 `len` 次。
3. 结论：设区间按位与为 `A`，长度 `L`，则结果第 b 位 = `1`（若 `A_b=0`）或 `not y_b` 翻转 `L` 次（若 `A_b=1`），即 `y_b XOR (L&1)` 再取反。
4. 用线段树维护 `arr` 的区间与，支持单点改；每次 type=1 查询 `[0, n-1]` 的与，再按 `x` 的奇偶拼出结果。

以示例 1 第一次运算为例：`arr=[1,2]`，`x=2`，链长 `x*n=4`，区间与 `1&2=1`（二进制 001），只有第 0 位为 1，`y=3` 第 0 位为 1，翻转 4 次仍为 1，其余位因 `A_b=0` 置 1，得 `101=5`。

```python
def query(self, node, l, r, ql, qr):
    if ql <= l and r <= qr:
        return self.tree[node]
    mid = (l + r) // 2
    res = (1 << self.k) - 1
    if ql <= mid:
        res &= self.query(node*2, l, mid, ql, qr)
    if qr > mid:
        res &= self.query(node*2+1, mid+1, r, ql, qr)
    return res

def calc(y, A, L, k):
    res = 0
    for b in range(k):
        if (A >> b) & 1:
            res |= ((y >> b) & 1) ^ (L & 1) << b
        else:
            res |= 1 << b
    return res
```

## 复杂度
时间：每次操作 O(k + log n)，n 来自线段树，log n 来自树高，k 来自逐位拼答案。
空间：线段树 O(n)，额外只存一个 `tree` 数组。

## 易错点
- `x` 可达 1e9，`x*n` 会超 32 位，但只需 `x` 的奇偶判断翻转次数，直接 `x & 1`，别真去算 `x*n`。
- 区间与 `A_b=1` 时结果是 `y_b XOR (L&1)` 再取反，漏掉取反会得到相反位；示例 1 中若漏取反，第 0 位会算成 0 而非 1，答案从 5 变 4。

## 如果面试官追问
若 `k` 增大到 60 或 `arr` 支持区间修改，怎么办？答：按位拆成 60 棵线段树或改用位并行线段树，区间修改需懒标记维护与值。
