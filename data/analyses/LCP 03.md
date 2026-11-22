## 一句话思路
把每个点映射到「第几轮 + 轮内第几步」，用哈希表存一轮内的前缀坐标，逐点判定可达且不撞障碍。

## 怎么做
1. 先扫一遍 `command`，记录一轮结束时的位移 `(dx, dy)`，并把轮内每个前缀坐标（含起点 `(0,0)`）放进集合 `seen`。
2. 对任意点 `(px, py)`，若 `px < 0 or py < 0` 直接不可达；否则轮数 `k = px // dx`（`dx` 为 0 时改用 `py // dy`），要求 `px - k*dx` 与 `py - k*dy` 拼成的轮内坐标在 `seen` 里。
3. 终点先判可达，不可达直接 `False`；可达则对每个障碍判「可达且轮数 ≤ 终点轮数」，命中就 `False`。
4. 全部障碍安全则 `True`。

以示例 2 为例：`command = "URR"`，一轮位移 `dx=2, dy=1`，`seen = {(0,0),(0,1),(1,1),(2,1)}`。终点 `(3,2)`：`k = 3//2 = 1`，轮内 `(3-2, 2-1) = (1,1)` 在 `seen` 中，可达。障碍 `(2,2)`：`k = 2//2 = 1`，轮内 `(0,1)` 在 `seen` 中，且轮数 1 ≤ 终点轮数 1，命中，返回 `False`。

```python
dx = command.count('R')
dy = command.count('U')
seen = {(0, 0)}
cx = cy = 0
for c in command:
    if c == 'R': cx += 1
    else: cy += 1
    seen.add((cx, cy))

def reach(px, py):
    if px < 0 or py < 0: return False
    k = px // dx if dx else py // dy
    return (px - k * dx, py - k * dy) in seen
```

## 复杂度
时间：O(len(command) + len(obstacles))，每个点 O(1) 查表。
空间：O(len(command))，`seen` 存一轮内至多 1001 个前缀坐标。

## 易错点
- 障碍在终点之后（如示例 3 的 `(4,2)`）：只判「可达」会误判为撞上 → 必须额外比较轮数 `k_obs <= k_target`，`(4,2)` 的 `k=2 > 1`，应放行。
- `dx` 或 `dy` 为 0 时（题面保证至少一个 U 和一个 R，但单轮内某方向可能为 0 需注意整除）：用 `px // dx` 会 `ZeroDivisionError` → 按 `dx` 是否为 0 切换用 `py // dy` 算轮数。

## 如果面试官追问
若 `x, y` 放大到 `1e18` 且 `obstacles` 到 `1e5`，做法还成立吗？成立，仍是每点 O(1) 哈希查表，总 O(len(command) + len(obstacles))，与坐标大小无关。
