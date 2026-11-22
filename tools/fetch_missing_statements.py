#!/usr/bin/env python3
"""补齐缺失的题面：把 master.json 里还没有 statement 的题，逐个从力扣 GraphQL 抓回来。

写入 data/statements_cache.json（增量、可重跑），然后需要再跑 tools/build_web_data.py。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from lcgql import gql  # noqa: E402

DATA = ROOT / "data"
CACHE = DATA / "statements_cache.json"

Q = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    questionId
    title
    translatedTitle
    content
    translatedContent
    difficulty
    hints
    exampleTestcases
    isPaidOnly
  }
}
"""


def load(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def main() -> int:
    master = load(DATA / "master.json", [])
    cache = load(CACHE, {})

    targets = []
    for item in master:
        no = str(item.get("no", "")).strip()
        slug = item.get("slug", "")
        if not no or not slug:
            continue
        if cache.get(no, {}).get("translatedContent") or cache.get(no, {}).get("content"):
            continue
        targets.append((no, slug))

    print(f"待补 {len(targets)} 道，已有缓存 {len(cache)} 道")

    ok = paid = failed = 0
    failures = []
    for i, (no, slug) in enumerate(targets, 1):
        try:
            res = gql(Q, {"titleSlug": slug})
        except Exception as exc:  # 网络异常，记下来继续
            failures.append((no, slug, f"exception: {exc}"))
            failed += 1
            continue

        q = (res.get("data") or {}).get("question")
        if not q:
            failures.append((no, slug, json.dumps(res, ensure_ascii=False)[:160]))
            failed += 1
            time.sleep(0.3)
            continue

        if not (q.get("translatedContent") or q.get("content")):
            paid += 1
            failures.append((no, slug, "paid or empty content"))
        else:
            ok += 1
        cache[no] = q

        if i % 20 == 0:
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  {i}/{len(targets)}  ok={ok} paid/empty={paid} failed={failed}")
        time.sleep(0.12)

    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"完成：成功 {ok}，会员/无正文 {paid}，失败 {failed}，缓存共 {len(cache)} 道")
    for row in failures[:40]:
        print("   -", row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
