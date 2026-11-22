# 01 · Python 写算法题的基本功

这一章不教你算法，只补齐"工具"。工具不熟，思路再好也写不出来。

---

## 1. 力扣的代码长什么样

力扣给你一个类，你只需要填方法体，**不用管输入输出**：

```python
class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        # 你只需要写这里
        ...
```

几个和你平时写脚本不一样的地方：

| | 平时写脚本 | 力扣 |
|---|---|---|
| 输入 | `input()` / 读文件 | **方法参数**，已经给你了 |
| 输出 | `print()` | **`return`**，返回值 |
| 类型标注 | 可有可无 | 建议写，帮你想清楚输入输出 |
| 全局变量 | 随便用 | **尽量别用**，用参数和闭包 |

> ⚠️ 注意：**华为机考是 ACM 模式**，要自己写 `input()` 和 `print()`。力扣只练算法，不练 IO。两者要分开准备（见调研报告 §9）。

`List` 需要 `from typing import List`，力扣环境已经帮你 import 了，本地跑要自己加。

---

## 2. Python 操作复杂度速查表（★ 必须记住）

这是最容易踩坑的地方。**同样的逻辑，用错数据结构就从 O(n) 变成 O(n²)。**

| 操作 | 复杂度 | 备注 |
|---|---|---|
| `lst[i]` / `lst[i] = x` | O(1) | 随机访问 |
| `lst.append(x)` / `lst.pop()` | **O(1)** | 尾部操作 |
| `lst.pop(0)` / `lst.insert(0, x)` | **O(n)** | ⚠️ 头部操作要挪整个数组 |
| `x in lst` | **O(n)** | ⚠️ 线性查找 |
| `lst[a:b]` 切片 | O(b-a) | 会复制 |
| `lst.sort()` / `sorted(lst)` | O(n log n) | |
| `x in st` / `x in dct` | **O(1)** | 哈希查找，这是哈希表的价值 |
| `st.add(x)` / `dct[k] = v` | **O(1)** | 平均情况 |
| `dct.get(k, default)` | O(1) | 不会 KeyError |
| `deque.append/popleft` | **O(1)** | 两端都能 O(1) |
| `heapq.heappush/heappop` | O(log n) | 堆 |
| `heapq.heapify(lst)` | O(n) | 建堆比一个个 push 快 |
| `bisect.bisect_left/right` | O(log n) | 有序数组二分 |
| `str` 的 `+=` 在循环里 | **O(n²)** | ⚠️ 每次都新建字符串 |
| `"".join(lst)` | O(n) | ✅ 拼接字符串的正确姿势 |
| `len()` / `min()` / `max()` / `sum()` | O(1) / O(n) | len 是 O(1) |

**三个最高频的坑：**

```python
# ❌ 坑 1：循环里 str += ，O(n²)
res = ""
for c in s:
    res += c          # 每次都复制整个字符串

# ✅ 正确：先收集再 join，O(n)
buf = []
for c in s:
    buf.append(c)
res = "".join(buf)
```

```python
# ❌ 坑 2：用 list 当队列，pop(0) 是 O(n)
q = [1, 2, 3]
q.pop(0)              # O(n)，整体变 O(n²)

# ✅ 正确：deque
from collections import deque
q = deque([1, 2, 3])
q.popleft()           # O(1)
```

```python
# ❌ 坑 3：二维数组的错误初始化
grid = [[0] * 3] * 2  # 两行是同一个对象的引用！改一行两行都变

# ✅ 正确：每一行独立创建
grid = [[0] * 3 for _ in range(2)]
```

---

## 3. 八个必备工具（按使用频率排序）

### 3.1 `dict` —— 哈希表，最常用，没有之一

**它解决的核心问题：把"回头找"变成"O(1) 查表"。**

