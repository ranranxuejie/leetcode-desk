import re
import textwrap
from typing import List

p = r"教程\29-专题9-动态规划（上）线性·路径·股票.md"
t = open(p, encoding="utf-8").read()
blocks = re.findall(r"```python\n(.*?)```", t, flags=re.S)
for i, b in enumerate(blocks, 1):
    s = textwrap.dedent(b)
    if "class Solution" not in s:
        continue
    g = {"__name__": "t", "List": List}
    exec("from typing import List\n" + s, g)
    C = g["Solution"]
    print(i, [m for m in dir(C) if not m.startswith("_")])
