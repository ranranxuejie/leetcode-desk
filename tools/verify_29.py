"""Extract every class Solution from 29-专题9（上） and run its test cases."""
import re
import textwrap
from typing import List

PATH = r"D:\PycharmProjects\2026\leetcode\教程\29-专题9-动态规划（上）线性·路径·股票.md"
text = open(PATH, encoding="utf-8").read()
blocks = re.findall(r"```python\n(.*?)```", text, flags=re.S)
print("blocks:", len(blocks))

PRELUDE = "from typing import List\n"
classes = {}
for i, b in enumerate(blocks, 1):
    src = textwrap.dedent(b)
    if "class Solution" not in src:
        continue
    g = {"__name__": "t", "List": List}
    exec(PRELUDE + src, g)
    classes[i] = g["Solution"]

print("solution classes:", len(classes))

# (args_list, expected)
TESTS = {
    "9-1": [([2], 2), ([3], 3), ([1], 1), ([5], 8), ([45], 1836311903)],
    "9-2": [([3, 7], 28), ([3, 2], 3), ([1, 1], 1), ([1, 5], 1), ([7, 3], 28)],
    "9-3": [([[[0, 0, 0], [0, 1, 0], [0, 0, 0]]], 2), ([[[0, 1], [0, 0]]], 1), ([[[1]]], 0), ([[[0]]], 1)],
    "9-4": [([[[1, 3, 1], [1, 5, 1], [4, 2, 1]]], 7), ([[[1, 2, 3]]], 6), ([[[1], [2], [3]]], 6)],
    "9-5": [(["horse", "ros"], 3), (["intention", "execution"], 5), (["", ""], 0), (["", "abc"], 3), (["a", "a"], 0)],
    "9-6": [([[7, 1, 5, 3, 6, 4]], 5), ([[7, 6, 4, 3, 1]], 0), ([[1]], 0), ([[2, 4, 1]], 2)],
    "9-7": [([[7, 1, 5, 3, 6, 4]], 7), ([[1, 2, 3, 4, 5]], 4), ([[7, 6, 4, 3, 1]], 0), ([[1]], 0)],
    "9-8": [([[3, 3, 5, 0, 0, 3, 1, 4]], 6), ([[1, 2, 3, 4, 5]], 4), ([[7, 6, 4, 3, 1]], 0), ([[1]], 0)],
    "9-9": [([2, [2, 4, 1]], 2), ([2, [3, 2, 6, 5, 0, 3]], 7), ([0, [1, 2]], 0), ([1, [1, 2]], 1), ([2, [1]], 0)],
    "9-10": [([[-2, 1, -3, 4, -1, 2, 1, -5, 4]], 6), ([[1]], 1), ([[-1]], -1), ([[-2, -1]], -1)],
}

BLOCK_MAP = {
    4: "9-1", 6: "9-2", 7: "9-3", 8: "9-4", 9: "9-5",
    10: "9-6", 11: "9-7", 12: "9-7", 13: "9-8", 14: "9-9", 15: "9-10",
}

total = 0
for idx, key in BLOCK_MAP.items():
    sol = classes[idx]
    meth = [m for m in dir(sol) if not m.startswith("_")][0]
    for args, exp in TESTS[key]:
        got = getattr(sol(), meth)(*args)
        assert got == exp, f"block#{idx} {key} args={args} got={got} exp={exp}"
        total += 1
print("ALL", total, "ASSERTIONS PASSED")

# --- 验证「常见误区」里声称的错误输出 ---
def climb_bad(n):
    if n <= 2:
        return n
    a, b = 1, 2
    for _ in range(3, n + 1):
        a = b
        b = a + b
    return b


def obstacle_bad(g):
    m, n = len(g), len(g[0])
    dp = [1] * n
    for i in range(m):
        for j in range(n):
            if g[i][j] == 1:
                dp[j] = 0
            elif j > 0:
                dp[j] += dp[j - 1]
    return dp[-1]


def minpath_bad(grid):
    m, n = len(grid), len(grid[0])
    dp = [0] * n
    dp[0] = 0
    for i in range(m):
        for j in range(n):
            if j == 0:
                dp[j] = dp[j] + grid[i][j]
            else:
                dp[j] = min(dp[j], dp[j - 1]) + grid[i][j]
    return dp[-1]


print("9-1 拆两句 n=5 ->", climb_bad(5), "(正确 8)")
print("9-3 第一行无脑填1 [[0,0,1,0]] ->", obstacle_bad([[0, 0, 1, 0]]), "(正确 0)")
print("9-4 dp 初始 0 [[1,2,3]] ->", minpath_bad([[1, 2, 3]]), "(正确 6)")
print("9-6 max-min [2,4,1] ->", max([2, 4, 1]) - min([2, 4, 1]), "(正确 2)")
