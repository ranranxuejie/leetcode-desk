# 校验 build_web_data 改 get_text("") 之后示例解析没有回归
import json
import glob
import os
import sys

before_dir = ".tmp/refs-check/statements-before"
after_dir = "app/public/data/statements"

def load(dirpath):
    out = {}
    for path in sorted(glob.glob(os.path.join(dirpath, "*.json"))):
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        for no, detail in data.items():
            out[no] = detail
    return out

before = load(before_dir)
after = load(after_dir)
print(f"problems before={len(before)} after={len(after)}")

shrink = 0
grow = 0
line_diff = 0
glued = 0
examples = []

for no, old in before.items():
    new = after.get(no)
    if not new:
        continue
    a = old.get("examples") or []
    b = new.get("examples") or []
    if len(b) < len(a):
        shrink += 1
        examples.append((no, "shrink", len(a), len(b)))
    elif len(b) > len(a):
        grow += 1
    for i, ex in enumerate(b):
        inp = ex.get("input") or ""
        out = ex.get("output") or ""
        # 「输出：」粘在输入行尾，说明换行分隔丢了
        if "输出：" in inp or "输出:" in inp:
            glued += 1
            examples.append((no, "glued", i, inp[:60]))
        if i < len(a):
            old_in = (a[i].get("input") or "").count("\n")
            new_in = inp.count("\n")
            if old_in != new_in:
                line_diff += 1
                if line_diff <= 8:
                    examples.append((no, "lines", old_in, new_in, inp[:50]))

print(f"示例减少的题: {shrink}")
print(f"示例增加的题: {grow}")
print(f"输入行数变化的示例: {line_diff}")
print(f"「输出」粘进输入的示例: {glued}")
for item in examples[:12]:
    print("  ", item)
sys.exit(0 if shrink == 0 and glued == 0 else 1)
