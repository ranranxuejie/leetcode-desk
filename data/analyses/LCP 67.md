## 一句话思路
对每个非空节点，把它的左右孩子各套一层 `-1` 再递归，先处理孩子再挂回去，天然自底向上。

## 怎么做
1. 空节点直接返回 `None`，这是递归出口。
2. 递归处理 `root.left` 和 `root.right`，拿到已装饰好的子树。
3. 若 `root.left` 非空，新建 `node = TreeNode(-1)`，令 `node.left = root.left`、`root.left = node`；右孩子同理。
4. 返回 `root`。

以 `root = [7,5,6]` 为例：先递归到 `5`，它无孩子，原样返回；回到 `7` 时 `root.left` 是 `5`，新建 `-1` 节点，`-1.left = 5`，`7.left = -1`。右孩子 `6` 同样处理，最终 `7` 的左右各挂一个 `-1`，`5`、`6` 成为这两个 `-1` 的孩子，与输出 `[7,-1,-1,5,null,null,6]` 一致。

```python
def dfs(node):
    if not node:
        return None
    node.left = dfs(node.left)
    node.right = dfs(node.right)
    if node.left:
        t = TreeNode(-1)
        t.left = node.left
        node.left = t
    if node.right:
        t = TreeNode(-1)
        t.right = node.right
        node.right = t
    return node
```

关键点：先递归再插 `-1`。若先插再递归，`dfs` 会作用到新插入的 `-1` 上，导致 `-1` 和原孩子之间又插一层，树无限加深。

## 复杂度
时间 O(n)：每个原节点被访问一次，插入的 `-1` 不参与递归。
空间 O(h)：递归栈深度等于原树高度，最坏链状 O(n)，未额外开数组。

## 易错点
- 输入 `root = [7,5,6]` 时若先插 `-1` 再递归孩子，`dfs` 会把 `-1` 当普通节点继续套 `-1`，输出层数翻倍。正确做法是先 `dfs(node.left)` 拿到装饰完的子树，再包 `-1`。
- 单节点输入 `root = [1]`（`left`、`right` 均为 `None`）时，若不加 `if node.left:` 判断就无条件建 `-1`，会多出两个空 `-1` 叶子，输出变成 `[1,-1,-1]`。正确做法是只在孩子非空时才插入。

## 如果面试官追问
问：节点数到 10^5 且树退化成链，递归会栈溢出吗？
答：Python 默认递归上限约 1000，链状 10^5 会 `RecursionError`，改用显式栈做后序（先压栈记录访问顺序）即可。
