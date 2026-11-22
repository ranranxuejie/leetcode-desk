"""Fetch statements for the user-provided 104-problem list and emit 题面-第二册.md by category."""
import html
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lcgql import gql

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
user = json.load(open(os.path.join(DATA, "用户题单.json"), encoding="utf-8"))

Q = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    translatedTitle
    translatedContent
    difficulty
    hints
    exampleTestcases
  }
}
"""


def to_text(h):
    h = re.sub(r"<sup>(.*?)</sup>", r"^\1", h)
    h = re.sub(r"<sub>(.*?)</sub>", r"_\1", h)
    h = re.sub(r"<pre>(.*?)</pre>", lambda m: "\n```\n" + re.sub(r"<[^>]+>", "", m.group(1)) + "\n```\n", h, flags=re.S)
    h = re.sub(r"<li>(.*?)</li>", r"- \1\n", h, flags=re.S)
    h = re.sub(r"<br\s*/?>", "\n", h)
    h = re.sub(r"</p>", "\n\n", h)
    h = re.sub(r"</?strong>", "**", h)
    h = re.sub(r"</?code>", "`", h)
    h = re.sub(r"<[^>]+>", "", h)
    h = html.unescape(h)
    return re.sub(r"\n{3,}", "\n\n", h).strip()


cache_path = os.path.join(DATA, "statements_cache.json")
cache = json.load(open(cache_path, encoding="utf-8")) if os.path.exists(cache_path) else {}

lines = ["# 第二册题面（力扣中文原题，供写作核对）", ""]
missing = []
for cat, rows in user["categories"].items():
    lines.append(f"\n---\n\n# {cat}\n")
    for r in rows:
        no, slug = r["no"], r["slug"]
        if no in cache:
            q = cache[no]
        else:
            res = gql(Q, {"titleSlug": slug})
            q = (res.get("data") or {}).get("question")
            if not q:
                missing.append((no, slug))
                continue
            cache[no] = q
            time.sleep(0.12)
        lines.append(f"## [{no}] {q.get('translatedTitle') or q.get('title')}（{q.get('difficulty')}）\n")
        lines.append(f"slug: `{slug}`\n")
        lines.append(to_text(q.get("translatedContent") or ""))
        if q.get("exampleTestcases"):
            lines.append(f"\n**官方示例输入**：\n```\n{q['exampleTestcases']}\n```")
        lines.append("\n")

json.dump(cache, open(cache_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
out = os.path.join(DATA, "题面-第二册.md")
open(out, "w", encoding="utf-8").write("\n".join(lines))
print("cached:", len(cache), "missing:", missing)
print("wrote", out, os.path.getsize(out), "bytes")
