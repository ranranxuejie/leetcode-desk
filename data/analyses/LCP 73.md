## 一句话思路
用一个 `seen` 集合累积所有已知营地，逐条探险统计「不在 `seen` 里」的营地数，边统计边并入 `seen`。

## 怎么做
1. 把 `expeditions[0]` 按 `->` 切分后全部塞进 `seen`，作为初始已知营地。
2. 从 `i = 1` 开始遍历，对每条记录先 `split("->")`，注意空串要跳过。
3. 对每个营地名 `c`，若 `c not in seen` 则计数加一，并立刻 `seen.add(c)`——同一记录内重复出现只算一次。
4. 用 `best` 记录最大新发现数、`ans` 记录对应索引，只有严格大于才更新，保证「索引最小」。

以示例 1 为例：初始 `seen = {"leet", "code"}`。处理 `i = 1` 的 `"leet->code->Campsite->Leet"` 时，`"Campsite"` 和 `"Leet"` 不在 `seen` 中，`cnt` 累到 2，随后 `seen` 变为 `{"leet","code","Campsite","Leet"}`；到 `i = 2` 时 `"courier"` 只贡献 1，最终 `ans = 1`。

```python
seen = set(expeditions[0].split("->")) - {""}
best, ans = 0, -1
for i in range(1, len(expeditions)):
    cnt = 0
    for c in expeditions[i].split("->"):
        if c and c not in seen:
            seen.add(c)
            cnt += 1
    if cnt > best:
        best, ans = cnt, i
return ans
```

关键点：`seen.add(c)` 必须写在计数循环内部，不能等整条记录统计完再批量加入，否则同一条记录里重复出现的营地会被重复计数。

## 复杂度
时间 O(n)：n 为所有记录中营地名的总个数，每个名字做一次哈希查找。
空间 O(n)：`seen` 最多存 n 个不同营地名。

## 易错点
- 输入 `["Alice->Dex","","Dex"]` → 若直接 `"".split("->")` 得到 `[""]`，会把空串当营地加进 `seen` 并可能计数 → 切分后必须过滤空串，用 `if c` 或集合差 `- {""}`。
- 输入 `["","Gryffindor->Slytherin->Gryffindor", ...]` → 若先收集整条记录的名字再去重计数，或忘记 `expeditions[0]` 为空串时 `seen` 应为空集 → 初始集合要允许为空，且同条记录内重复名字只计一次，靠「边查边加」自然去重。

## 如果面试官追问
若要求返回新发现营地的具体名单而不只是索引？答：把 `cnt` 换成 `new = [c for c in ... if c not in seen]`，注意列表推导里不能同时 `add`，需先过滤再统一并入 `seen`。