```python
# 两数之和：不用哈希是 O(n²)，用了是 O(n)
seen = {}                       # 值 -> 下标
for i, x in enumerate(nums):
    if target - x in seen:      # O(1) 查
        return [seen[target - x], i]
    seen[x] = i
```

常用的三种写法：

```python
d = {}
d[k] = d.get(k, 0) + 1          # 计数（不存在的键默认 0）
if k in d: ...                  # 判断存在
for k, v in d.items(): ...      # 遍历
```

### 3.2 `set` —— 只关心"在不在"

```python
seen = set()
if x in seen: ...               # O(1)
seen.add(x)
seen.discard(x)                 # 删除，不存在也不报错
```

> 记住：`set` 和 `dict` 的查找都是 O(1)，`list` 的查找是 O(n)。**只要你在循环里写 `if x in 某个list`，就该换成 set。**

### 3.3 `collections.Counter` —— 一键计数

```python
from collections import Counter
Counter("aabbbc")               # Counter({'b': 3, 'a': 2, 'c': 1})
Counter([1, 1, 2]).most_common(1)   # [(1, 2)]
```

### 3.4 `collections.defaultdict` —— 不用判断键存在

```python
from collections import defaultdict
cnt = defaultdict(int)          # 访问不存在的键自动给 0
cnt["a"] += 1                   # 不会 KeyError

pos = defaultdict(list)         # 自动给空 list
pos["a"].append(1)
```

### 3.5 `collections.deque` —— 队列 / 双端队列

```python
from collections import deque
q = deque()
q.append(x)        # 右边进
q.popleft()        # 左边出 —— O(1)，这是它比 list 强的地方
q.appendleft(x)
q.pop()
```

**BFS 一律用 deque，不要用 list。**

### 3.6 `heapq` —— 堆（优先队列）

```python
import heapq
h = []
heapq.heappush(h, 3)            # O(log n)
heapq.heappush(h, 1)
heapq.heappop(h)                # 1，弹出最小值 O(log n)
h[0]                            # 最小值，O(1) 查看

# 建堆（比逐个 push 快）
nums = [5, 3, 8]
heapq.heapify(nums)             # O(n)

# 求 Top K 大：维护大小为 k 的小顶堆
heapq.nlargest(3, nums)
```

> 坑：`heapq` 只能建**小顶堆**。要小顶堆求最大，存 `-x` 即可。

### 3.7 `bisect` —— 在有序数组里二分

```python
import bisect
a = [1, 3, 5, 7]
bisect.bisect_left(a, 5)        # 2（第一个 >= 5 的位置）
bisect.bisect_right(a, 5)       # 3（第一个 > 5 的位置）
bisect.insort(a, 4)             # 插入并保持有序
```

### 3.8 `sorted(key=...)` —— 自定义排序

```python
intervals.sort(key=lambda x: x[0])          # 按左端点
words.sort(key=len)                          # 按长度
words.sort(key=lambda w: (-len(w), w))       # 长度降序，同长度按字典序
```

---

## 4. 十个常用小技巧

```python
# 1. 交换
a, b = b, a

# 2. 无穷大（求最小值时初始化用）
best = float('inf')
best = float('-inf')        # 求最大值

# 3. 整除与取余（注意负数）
7 // 2      # 3
7 % 2       # 1
-7 // 2     # -4（向下取整，不是 -3！）

# 4. 字符串反转 / 数组反转
s[::-1]
lst[::-1]        # 返回新列表
lst.reverse()    # 原地反转

# 5. 字符 <-> 数字
ord('a')     # 97
chr(97)      # 'a'
# 字母表下标：ord(c) - ord('a')

# 6. enumerate：同时要下标和值
for i, x in enumerate(nums):
    ...

# 7. zip：并行遍历
for a, b in zip(nums1, nums2):
    ...

# 8. any / all
any(x > 0 for x in nums)
all(x > 0 for x in nums)

# 9. 列表推导式
squares = [x * x for x in nums if x > 0]

# 10. 二维数组初始化（再强调一次）
grid = [[0] * n for _ in range(m)]
```

