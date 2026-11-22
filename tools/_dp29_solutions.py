from typing import List


class Solution70:
    def climbStairs(self, n: int) -> int:
        if n <= 2:
            return n
        a, b = 1, 2
        for _ in range(3, n + 1):
            a, b = b, a + b
        return b


class Solution62:
    def uniquePaths(self, m: int, n: int) -> int:
        dp = [1] * n
        for _ in range(1, m):
            for j in range(1, n):
                dp[j] += dp[j - 1]
        return dp[-1]


class Solution63:
    def uniquePathsWithObstacles(self, obstacleGrid: List[List[int]]) -> int:
        m, n = len(obstacleGrid), len(obstacleGrid[0])
        dp = [0] * n
        dp[0] = 1
        for i in range(m):
            for j in range(n):
                if obstacleGrid[i][j] == 1:
                    dp[j] = 0
                elif j > 0:
                    dp[j] += dp[j - 1]
        return dp[-1]


class Solution64:
    def minPathSum(self, grid: List[List[int]]) -> int:
        m, n = len(grid), len(grid[0])
        dp = [float("inf")] * n
        dp[0] = 0
        for i in range(m):
            for j in range(n):
                if j == 0:
                    dp[j] = dp[j] + grid[i][j]
                else:
                    dp[j] = min(dp[j], dp[j - 1]) + grid[i][j]
        return dp[-1]


class Solution72:
    def minDistance(self, word1: str, word2: str) -> int:
        m, n = len(word1), len(word2)
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        for i in range(m + 1):
            dp[i][0] = i
        for j in range(n + 1):
            dp[0][j] = j
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if word1[i - 1] == word2[j - 1]:
                    dp[i][j] = dp[i - 1][j - 1]
                else:
                    dp[i][j] = min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1
        return dp[m][n]


class Solution121:
    def maxProfit(self, prices: List[int]) -> int:
        min_price = float("inf")
        best = 0
        for p in prices:
            min_price = min(min_price, p)
            best = max(best, p - min_price)
        return best


class Solution122:
    def maxProfit(self, prices: List[int]) -> int:
        profit = 0
        for i in range(1, len(prices)):
            if prices[i] > prices[i - 1]:
                profit += prices[i] - prices[i - 1]
        return profit


class Solution123:
    def maxProfit(self, prices: List[int]) -> int:
        buy1 = buy2 = float("-inf")
        sell1 = sell2 = 0
        for p in prices:
            buy1 = max(buy1, -p)
            sell1 = max(sell1, buy1 + p)
            buy2 = max(buy2, sell1 - p)
            sell2 = max(sell2, buy2 + p)
        return sell2


class Solution188:
    def maxProfit(self, k: int, prices: List[int]) -> int:
        if not prices or k == 0:
            return 0
        if k >= len(prices) // 2:
            return sum(max(0, prices[i] - prices[i - 1]) for i in range(1, len(prices)))
        buy = [float("-inf")] * (k + 1)
        sell = [0] * (k + 1)
        for p in prices:
            for j in range(1, k + 1):
                buy[j] = max(buy[j], sell[j - 1] - p)
                sell[j] = max(sell[j], buy[j] + p)
        return sell[k]


class Solution53:
    def maxSubArray(self, nums: List[int]) -> int:
        best = cur = nums[0]
        for x in nums[1:]:
            cur = max(x, cur + x)
            best = max(best, cur)
        return best


cases = [
    ("70", Solution70().climbStairs, [(2, 2), (3, 3), (1, 1), (5, 8), (45, 1836311903)]),
    ("62", Solution62().uniquePaths, [(3, 7, 28), (3, 2, 3), (1, 1, 1), (1, 5, 1), (7, 3, 28)]),
    ("63", Solution63().uniquePathsWithObstacles, [([[0, 0, 0], [0, 1, 0], [0, 0, 0]], 2), ([[0, 1], [0, 0]], 1), ([[1]], 0), ([[0]], 1)]),
    ("64", Solution64().minPathSum, [([[1, 3, 1], [1, 5, 1], [4, 2, 1]], 7), ([[1, 2, 3]], 6), ([[1], [2], [3]], 6)]),
    ("72", Solution72().minDistance, [("horse", "ros", 3), ("intention", "execution", 5), ("", "", 0), ("", "abc", 3), ("a", "a", 0)]),
    ("121", Solution121().maxProfit, [([7, 1, 5, 3, 6, 4], 5), ([7, 6, 4, 3, 1], 0), ([1], 0), ([2, 4, 1], 2)]),
    ("122", Solution122().maxProfit, [([7, 1, 5, 3, 6, 4], 7), ([1, 2, 3, 4, 5], 4), ([7, 6, 4, 3, 1], 0), ([1], 0)]),
    ("123", Solution123().maxProfit, [([3, 3, 5, 0, 0, 3, 1, 4], 6), ([1, 2, 3, 4, 5], 4), ([7, 6, 4, 3, 1], 0), ([1], 0)]),
    ("188", Solution188().maxProfit, [(2, [2, 4, 1], 2), (2, [3, 2, 6, 5, 0, 3], 7), (0, [1, 2], 0), (1, [1, 2], 1), (2, [1], 0)]),
    ("53", Solution53().maxSubArray, [([-2, 1, -3, 4, -1, 2, 1, -5, 4], 6), ([1], 1), ([-1], -1), ([-2, -1], -1)]),
]

total = 0
for name, fn, args in cases:
    for c in args:
        if len(c) == 2:
            got = fn(*c[:-1])
            exp = c[-1]
        else:
            got = fn(*c[:-1])
            exp = c[-1]
        total += 1
        assert got == exp, f"{name}: args={c[:-1]} got={got} expected={exp}"
print("ALL", total, "ASSERTIONS PASSED")
