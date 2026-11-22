## 一句话思路
把 BST 中序展开成有序数组，用线段树区间赋值维护颜色，最后统计红色节点数。

## 怎么做
1. 中序遍历 `root` 得到升序数组 `vals`，节点值互不相同，所以值到下标可用 `bisect_left` 定位。
2. 对每个 `ops[i] = [type, x, y]`，用 `bisect_left(vals, x)` 和 `bisect_right(vals, y)` 求出下标区间 `[l, r)`。
3. 线段树维护区间和（红色为 1），`type=1` 赋 1、`type=0` 赋 0，用懒标记 `lazy` 表示整段统一颜色。
4. 全部操作后根节点的和即答案。

以示例 1 为例：`vals = [1,2,3,4,5]`。第 0 次 `[1,2,4]` 得 `l=1, r=4`，把下标 1~3 赋 1，区间和变 3；第 2 次 `[0,3,5]` 得 `l=2, r=5` 赋 0，最终只剩下标 0、1 为红，答案 2。

```python
def update(node, lo, hi, l, r, c):
    if r <= lo or hi <= l: return
    if l <= lo and hi <= r:
        tree[node] = c * (hi - lo); lazy[node] = c; return
    mid = (lo + hi) // 2
    if lazy[node] != -1:
        lazy[node*2] = lazy[node*2+1] = lazy[node]
        tree[node*2] = lazy[node] * (mid - lo)
        tree[node*2+1] = lazy[node] * (hi - mid)
        lazy[node] = -1
    update(node*2, lo, mid, l, r, c)
    update(node*2+1, mid, hi, l, r, c)
    tree[node] = tree[node*2] + tree[node*2+1]
```

## 复杂度
时间：建树 O(n)，每次操作 O(log n)，共 O(n + m log n)，n 为节点数、m 为 ops 长度。
空间：`vals` 与线段树各 O(n)，递归栈 O(log n)。

## 易错点
1. 区间右端点写成 `bisect_left(vals, y)` → 会漏掉值恰为 `y` 的节点，示例 1 第 0 次会得到 `r=3` 而非 4，少染一个节点。必须用 `bisect_right(vals, y)` 得到开区间右端。
2. 懒标记初值用 0 表示「无标记」→ 与「整段染蓝」的 0 冲突，pushdown 时会把蓝误判成无标记。应初始化 `lazy = [-1] * (4*n)`，用 -1 表示无标记。

## 如果面试官追问
若 ops 规模涨到 10^6 且要求在线输出每次操作后的红色数？答：仍用线段树，每次 update 后读 `tree[1]` 即可，单次 O(log n)。
