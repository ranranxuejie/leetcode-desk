"""Merge all collected sources into one master table + study-plan tiering + xlsx export."""
import json
import os
import re
from collections import Counter

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data")


def load(name, default=None):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8-sig") as f:
        return json.load(f)


def norm_no(x):
    return str(x).strip()


def norm_title(t):
    return re.sub(r"\s+", "", str(t)).lower()


catalog = load("lc_catalog.json", [])
by_no = {norm_no(c["no"]): c for c in catalog}
by_title = {norm_title(c["title"]): c for c in catalog}

codetop = load("codetop_huawei_dedup.json", [])
huawei_list = load("lc_list_V3JZGPzX.json", [])
hot100 = load("lc_hot100.json", [])
top150 = load("lc_top150.json", [])
mianjing = load("mianjing_extract.json", {})

LEVEL_CN = {"EASY": "简单", "MEDIUM": "中等", "HARD": "困难"}
CODETOP_LEVEL = {1: "简单", 2: "中等", 3: "困难"}

# 主分类优先级：越靠前越优先作为「主算法类型」；用标签精确匹配，避免「字典树」被算成「树」
CATEGORY_RULES = [
    ("滑动窗口", {"滑动窗口"}),
    ("单调栈/单调队列", {"单调栈", "单调队列"}),
    ("链表", {"链表", "双向链表"}),
    ("二叉树/树", {"树", "二叉树", "二叉搜索树", "二叉索引树"}),
    ("动态规划", {"动态规划", "记忆化"}),
    ("图/DFS/BFS", {"图", "深度优先搜索", "广度优先搜索", "并查集", "拓扑排序", "最短路径"}),
    ("回溯", {"回溯"}),
    ("二分查找", {"二分查找"}),
    ("堆/优先队列", {"堆（优先队列）"}),
    ("栈/队列", {"栈", "队列"}),
    ("哈希表", {"哈希表", "哈希函数"}),
    ("双指针", {"双指针"}),
    ("前缀和", {"前缀和"}),
    ("字符串", {"字符串", "字符串匹配", "字典树"}),
    ("数组/矩阵", {"数组", "矩阵", "模拟"}),
    ("排序", {"排序"}),
    ("贪心", {"贪心"}),
    ("位运算", {"位运算"}),
    ("数学", {"数学", "数论", "几何", "博弈", "概率与统计"}),
    ("设计", {"设计", "数据流", "迭代器"}),
]


def category(tags):
    s = set(tags)
    for name, keys in CATEGORY_RULES:
        if s & keys:
            return name
    return "其他"


records = {}


def rec(no, title=None, level_hint=None):
    key = norm_no(no)
    if key in records:
        return records[key]
    c = by_no.get(key)
    if c is None and title:
        c = by_title.get(norm_title(title))
    lv = LEVEL_CN.get((c or {}).get("level", ""), "")
    if not lv and level_hint:
        lv = CODETOP_LEVEL.get(level_hint, "")
    ac = (c or {}).get("ac_rate") or 0
    ac = round(ac * 100, 1) if ac <= 1 else round(ac, 1)
    r = {
        "no": key,
        "title": (c or {}).get("title") or title or "",
        "slug": (c or {}).get("slug") or "",
        "level": lv,
        "ac_rate": ac,
        "tags": (c or {}).get("tags") or [],
        "paid": (c or {}).get("paid", False),
        "huawei_freq": 0,
        "in_huawei_list": False,
        "hot100_group": None,
        "in_top150": False,
        "mj_sources": 0,
        "mj_confidence": "",
        "mj_scene": "",
        "mj_note": "",
        "sources": [],
    }
    records[key] = r
    return r


for q in codetop:
    r = rec(q["no"], q.get("title"), q.get("level"))
    r["huawei_freq"] = q["freq"]
    r["sources"].append("CodeTop")

for q in huawei_list:
    r = rec(q["no"], q.get("title"))
    r["in_huawei_list"] = True
    r["sources"].append("力扣题单")

for q in hot100:
    r = rec(q["no"], q.get("title"))
    r["hot100_group"] = q.get("group")
    r["sources"].append("热题100")

for q in top150:
    r = rec(q["no"], q.get("title"))
    r["in_top150"] = True
    r["sources"].append("面试经典150")

for item in mianjing.get("questions", []):
    r = rec(item["no"], item.get("title"))
    r["mj_sources"] = item.get("sources", 1)
    r["mj_confidence"] = item.get("confidence", "")
    r["mj_scene"] = item.get("scene", "")
    r["mj_note"] = item.get("note", "")
    r["sources"].append("面经")

rows = list(records.values())

for r in rows:
    f, m, conf = r["huawei_freq"], r["mj_sources"], r["mj_confidence"]
    if m >= 2:
        r["tier"] = "P0"
    elif conf == "高" or f >= 5 or (m >= 1 and f >= 3):
        r["tier"] = "P1"
    elif f >= 3 or m >= 1 or r["in_huawei_list"]:
        r["tier"] = "P2"
    elif f >= 1:
        r["tier"] = "P3"
    elif r["hot100_group"]:
        r["tier"] = "基础"
    elif r["in_top150"]:
        r["tier"] = "进阶"
    else:
        r["tier"] = "进阶"
    r["category"] = category(r["tags"])
    r["sources"] = sorted(set(r["sources"]))
    # 建议用时（分钟），按难度粗估
    r["est_min"] = {"简单": 20, "中等": 35, "困难": 55}.get(r["level"], 30)

TIER_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3, "基础": 4, "进阶": 5}
rows.sort(key=lambda r: (TIER_ORDER[r["tier"]], -r["huawei_freq"], -r["mj_sources"], int(re.sub(r"\D", "", r["no"]) or 9999)))

with open(os.path.join(DATA, "master.json"), "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)

print("records:", len(rows))
print("tier:", dict(Counter(r["tier"] for r in rows)))
print("huawei_freq>0:", sum(1 for r in rows if r["huawei_freq"] > 0))
print("in huawei list:", sum(1 for r in rows if r["in_huawei_list"]))
print("mianjing:", sum(1 for r in rows if r["mj_sources"]))
print("difficulty:", dict(Counter(r["level"] for r in rows)))
est = sum(r["est_min"] for r in rows if r["tier"] in ("P0", "P1"))
print("P0+P1 est minutes:", est, "≈", round(est / 60, 1), "h")

for tier in ("P0", "P1", "P2"):
    sel = [r for r in rows if r["tier"] == tier]
    print(f"\n--- {tier} ({len(sel)}) ---")
    for r in sel:
        print(f"  {r['no']:>5} {r['level']} freq={r['huawei_freq']:>2} mj={r['mj_sources']} {r['category']:<10} {r['title']}")
