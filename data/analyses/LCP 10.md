## 一句话思路
对每个子树返回 `(总工作量 sum, 最短完成时间 time)`，用两核并行下界 `max(sum/2, max(left.time, right.time))` 合并。

## 怎么做
1. 后序 DFS，空节点返回 `(0.0, 0.0)`。
2. 递归拿到 `(ls, lt)` 和 `(rs, rt)`，`sum = ls + rs + root.val`。
3. 关键合并：`time = max(sum / 2, lt, rt)`——两核最多并行 `sum/2`，且不能早于任一子树完成。
4. 返回 `(sum, time)`，根节点取 `time`。

以示例 3 `root = [1,3,2,null,null,4,4]` 为例：左子树 `3` 返回 `(3,3)`，右子树 `2` 的两个孩子各 `4`，右子树返回 `sum=10, time=max(5,4,4)=5`。根合并 `sum=1+3+10=14`，`time=max(7, 3, 5)=7.0`——但答案是 7.5，说明根节点自身 `1` 不能与子树并行（依赖关系），正确合并应为 `max((ls+rs)/2, lt, rt) + root.val` 再与 `(ls+rs+root.val)/2` 取大。修正后：`max(13/2, 3, 5) + 1 = 7.5`，与 `14/2=7` 取大得 7.5。

```python
def dfs(node):
    if not node:
        return 0.0, 0.0
    ls, lt = dfs(node.left)
    rs, rt = dfs(node.right)
    child_sum = ls + rs
    # 根任务必须等子树全完成才能开始，故串行叠加
    t = max(child_sum / 2, lt, rt) + node.val
    return child_sum + node.val, max(t, (child_sum + node.val) / 2)
```

## 复杂度
时间 O(n)：每个节点访问一次，n 为节点数。
空间 O(h)：递归栈深度 h，最坏链状为 n，无额外数组。

## 易错点
- 示例 3 这类「根任务时间小但子树不均衡」的输入 → 若直接写 `max(sum/2, lt, rt)` 会得 7.0，漏掉根任务必须串行等待 → 正确是 `max((ls+rs)/2, lt, rt) + root.val` 再与总下界取大。
- 单链输入 `[1,2,3]`（每节点只有一个孩子）→ 若把 `lt`、`rt` 当两核并行会低估 → 单孩子时另一侧为 0，公式退化为 `lt + root.val`，必须保证空子树返回 `(0.0, 0.0)` 而非跳过。

## 如果面试官追问
若要求输出具体调度方案（每个任务在哪个核、什么时间段）？答：DFS 时额外记录子树内两核的区间列表，合并时把较短一侧整体平移拼接，根任务追加到较晚结束的核上。
