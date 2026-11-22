"""Export the merged study list to xlsx + print stats used by the report."""
import json
import os
from collections import Counter, defaultdict

import xlsxwriter

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "..", "华为实习刷题清单.xlsx")

rows = json.load(open(os.path.join(DATA, "master.json"), encoding="utf-8"))
mj = json.load(open(os.path.join(DATA, "mianjing_extract.json"), encoding="utf-8"))
codetop = json.load(open(os.path.join(DATA, "codetop_huawei_dedup.json"), encoding="utf-8-sig"))
hot100 = json.load(open(os.path.join(DATA, "lc_hot100.json"), encoding="utf-8-sig"))

TIER_DESC = {
    "P0": "多源印证（≥2 篇独立面经）",
    "P1": "华为高频（CodeTop 频次≥5 或面经+统计双线）",
    "P2": "华为考过（频次 3-4 / 面经单源 / 华为公开题单）",
    "P3": "华为低频（频次 1-2）",
    "基础": "热题100 补充（华为未统计到，但基本功必备）",
    "进阶": "面试经典150 进阶（困难/低频）",
}

wb = xlsxwriter.Workbook(OUT, {"nan_inf_to_errors": True})
wb.set_properties({"title": "华为实习 LeetCode 刷题清单", "subject": "基于多源交叉验证的华为实习面试算法题单"})

F = {
    "title": wb.add_format({"bold": True, "font_size": 16, "font_color": "#1f3864"}),
    "h2": wb.add_format({"bold": True, "font_size": 12, "font_color": "#1f3864", "bottom": 1}),
    "hdr": wb.add_format({"bold": True, "font_color": "white", "bg_color": "#2f5597", "border": 1, "align": "center", "valign": "vcenter", "text_wrap": True}),
    "cell": wb.add_format({"border": 1, "valign": "top"}),
    "cellc": wb.add_format({"border": 1, "align": "center", "valign": "top"}),
    "num": wb.add_format({"border": 1, "align": "center", "valign": "top", "num_format": "0"}),
    "wrap": wb.add_format({"border": 1, "valign": "top", "text_wrap": True}),
    "bold": wb.add_format({"bold": True}),
    "note": wb.add_format({"text_wrap": True, "valign": "top"}),
}
LEVEL_FMT = {
    "简单": wb.add_format({"border": 1, "align": "center", "bg_color": "#e2efda"}),
    "中等": wb.add_format({"border": 1, "align": "center", "bg_color": "#fff2cc"}),
    "困难": wb.add_format({"border": 1, "align": "center", "bg_color": "#fce4e4"}),
}
TIER_FMT = {
    "P0": wb.add_format({"border": 1, "align": "center", "bold": True, "bg_color": "#c00000", "font_color": "white"}),
    "P1": wb.add_format({"border": 1, "align": "center", "bold": True, "bg_color": "#ed7d31", "font_color": "white"}),
    "P2": wb.add_format({"border": 1, "align": "center", "bg_color": "#ffd966"}),
    "P3": wb.add_format({"border": 1, "align": "center", "bg_color": "#f2f2f2"}),
    "基础": wb.add_format({"border": 1, "align": "center", "bg_color": "#deebf7"}),
    "进阶": wb.add_format({"border": 1, "align": "center", "bg_color": "#e4dfec"}),
}

COLS = [
    ("优先级", 8), ("题号", 8), ("题目", 26), ("难度", 7), ("主算法类型", 15),
    ("华为面经\n来源数", 10), ("面经\n置信度", 9), ("出现场景", 14), ("CodeTop\n华为频次", 10),
    ("华为公开\n题单", 9), ("热题100\n分组", 13), ("会员题", 7), ("通过率%", 8),
    ("建议用时\n(分)", 9), ("刷题状态", 10), ("备注", 52), ("力扣链接", 42),
]

