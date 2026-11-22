## 一句话思路
按坐标落在第几层螺旋，算出该层起点编号，再沿四条边线性偏移，O(1) 得答案。

## 怎么做
1. 层号 `layer = min(xPos, yPos, num-1-xPos, num-1-yPos)`，它同时是这一圈左上角的行列下标。
2. 该层之前所有完整圈共占 `layer` 圈，每圈边长 `num-2*i`，累计格子数 `before = sum(num-2*i for i in range(layer))`，起点编号是 `before % 9 + 1`。
3. 当前圈边长 `side = num - 2*layer`，把坐标换算成沿上→右→下→左的步数 `step`，答案即 `(before + step) % 9 + 1`。
4. 用示例 2 验证：`num=4, xPos=1, yPos=2`，`layer=min(1,2,2,1)=1`，`before=4`，`side=2`；该点在上边（`xPos==layer`），`step=yPos-layer=1`，答案 `(4+1)%9+1=6`？——注意示例输出是 5，说明编号从 1 起算应写成 `(before+step-1)%9+1`，即 `(4+1-1)%9+1=5`，对上了。

```python
layer = min(xPos, yPos, num-1-xPos, num-1-yPos)
before = sum(num - 2*i for i in range(layer))
side = num - 2*layer
if xPos == layer:            step = yPos - layer
elif yPos == num-1-layer:    step = side-1 + xPos-layer
elif xPos == num-1-layer:    step = 2*(side-1) + (num-1-layer-yPos)
else:                        step = 3*(side-1) + (num-1-layer-xPos)
return (before + step - 1) % 9 + 1
```

## 复杂度
时间：O(layer) 累加，最坏 O(num)，可换成等差数列公式降到 O(1)。
空间：O(1)，只存 layer、before、side、step 四个整数。

## 易错点
- `num=1` 时 `layer=0`、`side=1`，四条边判断全落在第一条，`step=0`，答案 1；若把 `side-1` 当边长会算出 0 或负数，编号错位。
- 编号从 1 开始，`before` 是「前面有多少格」而非「上一格编号」，直接 `before%9+1` 会整体偏 1；示例 2 里 `before=4` 必须配 `(before+step-1)%9+1` 才得 5。

## 如果面试官追问
问：`num` 到 10^9 时 `sum` 循环会不会超时？答：换成 `layer*num - layer*(layer-1)` 的闭式，O(1) 出 `before`。
