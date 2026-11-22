## 一句话思路
按行做状态压缩 DP，`f[i][mask]` 表示前 i 行铺完、第 i 行伸出到第 i+1 行的占用状态为 mask 时的最大骨牌数。

## 怎么做
1. 把 `broken` 转成每行的坏格位掩码 `bad[i]`，`n` 取较小维做行数，减少状态宽度。
2. 逐行枚举「上一行传下来的占用 `prev`」和「本行自身横放/竖放后的占用 `cur`」，用 DFS 生成本行所有合法填法。
3. 转移时 `cur & bad[i]` 必须为 0，且 `cur & prev` 必须为 0（同一格不能被两行同时占）。
4. 答案取最后一行 `prev=0` 的最大值。

以示例 1 `n=2, m=3, broken=[[1,0],[1,1]]` 为例：`bad[0]=0b000`，`bad[1]=0b011`。第 0 行可横放两块占满 `0b111`，向第 1 行伸出 `0b000`；也可竖放在第 2 列，向第 1 行伸出 `0b100`。后者与 `bad[1]` 不冲突，最终得 2。

```python
def dfs(col, cur, nxt, cnt):
    if col >= m:
        res[prev][cur] = max(res[prev][cur], cnt)
        return
    if cur & (1 << col):
        dfs(col + 1, cur, nxt, cnt)
        return
    dfs(col + 1, cur | (1 << col), nxt, cnt)          # 留空
    if col + 1 < m and not (cur >> (col+1)) & 1:
        dfs(col + 2, cur | (3 << col), nxt, cnt + 1)  # 横放
    if not (nxt >> col) & 1:
        dfs(col + 1, cur | (1 << col), nxt | (1 << col), cnt + 1)  # 竖放
```

外层对每行 `i`、每个 `prev` 调 `dfs(0, prev, 0, 0)`，把结果累加到 `f[i+1][nxt]`。

## 复杂度
时间：`O(n * 2^m * 2^m)`，每行枚举 prev 与 cur 两两组合，DFS 分支常数级。
空间：`O(2^m)` 存两行 DP 数组，`bad` 数组 `O(n)`。

## 易错点
- `n=8, m=1` 时若固定按列做状态，状态宽度变成 8 位但行数只有 1，白跑 `2^8`；应先交换使 `m = min(n, m)`，否则 `2^8` 枚举在 `m=1` 时纯浪费。
- 竖放时 `nxt` 位已置 1 仍继续递归 → 同一格被两块骨牌覆盖，答案偏大；DFS 里必须先判 `not (nxt >> col) & 1` 再放竖牌，且 `cur` 与 `nxt` 的位不能重叠。

## 如果面试官追问
问：要求输出具体摆放方案怎么办？
答：DP 时额外存 `choice[i][prev][cur]` 记录每行选了哪种填法，最后从 `f[n][0]` 回溯即可。
