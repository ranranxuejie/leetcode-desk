## 一句话思路
遍历整棵树把节点值塞进一个 set，set 的大小就是不同颜色数。

## 怎么做
1. 建一个空集合 `colors = set()`。
2. 从 `root` 开始 DFS，遇到非空节点就把 `node.val` 加进 `colors`。
3. 递归左右子树，空节点直接返回。
4. 遍历结束返回 `len(colors)`。

以示例 1 `root = [1,3,2,1,null,2]` 为例：访问根 1 后 `colors={1}`，访问左子 3 后 `colors={1,3}`，访问 3 的右子 2 后 `colors={1,3,2}`，再访问根右子 2 时 `add(2)` 不改变集合，最终 `len(colors)=3`。

```python
def numColor(root):
    colors = set()

    def dfs(node):
        if not node:
            return
        colors.add(node.val)
        dfs(node.left)
        dfs(node.right)

    dfs(root)
    return len(colors)
```

关键点：`set.add` 对重复值幂等，所以示例 1 里两个 1、两个 2 只各算一次，这正是「不同颜色」的定义。节点值范围 1~1000，也可以开长度 1001 的布尔数组代替 set，但 set 更省事且不依赖值域。

## 复杂度
时间 O(n)：n 为节点数，每个节点访问一次，`add` 均摊 O(1)。
空间 O(n)：递归栈最坏 O(n)（链状树），`colors` 最多 O(min(n,1000))。

## 易错点
- 输入 `root = [3,3,3]` → 若用计数器累加节点数会得到 3 → 必须用 set 去重，返回 1。
- 输入是链状树（1000 个节点全在左子树）→ Python 默认递归深度约 1000，可能触发 `RecursionError` → 改用显式栈迭代，或确认深度不超限。

## 如果面试官追问
问：节点值范围扩大到 10^9 怎么办？
答：set 方案不受值域影响，仍 O(n) 时间、O(n) 空间；布尔数组方案就不可行了。