---

## 5. 递归怎么写（分册 C 的地基）

递归只有两个部分：

```python
def f(n):
    if 基线条件:              # 1. 什么时候停
        return 某个直接答案
    return 用 f(更小的问题) 组合  # 2. 怎么把问题变小
```

**最重要的思维方式叫「信任递归」**：写 `f(n)` 的时候，**假设 `f(n-1)` 已经能正确返回答案**，你只管怎么用它。不要在脑子里展开整个调用栈——人会疯的。

以"二叉树最大深度"为例：

```python
def maxDepth(root):
    if root is None:                     # 基线：空树深度 0
        return 0
    left = maxDepth(root.left)           # 信任：左子树深度算好了
    right = maxDepth(root.right)         # 信任：右子树深度算好了
    return max(left, right) + 1          # 我这一层：取大的 +1
```

**递归的两个现实问题：**
1. Python 默认递归深度约 1000 层，链式结构很长时会 `RecursionError`。力扣上偶尔需要 `sys.setrecursionlimit(10000)`，或者改写成迭代。
2. 递归有函数调用开销，能用简单迭代就别硬递归。

---

## 6. 链表和树在 Python 里怎么表示

Python 没有指针，但有**引用**——`a.next = b` 就是让 a 指向 b，效果和 C 的指针一样，只是不用管内存。

力扣后台已经定义好了，**你不需要自己写**，但要知道长什么样：

```python
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
```

画成图就是：

```
链表：1 -> 2 -> 3 -> None
树：      1
        /   \
       2     3
      / \
     4   5
```

**本地测试时**要自己构造，写两个小工具函数会省很多事：

```python
def build_list(vals):
    dummy = ListNode()
    cur = dummy
    for v in vals:
        cur.next = ListNode(v)
        cur = cur.next
    return dummy.next

def build_tree(vals):        # 层序数组，None 表示空
    if not vals:
        return None
    from collections import deque
    root = TreeNode(vals[0])
    q = deque([root])
    i = 1
    while q and i < len(vals):
        node = q.popleft()
        if i < len(vals) and vals[i] is not None:
            node.left = TreeNode(vals[i])
            q.append(node.left)
        i += 1
        if i < len(vals) and vals[i] is not None:
            node.right = TreeNode(vals[i])
            q.append(node.right)
        i += 1
    return root
```

---

## 7. 调试：print 大法 + 小黄鸭

算法题不需要 debugger，两个办法够用：

**办法一：把中间状态打出来。** 在循环里加一行：

```python
for i, x in enumerate(nums):
    print(f"i={i}, x={x}, window={nums[left:i+1]}")
```

力扣上会显示在「标准输出」里。**看一遍就知道窗口滑得对不对。**

**办法二：小黄鸭。** 找个人（或者对着空气）把你的思路讲一遍，讲着讲着你自己就发现漏洞了。

**调试的三个高频检查点：**
1. 空输入 / 单元素输入 —— 你的初始化扛得住吗？
2. 循环的第一次和最后一次 —— 边界有没有多算/少算？
3. 返回的是"长度"还是"下标"还是"具体内容" —— 题目要什么？

---

## 本章自检清单

读完这章，你应该能回答：

- [ ] `x in list` 和 `x in set` 的复杂度差多少？为什么？
- [ ] 循环里拼接字符串为什么不能 `+=`？
- [ ] `[[0]*3]*2` 错在哪？
- [ ] 什么时候用 `deque` 而不是 `list`？
- [ ] `heapq` 怎么求 Top K 大？
- [ ] 递归的"信任递归"是什么意思？
- [ ] 链表和树在 Python 里靠什么连起来？

答不上来的，回去再看对应小节。**这章不熟，后面每一册都会卡。**

下一章：[02-复杂度的直觉](02-复杂度的直觉.md)