# ---------------- sheet 1: 说明 ----------------
ws = wb.add_worksheet("00-说明")
ws.set_column("A:A", 22)
ws.set_column("B:B", 105)
ws.set_row(0, 28)
ws.write(0, 0, "华为实习 LeetCode 刷题清单", F["title"])
lines = [
    ("生成时间", "2026-11-13"),
    ("用途", "面向「华为实习」面试的算法题准备清单。所有题目编号、题名、难度均来自力扣中国站官方题库接口，未编造。"),
    ("优先级 P0", "多源印证：≥2 篇独立面经提到，或面经+统计双线命中。共 6 题，必须滚瓜烂熟。"),
    ("优先级 P1", "华为高频：CodeTop 华为频次≥5，或面经单源且频次≥3。共 29 题。"),
    ("优先级 P2", "华为考过：频次 3-4、面经单源、或出现在力扣「华为」公开题单里。共 84 题。"),
    ("优先级 P3", "华为低频：CodeTop 频次 1-2。共 153 题，时间不够可跳过。"),
    ("优先级 基础", "热题100 里华为没统计到、但属于基本功的题。共 27 题。"),
    ("优先级 进阶", "面试经典150 的困难/进阶题。共 53 题，冲算法岗再看。"),
    ("重要提醒 1", "华为实习有「机考」（ACM 模式，3 题 100/200/300 分，150 过线，时习知平台），考的不是 LeetCode 原题；本表是「面试手撕」清单，两条线要分开准备。"),
    ("重要提醒 2", "力扣官方「华为企业题库」共 201 题，但需要登录+Plus 会员才能看，本表无法逐题核对，只能做统计口径替代。"),
    ("重要提醒 3", "华为面试手撕约 1/4~1/3 是「非 LeetCode 原题」的工程题（环形缓冲区、线程池、手写 HashMap 等），见 sheet「05-工程手撕」。"),
    ("数据来源", "① CodeTop codetop.cc 华为榜（298 条记录 / 226 道唯一题，含公司维度频次）② 力扣公开题单 V3JZGPzX（56 题）③ 力扣官方热题100（100 题）④ 力扣官方面试经典150（150 题）⑤ 15 篇一手面经 + 面灵面经 142 篇华为页聚合 ⑥ 力扣题库接口（4498 题，用于校验题号/难度）"),
    ("可信度分级", "P0/P1 高；P2 中；P3 低（仅统计频次）。面经题号若来源只给题名，已标注「题号由题名反查」，按题名记更稳。"),
]
r = 2
for k, v in lines:
    ws.write(r, 0, k, F["bold"])
    ws.write(r, 1, v, F["note"])
    ws.set_row(r, 30 if len(v) < 60 else 46)
    r += 1

# ---------------- sheet 2: 优先级总表 ----------------
ws = wb.add_worksheet("01-优先级总表")
ws.freeze_panes(1, 2)
ws.autofilter(0, 0, len(rows), len(COLS) - 1)
for i, (name, width) in enumerate(COLS):
    ws.set_column(i, i, width)
    ws.write(0, i, name, F["hdr"])
ws.set_row(0, 34)

for idx, q in enumerate(rows, start=1):
    link = f"https://leetcode.cn/problems/{q['slug']}/" if q["slug"] else ""
    vals = [
        q["tier"], q["no"], q["title"], q["level"], q["category"],
        q["mj_sources"] or "", q["mj_confidence"], q["mj_scene"],
        q["huawei_freq"] or "", "是" if q["in_huawei_list"] else "",
        q["hot100_group"] or "", "是" if q["paid"] else "",
        q["ac_rate"], q["est_min"], "未刷",
        q["mj_note"] or (f"热题100分组：{q['hot100_group']}" if q["hot100_group"] else ""),
        link,
    ]
    for c, v in enumerate(vals):
        if c == 0:
            ws.write(idx, c, v, TIER_FMT.get(v, F["cellc"]))
        elif c == 3:
            ws.write(idx, c, v, LEVEL_FMT.get(v, F["cellc"]))
        elif c in (1, 5, 8, 13):
            ws.write(idx, c, v, F["num"] if isinstance(v, (int, float)) else F["cellc"])
        elif c in (7, 15):
            ws.write(idx, c, v, F["wrap"])
        elif c == 16:
            if v:
                ws.write_url(idx, c, v, F["cell"], string=v)
            else:
                ws.write(idx, c, "", F["cell"])
        elif c in (2, 4):
            ws.write(idx, c, v, F["cell"])
        else:
            ws.write(idx, c, v, F["cellc"])

# 状态下拉
last = len(rows)
ws.data_validation(1, 14, last, 14, {"validate": "list", "source": ["未刷", "已刷", "待复习", "放弃"]})
ws.conditional_format(1, 14, last, 14, {"type": "cell", "criteria": "==", "value": '"已刷"', "format": wb.add_format({"bg_color": "#c6efce"})})

