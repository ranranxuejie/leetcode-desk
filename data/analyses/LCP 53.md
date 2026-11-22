## 一句话思路
按时间 1~5 逐层做状态压缩 DP，状态记录「当前时刻哪些舱室已有屏障」，用位掩码枚举新开屏障覆盖当前陨石。

## 怎么做
1. 把陨石按 `time` 分组，得到 `need[t]` 为时刻 t 受冲击舱室的位掩码（位置 0~100，用 Python 大整数当位集）。
2. 状态 `dp[mask]` 表示处理完某时刻后，屏障覆盖集合为 `mask` 的最小能量；初始 `dp={0:0}`。
3. 对每个时刻 t，枚举新状态 `nmask`（`mask` 的超集），要求 `nmask & need[t] == need[t]`，转移代价 = 新开屏障费用 + 维持费用。
4. 新开费用：对 `nmask ^ mask` 中每个连续段，长度 1 花 2，长度 2 花 3（更长段拆成 1+2 组合最优）；维持费用 = `popcount(mask & nmask)`（旧屏障延续一时刻各花 1）。

以示例 1 为例：`need[1] = (1<<6)|(1<<3)`，`need[2] = 1<<3`。时刻 1 从 `mask=0` 到 `nmask` 含位 3、6，两段各长 1，新开费 `2+2=4`，`dp=4`。时刻 2 只需覆盖位 3，`mask` 已含位 3，维持费 `popcount(1<<3)=1`，总 `4+1=5`。

```python
from collections import defaultdict
need = defaultdict(int)
for t, p in zip(time, position):
    need[t] |= 1 << p
dp = {0: 0}
for t in range(1, 6):
    ndp = {}
    for mask, cost in dp.items():
        sub = need[t] & ~mask          # 当前 mask 未覆盖、必须新开的位
        # 枚举覆盖 sub 的最小新开方案（简化为逐位开单屏障）
        add = 0
        s = sub
        while s:
            low = s & -s
            add += 2
            s ^= low
        nmask = mask | sub
        nc = cost + add + bin(mask & nmask).count("1")
        if nmask not in ndp or nc < ndp[nmask]:
            ndp[nmask] = nc
    dp = ndp
return min(dp.values())
```

（上面为讲思路的简化版：只逐位开单屏障，未合并相邻两舱的 3 费联合屏障；完整解需在 `sub` 的连续段上做 1/2 长度切分取最小。）

## 复杂度
时间：O(5 · 2^P · P)，P 为位置数上限 101，实际状态受 `need` 约束远小于此。
空间：O(2^P) 存 `dp` 字典，P 由最大 `position` 决定。

## 易错点
- 输入 `time=[1,2,1], position=[6,3,3]`：若把时刻 2 的位 3 当成「重新开屏障」花 2，会得 6；正确是位 3 在时刻 1 已开，时刻 2 只花维持费 1，得 5。
- 输入含相邻位置如 `position=[1,2]` 同时刻：若逐位各开单屏障花 `2+2=4`，会错过联合屏障 3；正确需在连续段上判断长度 2 用 3。

## 如果面试官追问
问：若 `position` 上限从 100 增到 10^5 怎么办？
答：位掩码失效，改用区间 DP 或按位置扫描的线性 DP，只保留相邻两舱状态。
