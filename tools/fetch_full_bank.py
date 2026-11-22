"""抓全量题库的题面 / 官方示例 / 代码模板 / 参数元数据。

输出：data/statements_full.json
    { "<题号>": { "questionFrontendId", "translatedTitle", "difficulty",
                  "translatedContent", "exampleTestcases", "hints",
                  "codeSnippets", "metaData", "sampleTestCase" }, ... }

特点：
- 可断点续跑：已经抓到的题号直接跳过；
- 有限并发（默认 3）+ 间隔，遇到失败退避重试；
- 每 100 条落盘一次，中途被打断不丢进度。

用法：
    python tools/fetch_full_bank.py                # 抓缺的
    python tools/fetch_full_bank.py --limit 200    # 只抓 200 道（调试用）
    python tools/fetch_full_bank.py --workers 2 --delay 0.25
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from lcgql import gql  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "statements_full.json"
CATALOG = DATA / "lc_catalog.json"

QUERY = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    translatedTitle
    difficulty
    translatedContent
    exampleTestcases
    hints
    codeSnippets { lang langSlug code }
    metaData
    sampleTestCase
  }
}
"""

lock = threading.Lock()
stats = {"ok": 0, "fail": 0, "empty": 0}


def load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    tmp = CACHE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    tmp.replace(CACHE)


def fetch_one(slug: str, delay: float, retries: int = 3):
    for attempt in range(retries):
        res = gql(QUERY, {"titleSlug": slug})
        if res.get("http_error"):
            time.sleep(1.5 * (attempt + 1))
            continue
        q = (res.get("data") or {}).get("question")
        if q:
            time.sleep(delay)
            return q
        # data 为 null：可能是 slug 失效，也可能是被限流
        time.sleep(1.0 * (attempt + 1))
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--delay", type=float, default=0.2)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    cache = load_cache()

    todo = [
        (str(item["no"]).strip(), item["slug"])
        for item in catalog
        if item.get("slug") and str(item.get("no", "")).strip() not in cache
    ]
    if args.limit:
        todo = todo[: args.limit]

    print(f"total={len(catalog)} cached={len(cache)} todo={len(todo)}", flush=True)
    if not todo:
        return

    started = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(fetch_one, slug, args.delay): (no, slug) for no, slug in todo
        }
        for future in as_completed(futures):
            no, slug = futures[future]
            try:
                q = future.result()
            except Exception as exc:  # noqa: BLE001
                q = None
                print(f"  ! {no} {slug} {exc}", flush=True)
            with lock:
                if not q:
                    stats["fail"] += 1
                    cache[no] = {"__error": True, "slug": slug}
                elif not (q.get("translatedContent") or q.get("content")):
                    stats["empty"] += 1
                    cache[no] = {**q, "__empty": True}
                else:
                    stats["ok"] += 1
                    cache[no] = q
                done += 1
                if done % 100 == 0:
                    save_cache(cache)
                    elapsed = time.time() - started
                    rate = done / elapsed if elapsed else 0
                    print(
                        f"  {done}/{len(todo)} ok={stats['ok']} fail={stats['fail']} "
                        f"empty={stats['empty']} {rate:.1f}/s",
                        flush=True,
                    )

    save_cache(cache)
    print(
        f"done: ok={stats['ok']} fail={stats['fail']} empty={stats['empty']} "
        f"cache={len(cache)} in {round(time.time() - started)}s",
        flush=True,
    )


if __name__ == "__main__":
    main()