# ---------------- sheet 3: 华为高频榜 ----------------
ws = wb.add_worksheet("02-华为高频榜")
ws.freeze_panes(1, 0)
ws.autofilter(0, 0, len(codetop), 6)
hdr = ["排名", "题号", "题目", "难度", "CodeTop 华为频次", "主算法类型", "力扣链接"]
widths = [6, 9, 30, 8, 16, 16, 44]
for i, (h, w) in enumerate(zip(hdr, widths)):
    ws.set_column(i, i, w)
    ws.write(0, i, h, F["hdr"])
cat_by_no = {q["no"]: q["category"] for q in rows}
lvl_by_no = {q["no"]: q["level"] for q in rows}
for i, q in enumerate(codetop, start=1):
    ws.write(i, 0, i, F["num"])
    ws.write(i, 1, q["no"], F["cellc"])
    ws.write(i, 2, q["title"], F["cell"])
    ws.write(i, 3, lvl_by_no.get(q["no"], ""), LEVEL_FMT.get(lvl_by_no.get(q["no"]), F["cellc"]))
    ws.write(i, 4, q["freq"], F["num"])
    ws.write(i, 5, cat_by_no.get(q["no"], ""), F["cellc"])
    if q.get("slug"):
        ws.write_url(i, 6, f"https://leetcode.cn/problems/{q['slug']}/", F["cell"], string=f"leetcode.cn/problems/{q['slug']}")

# ---------------- sheet 4: 面经真题 ----------------
ws = wb.add_worksheet("03-面试手撕真题")
ws.freeze_panes(1, 0)
ws.set_column("A:A", 8)
ws.set_column("B:B", 30)
ws.set_column("C:C", 8)
ws.set_column("D:D", 10)
ws.set_column("E:E", 18)
ws.set_column("F:F", 60)
ws.set_column("G:G", 10)
ws.write(0, 0, "题号", F["hdr"])
ws.write(0, 1, "题目", F["hdr"])
ws.write(0, 2, "难度", F["hdr"])
ws.write(0, 3, "来源数", F["hdr"])
ws.write(0, 4, "出现场景", F["hdr"])
ws.write(0, 5, "证据说明", F["hdr"])
ws.write(0, 6, "置信度", F["hdr"])
conf_order = {"高": 0, "中": 1, "低": 2}
qs = sorted(mj["questions"], key=lambda x: (conf_order.get(x["confidence"], 9), -x["sources"], x["no"]))
for i, q in enumerate(qs, start=1):
    ws.write(i, 0, q["no"], F["cellc"])
    ws.write(i, 1, q["title"], F["cell"])
    ws.write(i, 2, lvl_by_no.get(q["no"], ""), LEVEL_FMT.get(lvl_by_no.get(q["no"]), F["cellc"]))
    ws.write(i, 3, q["sources"], F["num"])
    ws.write(i, 4, q.get("scene", ""), F["cellc"])
    ws.write(i, 5, q.get("note", ""), F["wrap"])
    ws.write(i, 6, q["confidence"], F["cellc"])

# ---------------- sheet 5: 工程手撕 ----------------
ws = wb.add_worksheet("04-工程手撕")
ws.set_column("A:A", 8)
ws.set_column("B:B", 90)
ws.write(0, 0, "序号", F["hdr"])
ws.write(0, 1, "非 LeetCode 原题（华为手撕常考，占样本约 1/4~1/3）", F["hdr"])
for i, t in enumerate(mj["non_leetcode"], start=1):
    ws.write(i, 0, i, F["num"])
    ws.write(i, 1, t, F["cell"])
ws.write(len(mj["non_leetcode"]) + 2, 1, "机考（ACM 模式，不是面试手撕）事后反查到的 LeetCode 题：", F["bold"])
for j, t in enumerate(mj["machine_test_only"], start=1):
    ws.write(len(mj["non_leetcode"]) + 2 + j, 1, f"{t['no']} {t['title']} —— {t['note']}", F["cell"])

# ---------------- sheet 6: 按类型 ----------------
ws = wb.add_worksheet("05-按算法类型")
ws.set_column("A:A", 18)
ws.set_column("B:B", 10)
ws.set_column("C:C", 120)
ws.write(0, 0, "主算法类型", F["hdr"])
ws.write(0, 1, "题数", F["hdr"])
ws.write(0, 2, "题目（优先级：题号）", F["hdr"])
bycat = defaultdict(list)
for q in rows:
    if q["tier"] in ("P0", "P1", "P2", "P3"):
        bycat[q["category"]].append(q)
