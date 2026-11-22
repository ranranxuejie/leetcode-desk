"""Smoke-test the helper snippets that appear in 教程/01."""
from collections import deque


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


def build_list(vals):
    dummy = ListNode()
    cur = dummy
    for v in vals:
        cur.next = ListNode(v)
        cur = cur.next
    return dummy.next


def build_tree(vals):
    if not vals:
        return None
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


def to_list(node):
    out = []
    while node:
        out.append(node.val)
        node = node.next
    return out


# 1. list 构造
assert to_list(build_list([1, 2, 3])) == [1, 2, 3]
assert to_list(build_list([])) is not None or True
assert build_list([]) is None

# 2. tree 构造（LeetCode 层序格式）
root = build_tree([3, 9, 20, None, None, 15, 7])
assert root.val == 3 and root.left.val == 9 and root.right.val == 20
assert root.right.left.val == 15 and root.right.right.val == 7

# 3. 反转链表（模板 ⑪）
def reverse(head):
    prev, cur = None, head
    while cur:
        nxt = cur.next
        cur.next = prev
        prev = cur
        cur = nxt
    return prev


assert to_list(reverse(build_list([1, 2, 3, 4]))) == [4, 3, 2, 1]

# 4. 最大深度（模板 ⑫）
def max_depth(node):
    if node is None:
        return 0
    return max(max_depth(node.left), max_depth(node.right)) + 1


assert max_depth(build_tree([3, 9, 20, None, None, 15, 7])) == 3

# 5. 二分（模板 ⑮）
def bsearch(nums, target):
    left, right = 0, len(nums) - 1
    while left <= right:
        mid = (left + right) // 2
        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1


assert bsearch([-1, 0, 3, 5, 9, 12], 9) == 4
assert bsearch([-1, 0, 3, 5, 9, 12], 2) == -1
assert bsearch([5], 5) == 0

# 6. 前缀和 + 哈希（模板 ②）
def subarray_sum(nums, k):
    count = {0: 1}
    pre = 0
    ans = 0
    for x in nums:
        pre += x
        if pre - k in count:
            ans += count[pre - k]
        count[pre] = count.get(pre, 0) + 1
    return ans


assert subarray_sum([1, 1, 1], 2) == 2
assert subarray_sum([1, 2, 3], 3) == 2

# 7. 单调栈（模板 ⑧）：每日温度
def daily_temperatures(t):
    stack = []
    ans = [0] * len(t)
    for i, x in enumerate(t):
        while stack and t[stack[-1]] < x:
            j = stack.pop()
            ans[j] = i - j
        stack.append(i)
    return ans


assert daily_temperatures([73, 74, 75, 71, 69, 72, 76, 73]) == [1, 1, 4, 2, 1, 1, 0, 0]

# 8. 滑动窗口变长（模板 ⑤）：无重复最长子串
def longest_unique(s):
    last = {}
    left = 0
    ans = 0
    for right, c in enumerate(s):
        if c in last:
            left = max(left, last[c] + 1)
        last[c] = right
        ans = max(ans, right - left + 1)
    return ans


assert longest_unique("abcabcbb") == 3
assert longest_unique("bbbbb") == 1
assert longest_unique("pwwkew") == 3
assert longest_unique("abba") == 2

print("ALL OK")
