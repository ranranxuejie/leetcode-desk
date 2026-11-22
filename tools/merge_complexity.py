#!/usr/bin/env python3
"""把 data/_cx_out_*.json 合并成 data/complexity.json，并校验覆盖率。

输出结构：{"1": {"time": "O(n)", "space": "O(n)", "loops": "...", "why": "..."}, ...}
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

TIME_RE = re.compile(r"^O\(")


def main() -> None:
    problems = json.loads((ROOT / "app" / "public" / "data" / "problems.json").read_text(encoding="utf-8"))
    known = {p["no"] for p in problems}

    merged: dict[str, dict] = {}
    for path in sorted(DATA.glob("_cx_out_*.json")):
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"!! {path.name} 解析失败: {exc}")
            continue
        if not isinstance(rows, list):
            print(f"!! {path.name} 不是数组")
            continue
        # 有的批次忘了写 no：按同序号 batch 文件补上
        if rows and not str(rows[0].get("no", "")).strip():
            batch_path = DATA / path.name.replace("_cx_out_", "_cx_batch_")
            if batch_path.exists():
                src = json.loads(batch_path.read_text(encoding="utf-8"))
                if len(src) == len(rows):
                    for row, origin in zip(rows, src):
                        row["no"] = origin["no"]
                    print(f"{path.name}: 缺少 no，已按 {batch_path.name} 的顺序补回")
                else:
                    print(f"!! {path.name} 缺 no 且条数与 batch 不符")
                    continue
            else:
                print(f"!! {path.name} 缺 no 且找不到 batch 文件")
                continue
        for row in rows:
            no = str(row.get("no", "")).strip()
            if not no:
                continue
            time = str(row.get("time", "")).strip()
            space = str(row.get("space", "")).strip()
            loops = str(row.get("loops", "")).strip()
            why = str(row.get("why", "")).strip()
            if not time or not loops:
                continue
            merged[no] = {"time": time, "space": space, "loops": loops, "why": why}
        print(f"{path.name}: {len(rows)} 条")

    missing = sorted(known - set(merged))
    extra = sorted(set(merged) - known)
    bad_time = [
        k for k, v in merged.items() if "O(" not in v["time"] and "每次操作" not in v["time"]
    ]

    out = DATA / "complexity.json"
    out.write_text(json.dumps(merged, ensure_ascii=False, indent=1, sort_keys=False), encoding="utf-8")

    print(f"\n合并 {len(merged)} 道，缺 {len(missing)} 道，多余 {len(extra)} 条")
    if missing:
        print("缺:", missing)
    if extra:
        print("多余:", extra)
    if bad_time:
        print("time 格式可疑:", [(k, merged[k]["time"]) for k in bad_time[:10]])
    print("写入", out)


if __name__ == "__main__":
    main()
