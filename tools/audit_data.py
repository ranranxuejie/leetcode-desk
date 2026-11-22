#!/usr/bin/env python
"""数据自检：重建题库之后跑一遍，确认「该在的都在、该大的没变小」。

用法：
    python tools/audit_data.py            # 打印报告，违反项 exit 1
    python tools/audit_data.py --json     # 输出 JSON

检查的是「构建产物」（app/public/data）与「生成物」（data/）的一致性，
防止某次重建悄悄把期望输出、参考解、示例冲掉（这个坑踩过一次）。
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "app" / "public" / "data"
DATA = ROOT / "data"

# 下限：低于这些数字说明重建把东西冲掉了
FLOORS = {
    "problemCount": 4500,
    "statementCount": 4100,
    "exampleCount": 8700,
    "edgeCaseTotal": 22700,
    "edgeExpectedCount": 2900,
    "edgeExpectedTotal": 12100,
    "refCodeCount": 3100,
    "teachingCount": 100,
    "top150Count": 150,
    "curatedCount": 365,
    "hot100Count": 100,
}

problems: list[str] = []


def fail(message: str) -> None:
    problems.append(message)


def load(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    meta_path = WEB / "meta.json"
    if not meta_path.exists():
        fail(f"缺 {meta_path.relative_to(ROOT)}：先跑 python tools/build_web_data.py")
        return report()

    meta = load(meta_path)
    for key, floor in FLOORS.items():
        value = meta.get(key)
        if value is None:
            fail(f"meta.json 缺字段 {key}")
        elif value < floor:
            fail(f"{key} = {value}，低于下限 {floor}（重建可能冲掉了数据）")

    # 分片：题面、边界用例、参考解
    shard_dir = WEB / "statements"
    shards = sorted(shard_dir.glob("*.json")) if shard_dir.exists() else []
    if len(shards) < 100:
        fail(f"题面分片只有 {len(shards)} 个（应为 101）")

    statements = 0
    with_edge = 0
    edge_cases = 0
    edge_expected = 0
    ref_codes = 0
    bad_calls: list[str] = []
    for shard in shards:
        for no, detail in load(shard).items():
            statements += 1
            code = detail.get("refCode")
            if isinstance(code, str) and code.strip():
                ref_codes += 1
            cases = detail.get("edgeCases") or []
            if cases:
                with_edge += 1
            for case in cases:
                edge_cases += 1
                call = str(case.get("call") or "")
                if case.get("expected"):
                    edge_expected += 1
                try:
                    ast.parse(call, mode="eval")
                except SyntaxError:
                    bad_calls.append(f"{no}: {call[:60]}")

    if bad_calls:
        fail(f"{len(bad_calls)} 条边界用例的 call 不是合法 Python 表达式，例如：{bad_calls[0]}")

    # 生成物
    refs_dir = DATA / "ref_solutions"
    ref_files = [p for p in refs_dir.glob("*.json") if not p.stem.startswith("_")] if refs_dir.exists() else []
    if len(ref_files) < 3000:
        fail(f"参考解文件只有 {len(ref_files)} 份（下限 3000）")

    edge_file = DATA / "edge_cases.json"
    edge_problems = len(load(edge_file)) if edge_file.exists() else 0
    if edge_problems < 3800:
        fail(f"edge_cases.json 只覆盖 {edge_problems} 道题（下限 3800）")

    report(
        {
            "statements": statements,
            "withEdge": with_edge,
            "edgeCases": edge_cases,
            "edgeExpected": edge_expected,
            "refCodes": ref_codes,
            "refFiles": len(ref_files),
            "edgeProblems": edge_problems,
            "shards": len(shards),
        }
    )
    return 0 if not problems else 1


def report(extra: dict | None = None) -> int:
    if "--json" in sys.argv:
        print(json.dumps({"problems": problems, "stats": extra or {}}, ensure_ascii=False, indent=1))
    else:
        if extra:
            print("数据规模：")
            for key, value in extra.items():
                print(f"  {key:14s} {value}")
        print()
        if problems:
            print(f"X {len(problems)} 项不符合预期：")
            for item in problems:
                print(f"  - {item}")
        else:
            print("OK 数据自检全部通过")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
