## 一句话思路
自底向上 DP：每个子树只需知道「根到最近装置的距离」和「根是否已被覆盖」，贪心地把装置尽量往上放。

## 怎么做
1. 定义 `dfs(node)` 返回 `(d, covered)`：`d` 是 node 到其子树内最近装置的距离（无装置为 `inf`），`covered` 表示 node 是否已被某个装置覆盖（距离 ≤ 1）。
2. 后序处理左右孩子，取 `d = min(dl, dr) + 1`；若 `dl + dr <= 2`，说明左右两侧装置能覆盖到 node，`covered = True`。
3. 若 node 是叶子且未被覆盖，或 `d == 2`（再往上就覆盖不到父节点了），就在 node 放装置：`d = 0, covered = True`，答案 +1。
4. 根节点特殊处理：若 `dfs(root)` 返回未覆盖，再 +1。

以示例 1 `root = [1,2,null,3,4]` 为例：节点 3、4 是叶子，各自放装置，返回 `(0, True)`；节点 2 收到 `dl=dr=0`，`0+0<=2` 故 `covered=True`，`d=1`；根 1 收到 `d=1` 且已覆盖，不再放装置，最终答案 2。

```python
def dfs(node):
    if not node:
        return (10**9, False)
    dl, cl = dfs(node.left)
    dr, cr = dfs(node.right)
    d = min(dl, dr) + 1
    covered = cl or cr or (dl + dr <= 2)
    if not covered and (d == 2 or (not node.left and not node.right)):
        nonlocal ans
        ans += 1
        return (0, True)
    return (d, covered)
```

## 复杂度
时间 O(n)：每个节点访问一次，n 为节点数。
空间 O(h)：递归栈深度 h，最坏链状树 O(n)。

## 易错点
- 输入是链状树（如 `[1,2,null,3,null,4]`）→ 若只在叶子放装置会漏覆盖中间节点 → 正确做法是 `d == 2` 时立即在中间节点放装置，不能等到叶子。
- 根节点单独判断 → 若忘记根未覆盖时补 +1，示例 2 `[1,2,3,4]` 会少算 → 正确做法是 `dfs(root)` 返回 `covered=False` 时答案再 +1。

## 如果面试官追问
若要求输出具体装置位置？答：在 `ans += 1` 处记录 `node.val`，最后按升序返回即可。
