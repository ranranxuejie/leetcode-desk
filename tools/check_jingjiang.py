#!/usr/bin/env python3
"""检查每道习题是否都有「精讲（零基础版）」，并且位置正确。

规则：
- 习题章节 = `## ` 标题里含「力扣 NNN」，或形如 `A1.` / `B2.` / `专题1-6.`
- 该章节里必须有且只有一节 `### 精讲`，且它必须是章节的第一个 `###` 小节
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TUT = ROOT / "教程"

SEC_RE = re.compile(r"^##\s+(.+?)\s*$", re.M)
SUB_RE = re.compile(r"^###\s+(.+?)\s*$", re.M)
PROB_TITLE_RE = re.compile(r"^(?:[A-D]\d+|专题\d+-\d+|\d+-\d+)\.|力扣\s*\d+")

PARTS = ["①", "②", "③", "④"]


def is_problem(heading: str) -> bool:
    return bool(PROB_TITLE_RE.search(heading))


def check(path: Path) -> tuple[int, int, list[str]]:
    text = path.read_text(encoding="utf-8")
    secs = list(SEC_RE.finditer(text))
    problems = 0
    ok = 0
    problems_list: list[str] = []

    for i, m in enumerate(secs):
        heading = m.group(1)
        if not is_problem(heading):
            continue
        problems += 1
        start = m.end()
        end = secs[i + 1].start() if i + 1 < len(secs) else len(text)
        body = text[start:end]

        subs = list(SUB_RE.finditer(body))
        jj = [s for s in subs if "精讲" in s.group(1)]
        issues = []
        if not jj:
            issues.append("缺精讲")
        else:
            if len(jj) > 1:
                issues.append(f"精讲重复 x{len(jj)}")
            if subs and subs[0] is not jj[0]:
                issues.append(f"位置不对（第一个小节是「{subs[0].group(1)}」）")
            seg_start = jj[0].end()
            nxt = [s for s in subs if s.start() > jj[0].start()]
            seg_end = nxt[0].start() if nxt else len(body)
            seg = body[seg_start:seg_end]
            need = PARTS[:2] if "回顾" in heading else PARTS
            missing = [p for p in need if p not in seg]
            if len(missing) == len(need):
                issues.append("四段全无")
            elif missing:
                issues.append("缺" + "".join(missing))
        if issues:
            problems_list.append(f"{heading}  <-  {'; '.join(issues)}")
        else:
            ok += 1

    return problems, ok, problems_list


def main() -> int:
    files = sorted(p for p in TUT.glob("*.md") if re.match(r"^\d\d", p.name))
    total_p = total_ok = 0
    bad_files = 0
    print(f"{'file':<44}{'习题':>4}{'有精讲':>7}  状态")
    print("-" * 78)
    for f in files:
        p, o, issues = check(f)
        total_p += p
        total_ok += o
        status = "OK" if not issues else f"!! {len(issues)} 处问题"
        if issues:
            bad_files += 1
        print(f"{f.name:<44}{p:>4}{o:>7}  {status}")
        for it in issues:
            print(f"      - {it}")
    print("-" * 78)
    print(f"合计习题 {total_p} 道，有合格精讲 {total_ok} 道，问题文件 {bad_files} 个")
    return 0 if total_ok == total_p else 1


if __name__ == "__main__":
    sys.exit(main())
