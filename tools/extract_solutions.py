#!/usr/bin/env python3
"""为每道题抽出「解法代码 + 已有的复杂度描述」，供后续生成复杂度标注。

输出 data/_complexity_input.json：
  [{ no, title, level, category, docId, sectionTitle, code, existing }]
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TUT = DATA.parent / "教程"

SEC_RE = re.compile(r"^##\s+(.+?)\s*$", re.M)
PROBLEM_RE = re.compile(
    r"力扣\s*(剑指\s*Offer\s*[\d\-]+\s*(?:II)?|面试题\s*[\d.]+|补充题\s*\d+|\d+)"
)
BLOCK_RE = re.compile(r"```(?:python)?\n(.*?)```", re.S)
COMPLEX_RE = re.compile(r"^###\s*复杂度.*?$", re.M)


def norm_no(raw: str) -> str:
    return re.sub(r"\s+", " ", raw).strip()


def pick_rank(doc_id: str) -> int:
    """越小越优先：先用第一册/第二册的精讲，再用第三册。"""
    n = int(doc_id[:2]) if doc_id[:2].isdigit() else 99
    if 10 <= n <= 13:
        return 0
    if 20 <= n <= 32:
        return 1
    return 2


def main() -> None:
    problems = json.loads((DATA / "master.json").read_text(encoding="utf-8"))
    app_problems = json.loads(
        (ROOT / "app" / "public" / "data" / "problems.json").read_text(encoding="utf-8")
    )
    meta = {p["no"]: p for p in app_problems}

    best: dict[str, dict] = {}
    for path in sorted(TUT.glob("*.md")):
        doc_id = path.stem
        if not doc_id[:2].isdigit():
            continue
        text = path.read_text(encoding="utf-8")
        secs = list(SEC_RE.finditer(text))
        for i, m in enumerate(secs):
            body = text[m.end(): secs[i + 1].start() if i + 1 < len(secs) else len(text)]
            hit = PROBLEM_RE.search(body[:800])
            if not hit:
                continue
            no = norm_no(hit.group(1))
            code = ""
            for block in BLOCK_RE.findall(body):
                if "class Solution" in block:
                    code = block.strip()
                    break
            if not code:
                continue
            cm = COMPLEX_RE.search(body)
            existing = ""
            if cm:
                seg = body[cm.end():]
                nxt = re.search(r"^###\s", seg, re.M)
                existing = (seg[: nxt.start()] if nxt else seg).strip()[:400]
            rank = pick_rank(doc_id)
            prev = best.get(no)
            if prev is None or rank < prev["rank"]:
                best[no] = {
                    "no": no,
                    "docId": doc_id,
                    "sectionTitle": m.group(1),
                    "code": code,
                    "existing": existing,
                    "rank": rank,
                }

    out = []
    missing = []
    for no in meta:
        item = best.get(no)
        if not item:
            missing.append(no)
            continue
        out.append(
            {
                "no": no,
                "title": meta[no]["title"],
                "level": meta[no]["level"],
                "category": meta[no]["category"],
                "docId": item["docId"],
                "sectionTitle": item["sectionTitle"],
                "code": item["code"],
                "existing": item["existing"],
            }
        )

    (DATA / "_complexity_input.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"抽出 {len(out)} 道题，缺代码 {len(missing)} 道: {missing[:20]}")
    sizes = [len(x["code"]) for x in out]
    print(f"代码总字符 {sum(sizes):,}，平均 {sum(sizes)//max(len(sizes),1)}")


if __name__ == "__main__":
    main()