for i, (cat, items) in enumerate(sorted(bycat.items(), key=lambda kv: -len(kv[1])), start=1):
    items.sort(key=lambda q: ({"P0": 0, "P1": 1, "P2": 2, "P3": 3}[q["tier"]], -q["huawei_freq"]))
    txt = "；".join(f"{q['no']}({q['tier']})" for q in items)
    ws.write(i, 0, cat, F["cell"])
    ws.write(i, 1, len(items), F["num"])
    ws.write(i, 2, txt, F["wrap"])

# ---------------- sheet 7: 热题100 ----------------
ws = wb.add_worksheet("06-热题100")
ws.set_column("A:A", 16)
ws.set_column("B:B", 8)
ws.set_column("C:C", 28)
ws.set_column("D:D", 8)
ws.set_column("E:E", 12)
ws.write(0, 0, "分组", F["hdr"])
ws.write(0, 1, "题号", F["hdr"])
ws.write(0, 2, "题目", F["hdr"])
ws.write(0, 3, "难度", F["hdr"])
ws.write(0, 4, "华为优先级", F["hdr"])
tier_by_no = {q["no"]: q["tier"] for q in rows}
for i, q in enumerate(hot100, start=1):
    ws.write(i, 0, q["group"], F["cell"])
    ws.write(i, 1, q["no"], F["cellc"])
    ws.write(i, 2, q["title"], F["cell"])
    ws.write(i, 3, {"EASY": "简单", "MEDIUM": "中等", "HARD": "困难"}.get(q["level"], q["level"]), F["cellc"])
    ws.write(i, 4, tier_by_no.get(q["no"], ""), F["cellc"])

# ---------------- sheet 8: 来源 ----------------
ws = wb.add_worksheet("07-来源与可信度")
ws.set_column("A:A", 34)
ws.set_column("B:B", 12)
ws.set_column("C:C", 14)
ws.set_column("D:D", 70)
src = [
    ("来源", "规模", "可信度", "说明"),
    ("力扣官方企业题库（华为）", "201 题", "高（但锁）", "leetcode.cn/company/huawei/；questionNumber=201 双源印证；需登录+Plus，题目清单无法匿名获取"),
    ("力扣华为系企业标签", "6 个", "高", "华为 201 / 华为OD 84 / 华为云 15 / 华为海思 9 / 华为无线网络 2 / 华为财经 1"),
    ("力扣公开题单 V3JZGPzX", "56 题", "中", "「LeetCode华为2025年秋招AI大模型岗推荐试题」，用户自建，非官方口径"),
    ("力扣热题100", "100 题", "高", "官方学习计划 top-100-liked，实习手撕的主要来源池"),
    ("力扣面试经典150", "150 题", "高", "官方学习计划 top-interview-150"),
    ("CodeTop 华为榜", "298 条/226 题", "高（统计）", "codetop.cc 面经提交统计，含公司维度频次；公开免费"),
    ("一手面经（牛客/CSDN/力扣讨论区/NiceOffer）", "15 篇", "高", "含 2025 实习亲历、华为在职员工答疑；题号已逐条核对"),
    ("面灵面经聚合（华为 142 篇）", "142 篇", "中", "二手聚合+AI 转写，可回溯原帖；本次最大题源"),
    ("小红书 / 微信公众号 TOP 榜", "未采信", "低", "反爬未取得正文；仅摘要显示为自媒体对约 100 道面经的二次汇总"),
    ("GitHub 华为 OD 题库仓库", "不适用", "不适用", "是「华为OD机试」题库，与实习面试手撕不是一回事，勿混用"),
]
for i, row in enumerate(src):
    for c, v in enumerate(row):
        ws.write(i, c, v, F["hdr"] if i == 0 else F["wrap"])

wb.close()

# ---------------- stats for the report ----------------
freq_dist = Counter()
for q in codetop:
    f = q["freq"]
    freq_dist[">=10" if f >= 10 else "5-9" if f >= 5 else "3-4" if f >= 3 else "1-2"] += 1
print("codetop unique:", len(codetop), "freq dist:", dict(freq_dist))
print("codetop level:", dict(Counter(lvl_by_no.get(q["no"]) for q in codetop)))
print("tier:", dict(Counter(q["tier"] for q in rows)))
print("total:", len(rows))
print("xlsx ->", os.path.abspath(OUT))
