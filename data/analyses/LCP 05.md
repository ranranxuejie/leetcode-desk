## 一句话思路
对树做 DFS 序拍平成数组，子树变成连续区间，用树状数组做区间加、区间求和。

## 怎么做
1. 建邻接表 `children[a].append(b)`，从 1 开始 DFS，记录 `tin[u]`（进入时间）和 `tout[u]`（离开时间），子树 u 对应区间 `[tin[u], tout[u]]`。
2. 用两个树状数组 `B1`、`B2` 维护差分：区间 `[l,r]` 加 `v` 时，`B1` 在 l 加 v、r+1 减 v；`B2` 在 l 加 v*(l-1)、r+1 减 v*r。
3. 前缀和 `pre(x) = sum(B1,x)*x - sum(B2,x)`，区间和 = `pre(r) - pre(l-1)`。
4. 操作 1 是单点：区间 `[tin[u], tin[u]]` 加 v；操作 2 是整棵子树：`[tin[u], tout[u]]` 加 v；操作 3 查询 `[tin[u], tout[u]]` 的区间和，模 `1000000007`。

以示例为例，DFS 顺序若为 1,2,3,5,6,4，则 `tin[2]=2, tout[2]=5`。执行 `[2,2,50]` 后，区间 `[2,5]` 各加 50，此时 `pre(5)-pre(1)` 中 2、3、5 号各 50，加上 1 号的 500，查询 1 号子树得 650。

```python
def add(bit, i, v):
    while i <= n:
        bit[i] += v
        i += i & -i

def query(bit, i):
    s = 0
    while i > 0:
        s += bit[i]
        i -= i & -i
    return s

def range_add(l, r, v):
    add(B1, l, v); add(B1, r+1, -v)
    add(B2, l, v*(l-1)); add(B2, r+1, -v*r)

def pre(x):
    return query(B1, x)*x - query(B2, x)
```

## 复杂度
时间：DFS 建序 O(n)，每次操作 O(log n)，共 O(n + Q log n)。
空间：邻接表与 tin/tout 各 O(n)，两个树状数组 O(n)。

## 易错点
- `leadership` 里父子顺序是 `[a,b]` 表示 b 是 a 的下属，若写成 `children[b].append(a)` 会把树建反，示例中 2 号的下属 3、5 就查不到，第一次查询得 550 而非 650。
- 操作 1 是只给一个人发，若误用 `[tin[u], tout[u]]` 整段加，示例中 `[1,1,500]` 会让 2、3、5、6、4 全部 +500，第一次查询变成 2650；正确只加 `[tin[u], tin[u]]`。

## 如果面试官追问
若 N、Q 放大到 10^6 且要求在线，怎么办？答：DFS 序不变，把树状数组换成迭代式线段树或改用欧拉序 + 差分前缀，仍是 O(log n) 每次。
