"""Fetch Chinese problem statements for the tutorial volume 1 problem set."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lcgql import gql

DATA = os.path.join(os.path.dirname(__file__), "..", "data")

# 第一册题集：P0 + P1 全部 + 4 道二叉树模板题
NUMBERS = [
    # P0
    "3", "739", "15", "19", "206", "567",
    # P1
    "20", "554", "200", "227", "46", "56", "5", "316", "322", "394", "415", "1",
    "53", "1004", "22", "146", "45", "55", "134", "300", "679", "735", "820", "1143",
    "207", "560", "21", "209", "704",
    # 二叉树模板必刷
    "94", "102", "104", "105",
]

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

master = json.load(open(os.path.join(DATA, "master.json"), encoding="utf-8"))
slug_by_no = {r["no"]: r["slug"] for r in master}

out = {}
for no in NUMBERS:
    slug = slug_by_no.get(no)
    if not slug:
        print("MISSING slug for", no)
        continue
    r = gql(Q, {"titleSlug": slug})
    q = (r.get("data") or {}).get("question")
    if not q:
        print("FAIL", no, slug, str(r)[:200])
        continue
    out[no] = {
        "no": no,
        "slug": slug,
        "title": q.get("translatedTitle") or q.get("title"),
        "difficulty": q.get("difficulty"),
        "content_html": q.get("translatedContent") or "",
        "hints": q.get("hints") or [],
        "examples": q.get("exampleTestcases") or "",
    }
    print("ok", no, out[no]["title"], len(out[no]["content_html"]))
    time.sleep(0.15)

with open(os.path.join(DATA, "tutorial_problems.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("saved", len(out))
