## 一句话思路
排序后取最大的 `cnt` 张，若和为偶数直接返回，否则用「换一张」的最小代价把奇偶性翻转。

## 怎么做
1. 降序排序，取前 `cnt` 张求和 `total`，同时记录这 `cnt` 张里最小的奇数 `min_odd_in` 和最小的偶数 `min_even_in`。
2. 在剩下的 `cards[cnt:]` 里记录最大的奇数 `max_odd_out` 和最大的偶数 `max_even_out`。
3. 若 `total` 是偶数，直接返回 `total`；否则用两种换法翻转奇偶性，取损失最小的：`total - min_odd_in + max_even_out`（换出奇数、换入偶数），或 `total - min_even_in + max_odd_out`（换出偶数、换入奇数）。
4. 两种换法都不可行（缺牌）则返回 0。

以 `cards = [1,2,8,9], cnt = 3` 为例：降序后 `[9,8,2,1]`，前 3 张 `total = 19`（奇数），`min_odd_in = 9`、`min_even_in = 8`，剩余 `[1]` 里 `max_odd_out = 1`、`max_even_out = None`。换法一缺 `max_even_out` 不可行；换法二得 `19 - 8 + 1 = 12`，但示例答案是 18——注意这里 `total` 取的是前 3 张，而 18 来自 `1+8+9`，说明「取最大 cnt 张」在奇偶约束下不总是最优，需按上述两种换法比较后取可行最大值，本题可行解为 18（换出 2 换入 1 得 `9+8+1=18`，即 `total - min_even_in + max_odd_out = 19 - 2 + 1 = 18`，`min_even_in` 应为 2 而非 8，因为 2 在剩余里）。

```python
cards.sort(reverse=True)
total = sum(cards[:cnt])
min_odd_in = min((x for x in cards[:cnt] if x % 2), default=None)
min_even_in = min((x for x in cards[:cnt] if x % 2 == 0), default=None)
max_odd_out = max((x for x in cards[cnt:] if x % 2), default=None)
max_even_out = max((x for x in cards[cnt:] if x % 2 == 0), default=None)
if total % 2 == 0:
    return total
best = -1
if min_odd_in is not None and max_even_out is not None:
    best = max(best, total - min_odd_in + max_even_out)
if min_even_in is not None and max_odd_out is not None:
    best = max(best, total - min_even_in + max_odd_out)
return best if best >= 0 else 0
```

## 复杂度
时间：排序 `O(n log n)`，`n = len(cards)`，后续扫描 `O(n)`。
空间：排序栈空间 `O(log n)`，额外只存 4 个极值变量。

## 易错点
- `cards = [1,2,8,9], cnt = 3` 若只取前 3 大得 `19` 为奇数就返回 0，会错成 0；正确做法是换一张（换出 2 换入 1）得 18。
- `cards = [3,3,1], cnt = 1` 全是奇数，`min_even_in` 和 `max_even_out` 均为 `None`，两种换法都不可行，会错成返回 `3`；正确做法是判空后返回 0。

## 如果面试官追问
若要求输出具体选了哪几张牌？答：记录 4 个极值对应的下标，翻转时交换这两张的下标即可还原方案。
