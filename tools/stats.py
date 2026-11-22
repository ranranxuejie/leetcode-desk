import json
from collections import Counter

rows = json.load(open("data/master.json", encoding="utf-8"))
ct = json.load(open("data/codetop_huawei_dedup.json", encoding="utf-8-sig"))
hl = json.load(open("data/lc_list_V3JZGPzX.json", encoding="utf-8-sig"))
hot = json.load(open("data/lc_hot100.json", encoding="utf-8-sig"))
mj = json.load(open("data/mianjing_extract.json", encoding="utf-8"))
lvl = {r["no"]: r["level"] for r in rows}

print("TOP25:")
for i, q in enumerate(sorted(ct, key=lambda x: -x["freq"])[:25], 1):
    print(f"{i:2}. #{q['no']:<5} {lvl.get(q['no'], ''):<2} freq={q['freq']:>2} {q['title']}")

print()
print("华为题单56 难度:", dict(Counter(x["level"] for x in hl)))
print("热题100 分组:", dict(Counter(x["group"] for x in hot)))
print("面经题数:", len(mj["questions"]), "高/中/低:", dict(Counter(x["confidence"] for x in mj["questions"])))
pool = [r for r in rows if r["tier"] in ("P0", "P1", "P2", "P3")]
print("华为池:", len(pool), "难度:", dict(Counter(r["level"] for r in pool)))
both = [r for r in rows if r["huawei_freq"] > 0 and r["mj_sources"] > 0]
print("统计线∩面经线:", len(both), [r["no"] for r in both])
print("P1:", [r["no"] for r in rows if r["tier"] == "P1"])
print("est P0+P1 h:", round(sum(r["est_min"] for r in rows if r["tier"] in ("P0", "P1")) / 60, 1))
print("est P0-P2 h:", round(sum(r["est_min"] for r in rows if r["tier"] in ("P0", "P1", "P2")) / 60, 1))
print("est all h:", round(sum(r["est_min"] for r in rows) / 60, 1))
print("基础 list:", [(r["no"], r["title"]) for r in rows if r["tier"] == "基础"])
