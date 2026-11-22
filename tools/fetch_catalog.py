"""Fetch the full leetcode.cn problem catalogue (number, title, difficulty, tags)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lcgql import gql

QUERY = """
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total
    hasMore
    questions {
      frontendQuestionId
      titleCn
      titleSlug
      difficulty
      acRate
      paidOnly
      topicTags { nameTranslated slug }
    }
  }
}
"""

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "lc_catalog.json")


def main():
    rows, skip = [], 0
    total = None
    while True:
        r = gql(QUERY, {"categorySlug": "", "limit": 100, "skip": skip, "filters": {}})
        if "errors" in r:
            print("ERROR", r["errors"][:2])
            break
        d = r["data"]["problemsetQuestionList"]
        total = d["total"]
        for q in d["questions"]:
            rows.append(
                {
                    "no": q["frontendQuestionId"],
                    "title": q["titleCn"],
                    "slug": q["titleSlug"],
                    "level": q["difficulty"],
                    "ac_rate": q["acRate"],
                    "paid": q["paidOnly"],
                    "tags": [t["nameTranslated"] for t in (q.get("topicTags") or [])],
                }
            )
        skip += len(d["questions"])
        if not d["hasMore"] or not d["questions"]:
            break
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    print(f"total={total} fetched={len(rows)} -> {OUT}")


if __name__ == "__main__":
    main()
