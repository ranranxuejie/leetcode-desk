## 一句话思路
统计每种知识点的出现次数，从次数最多的开始贪心取，直到凑够 N 道题。

## 怎么做
1. 用哈希表统计 `questions` 中每个知识点出现的次数，得到频次列表。
2. 将频次从大到小排序。
3. 从最大的频次开始累加，累加到 ≥ `N = len(questions) // 2` 时停止，累加用掉的种类数就是答案。

以示例 2 为例：`questions = [1,5,1,3,4,5,2,5,3,3,8,6]`，`N = 6`。频次为 `{3:3, 5:3, 1:2, 4:1, 2:1, 8:1, 6:1}`，排序后 `[3,3,2,1,1,1,1]`。先取 3（累计 3，种类 1），再取 3（累计 6 ≥ 6，种类 2），返回 2。

```python
from collections import Counter

def half_questions(questions):
    n = len(questions) // 2
    freq = sorted(Counter(questions).values(), reverse=True)
    total = 0
    for i, f in enumerate(freq):
        total += f
        if total >= n:
            return i + 1
    return len(freq)
```

关键点：`total >= n` 的判断在累加后立即做，`i + 1` 就是已用的种类数。

## 复杂度
时间：O(m + k log k)，m 是数组长度，k 是不同知识点个数（≤1000）。
空间：O(k)，Counter 存频次，排序额外 O(k)。

## 易错点
- 输入 `questions = [2,1,6,2]`，`N = 2`：若按「从小到大」取频次，会先取 1、1、1 三种，错成 3；正确是从大到小取，频次 `[2,1,1]` 先取 2 就够，返回 1。
- 输入 `questions = [1,1,2,2]`，`N = 2`：若用 `total > n` 而非 `>=`，取完第一个频次 2 后不满足，会多取一种，错成 2；正确是 `total >= n` 立即返回 1。

## 如果面试官追问
问：如果要求输出具体选了哪些知识点类型？
答：排序时保留 `(频次, 知识点)` 对，累加时把对应知识点记进结果列表即可。
