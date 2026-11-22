"""Generate 教程/总目录.md — a full index mapping every problem to its tutorial location."""

import json
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")
TUT = os.path.join(ROOT, "教程")
DATA = os.path.join(ROOT, "data")

user = json.load(open(os.path.join(DATA, "用户题单.json"), encoding="utf-8"))
master = json.load(open(os.path.join(DATA, "master.json"), encoding="utf-8"))
catalog = json.load(open(os.path.join(DATA, "lc_catalog.json"), encoding="utf-8"))
cat_by_no = {c["no"]: c for c in catalog}
lvl = {r["no"]: r["level"] for r in master}
freq = {r["no"]: r["huawei_freq"] for r in master}

# 第一册（华为核心）覆盖
VOL1 = {
    "10-分册A-数组字符串滑窗哈希.md": ["3", "567", "1004", "209", "15", "1", "554", "560", "820", "415", "56"],
    "11-分册B-栈与单调栈.md": ["739", "20", "227", "394", "316", "735"],
    "12-分册C-链表树图.md": ["19", "206", "21", "146", "94", "102", "104", "105", "200", "207"],
    "13-分册D-动态规划贪心二分回溯.md": ["5", "322", "53", "300", "1143", "45", "55", "134", "46", "22", "679", "704"],
}

# 第二册（专题册）覆盖
VOL2 = {
    "20-专题1-数组与字符串.md": ["1", "3", "5", "11", "15", "28", "42", "238", "560"],
    "21-专题2-链表.md": ["19", "21", "23", "141", "142", "146", "148", "206", "143"],
    "22-专题3-哈希表.md": ["1", "49", "128", "242", "560"],
    "23-专题4-栈与单调栈.md": ["20", "32", "84", "155", "224", "227", "739"],
    "24-专题5-队列与堆.md": ["215", "225", "232", "295", "347", "973"],
    "25-专题6-树与二叉树（上）遍历与构造.md": ["94", "102", "103", "104", "105", "106", "144", "145", "226"],
    "26-专题6-树与二叉树（下）BST与高级.md": ["98", "124", "208", "211", "235", "236", "297"],
    "27-专题7-图.md": ["127", "133", "200", "207", "210", "323", "684", "994"],
    "28-专题8-回溯与DFS-BFS.md": ["17", "22", "37", "39", "40", "46", "47", "51", "78", "79", "90"],
    "29-专题9-动态规划（上）线性·路径·股票.md": ["53", "62", "63", "64", "70", "72", "121", "122", "123", "188"],
    "30-专题9-动态规划（下）背包·序列·区间.md": ["198", "213", "221", "279", "300", "309", "312", "322", "416", "1143"],
    "31-专题10-贪心算法.md": ["45", "55", "134", "135", "435", "502"],
    "32-专题11-二分查找.md": ["33", "34", "35", "81", "153", "154", "162", "410", "704"],
}

LEVEL_CN = {"EASY": "简单", "MEDIUM": "中等", "HARD": "困难"}
title_of = {}
for cat, rows in user["categories"].items():
    for r in rows:
        title_of[r["no"]] = r["title"]
for no, c in cat_by_no.items():
    title_of.setdefault(no, c["title"])
    lvl.setdefault(no, LEVEL_CN.get(c["level"], c["level"]))
lvl = {k: LEVEL_CN.get(v, v) for k, v in lvl.items()}


def exists(name):
    return os.path.exists(os.path.join(TUT, name))


lines = ["# 总目录：每道题在哪一册", "",
         "> 自动生成，用于速查。第一册 = 华为面试核心 39 题（P0+P1）；第二册 = 按算法专题覆盖 104 题。", ""]

lines += ["## 第一册 · 华为面试核心 39 题", "",
          "| 分册 | 题目 |", "|---|---|"]
for f, nos in VOL1.items():
    if not exists(f):
        continue
    items = "、".join(f"{n} {title_of.get(n, '')}" for n in nos)
    lines.append(f"| [{f[:-3]}]({f}) | {items} |")

lines += ["", "## 第二册 · 专题全覆盖（104 题）", ""]
for f, nos in VOL2.items():
    if not exists(f):
        continue
    lines += [f"### [{f[:-3]}]({f})", "",
              "| 题号 | 题目 | 难度 | 华为频次 |", "|---|---|---|---|"]
    for n in nos:
        lines.append(f"| {n} | {title_of.get(n, '')} | {lvl.get(n, '')} | {freq.get(n, 0) or '-'} |")
    lines.append("")

lines += ["## 覆盖统计", ""]
all1 = {n for nos in VOL1.values() for n in nos}
all2 = {n for nos in VOL2.values() for n in nos}
user_nums = set(user["all_numbers"])
lines += [
    f"- 第一册覆盖：**{len(all1)}** 题",
    f"- 第二册覆盖：**{len(all2)}** 题（去重后）",
    f"- 两册合计覆盖：**{len(all1 | all2)}** 题",
    f"- 用户指定题单：**{len(user_nums)}** 题，覆盖 **{len(user_nums & (all1 | all2))}/{len(user_nums)}**",
]
missing = sorted(user_nums - (all1 | all2), key=lambda x: int(x) if x.isdigit() else 9999)
if missing:
    lines.append(f"- ⚠️ 尚未覆盖：{missing}")

out = os.path.join(TUT, "总目录.md")
open(out, "w", encoding="utf-8").write("\n".join(lines))
print("wrote", out)
print(f"vol1={len(all1)} vol2={len(all2)} union={len(all1|all2)} user={len(user_nums)} covered={len(user_nums & (all1|all2))}")
print("missing:", missing)
