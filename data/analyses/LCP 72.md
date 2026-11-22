## 一句话思路
每轮线性扫描找相邻和最小的位置并原地合并，因为 n≤1000、最多合并 500 次，暴力足够。

## 怎么做
1. 目标长度 `target = len(supplies) // 2`，循环条件是 `len(supplies) > target`。
2. 每轮扫 `i` 从 0 到 `len(supplies)-2`，用 `supplies[i] + supplies[i+1]` 和当前最优值比较，严格小于才更新，这样并列时天然保留最小编号。
3. 合并：`supplies[i] = supplies[i] + supplies[i+1]`，再 `supplies.pop(i+1)`，长度减一。
4. 回到步骤 2，直到长度等于 `target`。

以 `supplies = [7,3,6,1,8]` 为例，第一轮扫描得到各相邻和 `[10,9,7,9]`，最小值 7 落在 `i=2`（6+1），合并后 `[7,3,7,8]`；第二轮相邻和 `[10,10,15]`，`i=0` 与 `i=1` 并列 10，因用严格小于，`best_i` 停在 0，合并成 `[10,7,8]`；第三轮只剩 `[10,15]`，长度 2 等于 `5//2`，结束。

```python
target = len(supplies) // 2
while len(supplies) > target:
    best_i, best_sum = 0, supplies[0] + supplies[1]
    for i in range(1, len(supplies) - 1):
        s = supplies[i] + supplies[i + 1]
        if s < best_sum:
            best_sum, best_i = s, i
    supplies[best_i] += supplies[best_i + 1]
    supplies.pop(best_i + 1)
```

## 复杂度
时间：O(n²)，每轮 O(n) 扫描，共约 n/2 轮，n 是当前车队长度。
空间：O(1) 额外空间，只在原列表上 `pop` 和累加。

## 易错点
- `supplies = [1,1,1,1]` → 若用 `<=` 更新最优，并列时会取到最右边的 `i`，合并成 `[1,1,2]` 而非正确的 `[2,1,1]` → 必须用严格小于，让 `best_i` 停在最小编号。
- `supplies = [1,3,1,5]` → 若先算好所有相邻和再统一合并，或忘记每轮重算，第二轮会拿过期的和去比 → 每次 `pop` 后相邻关系全变，必须在新列表上重新扫描。

## 如果面试官追问
若 n 放大到 10⁵ 怎么办？用堆存 `(相邻和, 左下标)` 加双向链表，懒删除失效项，O(n log n)。
