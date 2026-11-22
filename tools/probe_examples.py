#!/usr/bin/env python3
"""一次性检查脚本：示例解析回归对比 + example-block 覆盖探查。

用法（都在仓库根目录跑）：
  python tools/probe_examples.py snapshot <out.json>   # 把当前 statements 分片里每题的 examples 条数存快照
  python tools/probe_examples.py diff <before> <after> # 逐题对比，只允许增加；有减少则 exit 1
  python tools/probe_examples.py blocks [--in-set]     # 列出「题面有 example-block 但一条示例都没解析出来」的题并打印原始 HTML
  python tools/probe_examples.py stats                 # 汇总示例解析覆盖率（按 <pre> / example-block / 都没有 分组）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "public" / "data"
DATA = ROOT / "data"

sys.stdout.reconfigure(encoding="utf-8")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def snapshot(out_path: Path) -> None:
    """statements/*.json -> {题号: examples 条数}"""
    counts: dict[str, int] = {}
    for path in sorted((OUT / "statements").glob("*.json")):
        payload = read_json(path)
        for no, detail in payload.items():
            counts[no] = len(detail.get("examples") or [])
    out_path.write_text(
        json.dumps(counts, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8"
    )
    total = sum(counts.values())
    print(f"snapshot: {len(counts)} problems, {total} examples -> {out_path}")


def diff(before_path: Path, after_path: Path) -> int:
    before = read_json(before_path)
    after = read_json(after_path)
    decreased: list[str] = []
    increased: list[tuple[str, int, int]] = []
    for no, n in before.items():
        now = after.get(no)
        if now is None:
            decreased.append(f"{no}: {n} -> MISSING")
        elif now < n:
            decreased.append(f"{no}: {n} -> {now}")
        elif now > n:
            increased.append((no, n, now))
    new_problems = [no for no in after if no not in before]
    print(f"before: {len(before)} problems / {sum(before.values())} examples")
    print(f"after : {len(after)} problems / {sum(after.values())} examples")
    print(
        f"increased problems: {len(increased)}  "
        f"(+{sum(now - old for _, old, now in increased)} examples)"
    )

    def sort_key(item: tuple[str, int, int]) -> tuple[int, str]:
        no = item[0]
        return (int(no), no) if no.isdigit() else (10**9, no)

    for no, old, now in sorted(increased, key=sort_key):
        print(f"  + {no}: {old} -> {now}")
    print(f"new problems (no baseline): {len(new_problems)} {new_problems[:20]}")
    if decreased:
        print(f"!! DECREASED: {len(decreased)}")
        for line in decreased:
            print("  -", line)
        return 1
    print("OK: no problem lost examples")
    return 0


def _statement_html(raw: dict) -> str:
    return raw.get("translatedContent") or raw.get("content") or ""


def blocks(only_in_set: bool) -> None:
    """列出「有 example-block 但解析不出示例」的题（改完后应该只剩极少数），打印原始片段。"""
    from bs4 import BeautifulSoup

    from build_web_data import extract_examples  # 复用被测函数

    full = read_json(DATA / "statements_full.json")
    in_set: set[str] = set()
    if only_in_set and (OUT / "problems.json").exists():
        in_set = {p["no"] for p in read_json(OUT / "problems.json") if p.get("hasStatement")}

    hits: list[tuple[str, str]] = []
    for no, raw in full.items():
        if only_in_set and no not in in_set:
            continue
        html = _statement_html(raw)
        if "example-block" not in html:
            continue
        if extract_examples(html):
            continue
        hits.append((no, html))

    print(f"still unparsed example-block problems: {len(hits)} -> {[no for no, _ in hits]}")
    for no, html in hits[:3]:
        soup = BeautifulSoup(html, "lxml")
        block = soup.find(class_="example-block")
        print("=" * 70)
        print("problem", no, "| example-block count:", len(soup.find_all(class_="example-block")))
        print(str(block)[:1600])


def stats() -> None:
    """示例覆盖率：<pre> 解析 / example-block 兜底 / 两种格式都没有。"""
    from bs4 import BeautifulSoup

    from build_web_data import extract_block_examples, extract_pre_examples

    full = read_json(DATA / "statements_full.json")
    counts = {"pre": 0, "block": 0, "none": 0, "no_statement": 0}
    examples = {"pre": 0, "block": 0}
    for no, raw in full.items():
        html = _statement_html(raw)
        if not html:
            counts["no_statement"] += 1
            continue
        soup = BeautifulSoup(html, "lxml")
        pre = extract_pre_examples(soup)
        if pre:
            counts["pre"] += 1
            examples["pre"] += len(pre)
            continue
        block = extract_block_examples(soup)
        if block:
            counts["block"] += 1
            examples["block"] += len(block)
        else:
            counts["none"] += 1
    print("problems:", counts)
    print("examples:", examples)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "snapshot":
        snapshot(Path(sys.argv[2]))
    elif cmd == "diff":
        raise SystemExit(diff(Path(sys.argv[2]), Path(sys.argv[3])))
    elif cmd == "blocks":
        blocks("--in-set" in sys.argv)
    elif cmd == "stats":
        stats()
    else:
        print(__doc__)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
