## 一句话思路
用 dp[i] 表示前 i 个数的最少段数，转移时枚举上一段起点 j，靠「质因子 → 最近可行下标」的哈希把枚举压到 O(n log A)。

## 怎么做
1. 预处理 10^6 以内每个数的最小质因子，用于 O(log A) 分解 nums 中每个数。
2. 设 dp[i] 为前 i 个元素的最少段数，dp[0]=0，其余初始化为 i（每个数单独成段）。
3. 维护 `best[p]` = 所有满足「nums[j] 含质因子 p」的 j 中，dp[j] 的最小值；转移 `dp[i+1] = min(dp[i]+1, best[p]+1)`，p 取遍 nums[i] 的质因子。
4. 转移后把 dp[i] 写回 nums[i] 的所有质因子对应的 best。

以 `nums = [2,3,3,2,3,3]` 为例，走到 i=3（值 2）时，best[2] 里存的是 j=0 的 dp[0]=0，于是 dp[4]=min(dp[3]+1, 0+1)=1；走到 i=5（值 3）时 best[3] 已是 dp[2]=1，得 dp[6]=2，与答案一致。

```python
dp = [0] + [i for i in range(1, n + 1)]
best = {}
for i, x in enumerate(nums):
    for p in factors(x):          # 去重后的质因子
        dp[i + 1] = min(dp[i + 1], best.get(p, i) + 1)
    for p in factors(x):
        best[p] = min(best.get(p, n), dp[i])
return dp[n]
```

## 复杂度
时间 O(n log A)，n 来自遍历数组，log A 来自分解每个数（A=10^6）。
空间 O(A)，最小质因子表和 best 哈希各占一份。

## 易错点
- 同一位置先更新 dp 再写 best，若顺序颠倒，`nums=[2,2]` 会用 dp[1]=1 覆盖 best[2]=0，答案错成 2 而非 1；必须先算 dp[i+1] 再写 best。
- 分解时不去重质因子，`nums=[4,2]` 会把 2 重复写入 best 两次，虽不致命但 `nums=[8,4,2]` 这类链式数据会放大常数；分解后必须用 set 去重。

## 如果面试官追问
要求输出具体切分方案怎么办？答：转移时额外记录每个 dp[i+1] 取自哪个 j，回溯即可还原每段头尾。
