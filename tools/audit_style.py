"""样式令牌化审计：统计每个 CSS 文件里「写死值」的数量。

用法（在仓库根目录）：
    python tools/audit_style.py
    python tools/audit_style.py app/src/styles

判读标准（见 docs/设计规范.md 第 10 节）：
- hex / rgba 字面值：除了 tokens.css，其它文件应该接近 0
- 写死 font-size：应该为 0（全部走 --fs-* / --fs-code）
- 写死 border-radius：应该为 0（全部走 --r-*）
- 手写 box-shadow：应该为 0（全部走 --shadow-* / --mat-* / --ring-*）

tokens.css 与 motion.css 不计入：前者是令牌本身，后者有指针画布相关的常量。
"""
import re
import sys
from pathlib import Path

base = Path(sys.argv[1] if len(sys.argv) > 1 else "app/src/styles")
skip = {"tokens.css", "motion.css"}

pat_hex = re.compile(r"#[0-9a-fA-F]{3,8}\b")
pat_rgb = re.compile(r"\brgba?\(")
pat_fs = re.compile(r"font-size:\s*([0-9.]+)px")
pat_radius = re.compile(r"border-radius:\s*([0-9.]+)px")
pat_shadow = re.compile(r"box-shadow:\s*(?!none)[^;]+")

print(f"{'file':22}{'hex':>5}{'rgb':>5}{'fs-px':>7}{'radius-px':>11}{'shadow':>8}")
total = {"hex": 0, "rgb": 0, "fs": 0, "r": 0, "sh": 0}
for path in sorted(base.glob("*.css")):
    if path.name in skip:
        continue
    css = path.read_text(encoding="utf-8")
    hexes = pat_hex.findall(css)
    rgbs = pat_rgb.findall(css)
    fs = pat_fs.findall(css)
    radius = pat_radius.findall(css)
    shadows = [
        s
        for s in pat_shadow.findall(css)
        if "var(--shadow" not in s and "var(--mat" not in s and "var(" not in s
    ]
    total["hex"] += len(hexes)
    total["rgb"] += len(rgbs)
    total["fs"] += len(fs)
    total["r"] += len(radius)
    total["sh"] += len(shadows)
    print(f"{path.name:22}{len(hexes):5}{len(rgbs):5}{len(fs):7}{len(radius):11}{len(shadows):8}")

print("-" * 58)
print(f"{'TOTAL':22}{total['hex']:5}{total['rgb']:5}{total['fs']:7}{total['r']:11}{total['sh']:8}")

sizes: dict[str, int] = {}
for path in sorted(base.glob("*.css")):
    if path.name in skip:
        continue
    for value in pat_fs.findall(path.read_text(encoding="utf-8")):
        sizes[value] = sizes.get(value, 0) + 1
if sizes:
    print("\nfont-size values:", dict(sorted(sizes.items(), key=lambda kv: float(kv[0]))))
else:
    print("\nfont-size values: none (all tokenized)")
