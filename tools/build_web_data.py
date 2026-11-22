#!/usr/bin/env python3
"""把工作区的题库 / 题面 / 教程编译成前端可直接消费的 JSON。

输出: app/public/data/{problems,tutorials,meta}.json
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TUTORIAL_DIR = ROOT / "教程"
OUT = ROOT / "app" / "public" / "data"

LEVEL_MAP = {
    "简单": "Easy",
    "Easy": "Easy",
    "中等": "Medium",
    "Medium": "Medium",
    "困难": "Hard",
    "Hard": "Hard",
}

LEVEL_ORDER = {"Easy": 0, "Medium": 1, "Hard": 2}


def norm_level(raw: str | None) -> str:
    if not raw:
        return "Medium"
    key = str(raw).strip()
    # 目录里是 EASY / MEDIUM / HARD，精选数据里是 简单 / 中等 / 困难，两套都要认
    return LEVEL_MAP.get(key) or LEVEL_MAP.get(key.capitalize(), "Medium")


def read_json(path: Path):
    # utf-8-sig：有的数据文件带 BOM（比如 lc_hot100.json），用 utf-8 会直接解析失败；
    # 它对不带 BOM 的文件同样适用，所以统一用它。
    return json.loads(path.read_text(encoding="utf-8-sig"))


# ---------------------------------------------------------------------------
# 全量题库：把 LeetCode 中文站目录（lc_catalog.json）合进来
#
# 精选 365 道有题面/精讲/复杂度，是「学习路线」的主体；其余 4000+ 道只带元数据
# （题号/标题/难度/通过率/标签/链接），够用来浏览、搜索、收藏，不占题面体积。
# ---------------------------------------------------------------------------

# LeetCode 标签 → 本项目的 19 个专题。按「具体技巧优先于通用容器」排序，
# 一道题同时带 动态规划 和 数组 时归到动态规划。
TAG_PRIORITY: list[tuple[str, str]] = [
    ("回溯", "回溯"),
    ("动态规划", "动态规划"),
    ("记忆化搜索", "动态规划"),
    ("图", "图/DFS/BFS"),
    ("深度优先搜索", "图/DFS/BFS"),
    ("广度优先搜索", "图/DFS/BFS"),
    ("并查集", "图/DFS/BFS"),
    ("拓扑排序", "图/DFS/BFS"),
    ("最短路", "图/DFS/BFS"),
    ("二分查找", "二分查找"),
    ("贪心", "贪心"),
    ("单调栈", "单调栈/单调队列"),
    ("单调队列", "单调栈/单调队列"),
    ("滑动窗口", "滑动窗口"),
    ("双指针", "双指针"),
    ("前缀和", "前缀和"),
    ("堆（优先队列）", "堆/优先队列"),
    ("堆", "堆/优先队列"),
    ("哈希表", "哈希表"),
    ("链表", "链表"),
    ("二叉树", "二叉树/树"),
    ("二叉搜索树", "二叉树/树"),
    ("树", "二叉树/树"),
    ("字符串", "字符串"),
    ("栈", "栈/队列"),
    ("队列", "栈/队列"),
    ("位运算", "位运算"),
    ("数学", "数学"),
    ("数论", "数学"),
    ("几何", "数学"),
    ("概率与统计", "数学"),
    ("矩阵", "数组/矩阵"),
    ("数组", "数组/矩阵"),
    ("数据库", "数据库"),
    ("Shell", "Shell"),
    ("并发", "并发"),
]

TAG_RANK = {tag: index for index, (tag, _) in enumerate(TAG_PRIORITY)}
TAG_CATEGORY = {tag: category for tag, category in TAG_PRIORITY}


def derive_category(tags: list[str]) -> str:
    """按标签推专题：取优先级最高（最具体）的那个标签。"""
    best: tuple[int, str] | None = None
    for tag in tags or []:
        rank = TAG_RANK.get(tag)
        if rank is None:
            continue
        if best is None or rank < best[0]:
            best = (rank, TAG_CATEGORY[tag])
    return best[1] if best else "其他"


def norm_no(no: str) -> int:
    """题号排序键：数字题号按数值，LCP/LCR/LCS/面试题排到后面。"""
    no = str(no).strip()
    if no.isdigit():
        return int(no)
    prefix_rank = {"LCP": 900_000, "LCR": 910_000, "LCS": 920_000, "面试题": 930_000}
    for prefix, base in prefix_rank.items():
        if no.startswith(prefix):
            digits = re.sub(r"\D", "", no)
            return base + (int(digits) if digits else 0)
    digits = re.sub(r"\D", "", no)
    return 990_000 + (int(digits) if digits else 0)


def ac_percent(value) -> float | None:
    """统一通过率口径：精选数据是 43.1（百分数），目录数据是 0.431（小数）。"""
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num <= 1.0:
        num *= 100
    return round(num, 1)


# ---------------------------------------------------------------------------
# 题面分片：全量题库的题面 / 示例 / 代码模板不进 problems.json（那样会到 30MB+），
# 按题号每 50 道切一个文件，题目页打开时只取需要的那一片。
# ---------------------------------------------------------------------------

SHARD_SIZE = 50
TYPING_NAMES = ("List", "Optional", "Dict", "Set", "Tuple", "Deque", "Union", "Any")


def build_detail(raw: dict) -> dict:
    """把一条 GraphQL 题面记录整理成前端直接能用的形态。"""
    html = raw.get("translatedContent") or raw.get("content") or ""
    html = clean_statement(html) if html else ""
    examples = extract_examples(html) if html else []

    meta: dict = {}
    raw_meta = raw.get("metaData")
    if isinstance(raw_meta, str) and raw_meta.strip():
        try:
            meta = json.loads(raw_meta)
        except json.JSONDecodeError:
            meta = {}

    snippet = ""
    for item in raw.get("codeSnippets") or []:
        if item.get("langSlug") == "python3":
            snippet = (item.get("code") or "").strip()
            break

    method = str(meta.get("name") or "").strip()
    if not method:
        # metaData 没给方法名（设计题）时退回模板里的第一个 def；链表/树题的模板开头是
        # 注释掉的 ListNode.__init__，所以这条兜底只在拿不到 metaData 时才用。
        m = re.search(r"def\s+(\w+)\s*\(", snippet)
        if m:
            method = m.group(1)

    params = [p.get("name") for p in (meta.get("params") or []) if p.get("name")]
    if not params:
        for ex in examples:
            if ex.get("params"):
                params = ex["params"]
                break

    # LeetCode 的模板不含 import，这里补上（否则 List[int] 会 NameError）
    if snippet and "from typing import" not in snippet:
        used = [name for name in TYPING_NAMES if re.search(rf"\b{name}\[", snippet)]
        if used:
            snippet = f"from typing import {', '.join(used)}\n\n{snippet}"

    return {
        "html": html,
        "examples": examples,
        "method": method or "solve",
        "params": params,
        "starterCode": snippet,
        "metaData": meta,
        "hints": [h for h in (raw.get("hints") or []) if h],
        "sampleTestCase": raw.get("sampleTestCase") or "",
    }


def write_teachings(problems: list[dict]) -> dict:
    """把 data/teachings/<题号>.md 汇编成前端读的 teachings.json（Hot 100 的深度讲解）。"""
    src = DATA / "teachings"
    payload: dict[str, str] = {}
    if src.exists():
        for path in sorted(src.glob("*.md")):
            text = path.read_text(encoding="utf-8").strip()
            if text:
                payload[path.stem] = text

    for problem in problems:
        problem["hasTeaching"] = problem["no"] in payload

    (OUT / "teachings.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    return {"teachingCount": len(payload), "teachingChars": sum(len(v) for v in payload.values())}


def write_statements(problems: list[dict], full: dict, legacy: dict, edges: dict | None = None) -> dict:
    """给每道题挂上分片号，把题面写进 statements/<shard>.json，并清空 problems 里的内联题面。"""
    edges = edges or {}
    edge_cases = edges.get("cases") or {}
    edge_expected = edges.get("expected") or {}
    edge_skipped = edges.get("skipped") or {}
    # 参考解源码（data/ref_solutions/<题号>.json 的 code）：跟着题面一起进分片，
    # 题目页「解析」Tab 的「参考答案」块直接读它，不用另开一个请求。
    ref_codes = edges.get("codes") or {}
    shards: dict[int, dict] = {}
    with_statement = 0
    with_examples = 0
    with_hints = 0
    with_edge = 0
    with_edge_expected = 0
    with_ref_code = 0
    ref_code_chars = 0
    edge_total = 0
    edge_expected_total = 0

    for problem in problems:
        no = problem["no"]
        raw = full.get(no) or legacy.get(no) or {}
        detail = build_detail(raw) if raw and not raw.get("__error") else build_detail({})

        # 精选数据里已经解析好的题面/示例作为兜底（新缓存缺这道题时用）
        if not detail["html"] and problem.get("statementHtml"):
            detail["html"] = problem["statementHtml"]
            detail["examples"] = problem.get("examples") or []
        if not detail["examples"] and problem.get("examples"):
            detail["examples"] = problem.get("examples")
        if detail["method"] == "solve" and problem.get("method"):
            detail["method"] = problem["method"]
        if not detail["params"] and problem.get("params"):
            detail["params"] = problem["params"]

        has_statement = bool(detail["html"] or detail["examples"] or detail["hints"])
        problem["hasStatement"] = has_statement
        problem["shard"] = norm_no(no) // SHARD_SIZE
        problem["method"] = detail["method"]
        problem["params"] = detail["params"]
        # 参数类型（来自 LeetCode metaData）：用例生成 / 边界用例 / 校验都靠它
        meta_params = (detail.get("metaData") or {}).get("params") or []
        problem["paramTypes"] = [
            {"name": str(p.get("name") or ""), "type": str(p.get("type") or "")}
            for p in meta_params
            if p.get("name")
        ]
        problem["returnType"] = str(((detail.get("metaData") or {}).get("return") or {}).get("type") or "")
        # 题面/示例不再进 problems.json
        problem["statementHtml"] = ""
        problem["examples"] = []

        if has_statement:
            # 构建期边界用例：输入来自 data/edge_cases.json，期望输出来自参考解
            attached = attach_edge_cases(
                no, detail, edge_cases.get(no) or [], edge_expected.get(no) or {},
                set(edge_skipped.get(no) or []),
            )
            if attached:
                detail["edgeCases"] = attached
                with_edge += 1
                edge_total += len(attached)
                judged = sum(1 for item in attached if item["expected"])
                edge_expected_total += judged
                if judged:
                    with_edge_expected += 1
            shards.setdefault(problem["shard"], {})[no] = detail
            # 参考解：只挂 code 非空的（expected 为空也不影响 —— 代码本身就能载入编辑器跑）
            ref_code = ref_codes.get(no)
            if ref_code:
                detail["refCode"] = ref_code
                with_ref_code += 1
                ref_code_chars += len(ref_code)
            with_statement += 1
            if detail["examples"]:
                with_examples += 1
            if detail["hints"]:
                with_hints += 1

    out_dir = OUT / "statements"
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        stale.unlink()
    for shard, payload in shards.items():
        (out_dir / f"{shard}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    return {
        "statementCount": with_statement,
        "exampleCount": sum(
            len(d["examples"]) for payload in shards.values() for d in payload.values()
        ),
        "hintCount": with_hints,
        "shardCount": len(shards),
        "problemsWithExamples": with_examples,
        "edgeCaseCount": with_edge,
        "edgeCaseTotal": edge_total,
        "edgeExpectedCount": with_edge_expected,
        "edgeExpectedTotal": edge_expected_total,
        "refCodeCount": with_ref_code,
        "refCodeChars": ref_code_chars,
    }


# ---------------------------------------------------------------------------
# 边界用例：data/edge_cases.json（输入）+ data/ref_solutions/<题号>.json（期望输出）
#
# 分两段产出的原因：全量 3800+ 道题的输入可以按类型确定性地造，但「正确答案」只能靠
# 参考解跑出来 —— 只有 Hot 100 + 精选 365 有可信参考解。没有期望的边界用例照样有用
# （前端当成「只运行不判定」），所以两种都写进分片，用 expected 是否为空区分。
# ---------------------------------------------------------------------------

def normalize_call(call: str) -> str:
    """只用来去重：空白和引号写法差异不该算两条不同的用例。"""
    return re.sub(r"\s+", "", call or "").replace("'", '"')


def example_calls(detail: dict) -> set[str]:
    """官方示例已有的调用表达式（用来给边界用例去重）。"""
    method = detail.get("method") or ""
    out: set[str] = set()
    for example in detail.get("examples") or []:
        args = (example.get("callArgs") or "").strip()
        if not args or not method:
            continue
        out.add(normalize_call(f"Solution().{method}({args})"))
    return out


def attach_edge_cases(
    no: str, detail: dict, cases: list[dict], expected: dict, skipped: set[str]
) -> list[dict]:
    """挑出可以挂到题面上的边界用例：去重、丢掉参考解都跑不通的、补上期望输出。"""
    method = detail.get("method") or ""
    if not method or method == "solve":
        return []
    # 设计题的方法名是大写类名，没有 Solution().method() 可调
    if method[0].isupper():
        return []
    existing = example_calls(detail)
    seen: set[str] = set()
    out: list[dict] = []
    for item in cases:
        call = str(item.get("call") or "").strip()
        if not call:
            continue
        key = normalize_call(call)
        if key in existing or key in seen:
            continue
        seen.add(key)
        if call in skipped:
            continue
        value = str(expected.get(call) or "")
        # 极端哨兵值（±2^31 附近）是「按类型造边界」硬塞进去的，往往超出题目约束。
        # 这种输入上参考解的行为是猜的，拿它当期望会把写对的代码判错 —— 只运行不判定；
        # 同时标 extreme，前端把它上面的「报错」也降级成软提示（递归题会直接爆栈）。
        extreme = has_extreme_literal(call)
        if value and extreme:
            value = ""
        out.append({"call": call, "expected": value, "extreme": extreme})
    return out


EXTREME_LITERAL = re.compile(r"(?<![\w.])(-?)(?:2147483647|2147483648|2147483646|1000000000|1000000007|999999999)(?![\w.])")


def has_extreme_literal(call: str) -> bool:
    """调用表达式里有没有 ±2^31 这类极端哨兵值。"""
    return bool(EXTREME_LITERAL.search(call))





def split_top_level(text: str, sep: str = ",") -> list[str]:
    """按顶层分隔符切分，忽略括号和引号内的分隔符。"""
    parts, buf, depth, quote = [], [], 0, None
    for ch in text:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
            buf.append(ch)
        elif ch in "[{(":
            depth += 1
            buf.append(ch)
        elif ch in "]})":
            depth -= 1
            buf.append(ch)
        elif ch == sep and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def py_literal(text: str) -> str:
    """把 LeetCode 示例里的 JSON 风格值转成 Python 字面量。"""
    text = text.strip().rstrip(",")
    text = re.sub(r"\bnull\b", "None", text)
    text = re.sub(r"\btrue\b", "True", text)
    text = re.sub(r"\bfalse\b", "False", text)
    return text


def parse_input_args(raw: str) -> tuple[str, list[str]]:
    """返回 (调用参数字符串, 形参名列表)。"""
    raw = re.sub(r"\s+", " ", raw.strip())
    if not raw:
        return "", []
    parts = split_top_level(raw)
    named: list[tuple[str, str]] = []
    all_named = True
    for part in parts:
        m = re.match(r"^([A-Za-z_]\w*)\s*=\s*(.+)$", part, re.S)
        if m:
            named.append((m.group(1), py_literal(m.group(2))))
        else:
            all_named = False
            named.append(("", py_literal(part)))
    if all_named:
        return ", ".join(f"{k}={v}" for k, v in named), [k for k, _ in named]
    return ", ".join(v for _, v in named), []


def extract_pre_examples(soup) -> list[dict]:
    """老格式：<pre> 里「输入：/ 输出：/ 解释：」三段。"""
    examples = []
    for pre in soup.find_all("pre"):
        # 注意用 get_text("")：行内 <strong>/<code> 用 "\n" 拼会被拆成
        # "le e etcode" 这种带空格的假文本（40 道题的示例按钮因此是坏的）。
        text = pre.get_text("").replace("\xa0", " ")
        text = re.sub(r"[ \t]+\n", "\n", text).strip()
        m = re.search(
            r"输入\s*[：:]\s*(.*?)\s*输出\s*[：:]\s*(.*?)(?:\s*解释\s*[：:]\s*(.*))?$",
            text,
            re.S,
        )
        if not m:
            continue
        raw_in, raw_out, explain = m.group(1), m.group(2), m.group(3)
        raw_in = re.sub(r"\s*\n\s*", " ", raw_in).strip()
        raw_out = re.sub(r"\s*\n\s*", " ", raw_out).strip()
        call_args, params = parse_input_args(raw_in)
        examples.append(
            {
                "input": raw_in,
                "output": raw_out,
                "explain": (explain or "").strip(),
                "callArgs": call_args,
                "params": params,
            }
        )
    return examples


def extract_examples(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    examples = extract_pre_examples(soup)
    # <pre> 一条都没解析出来时才走新版 example-block 格式，避免改动已有示例的顺序/内容
    if examples:
        return examples
    return extract_block_examples(soup)


# ---------------------------------------------------------------------------
# 新版题面格式：<div class="example-block">
#
# 2024 年起 LeetCode 逐步把「示例」从 <pre> 换成 <div class="example-block">，字段是
# <p> 里的 <strong>输入：</strong> / <strong>输出：</strong> / <strong>解释：</strong>。
# 版面并不统一，实测三种：
#   1) 一个 block = 一道示例，三个 <p> 各一个字段（最常见）；
#   2) 输入/输出/解释 各自是一个独立 block（如 1813），中间还夹空 block；
#   3) 一个 block 里塞多道示例，示例之间用 <strong>示例 2：</strong> 分隔（如 3208、3108）。
# 因此不按 block 逐个解析，而是把全篇 example-block 的文本按文档顺序拼起来，
# 再按「输入 → 输出 →（解释）」的标签顺序切字段，这样三种版面都能吃下。
# ---------------------------------------------------------------------------

# 块级标签前后补换行，保住「一段一行」；span/b/strong/code/u 等行内标签不拆行
EX_BLOCK_TAGS = {
    "p", "div", "pre", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th",
    "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "figure", "figcaption", "dl", "dt", "dd",
}

# 标签必须落在行首：解释正文里偶尔会出现「输入：」这类字样，不锚行首会切错
EX_BLOCK_LABEL_RE = re.compile(
    r"(?m)^[ \t]*(输入|输出|解释|Input|Output|Explanation)\s*[：:]",
    re.I,
)
EX_BLOCK_LABEL_KIND = {
    "输入": "input",
    "input": "input",
    "输出": "output",
    "output": "output",
    "解释": "explain",
    "explanation": "explain",
}
# 「示例 2：」这种标题会挂在上一道示例的解释末尾，切完字段后去掉
EX_BLOCK_HEADING_RE = re.compile(r"\s*示例\s*\d+\s*[：:]\s*$")


def example_block_text(el) -> str:
    """把一个 example-block 渲染成纯文本：段落一行，行内元素不拆行，<pre> 保留原换行。"""
    from bs4.element import Comment, NavigableString

    parts: list[str] = []

    def walk(node) -> None:
        if isinstance(node, Comment):
            # 题面里混进了编辑器注释（如 3161 的 <!-- notionvc: … -->），不是正文
            return
        if isinstance(node, NavigableString):
            parts.append(str(node))
            return
        name = getattr(node, "name", None)
        if name == "br":
            parts.append("\n")
            return
        if name == "img":
            # 图里的信息取不到，留个空格免得前后文字粘在一起
            parts.append(" ")
            return
        if name in EX_BLOCK_TAGS:
            parts.append("\n")
            for child in node.children:
                walk(child)
            parts.append("\n")
        else:
            for child in node.children:
                walk(child)

    walk(el)
    text = "".join(parts).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text)


def tidy_example_field(value: str, keep_lines: bool) -> str:
    """去掉「示例 N：」尾巴并规整空白：input/output 压成一行，explain 保留换行。"""
    value = EX_BLOCK_HEADING_RE.sub("", value.strip())
    if keep_lines:
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.split("\n")]
        return "\n".join(line for line in lines if line).strip()
    return re.sub(r"\s+", " ", value).strip()


def extract_block_examples(soup) -> list[dict]:
    """从 <div class="example-block"> 里兜底解析示例，返回结构与 <pre> 版一致。"""
    blocks = [
        block
        for block in soup.find_all(class_="example-block")
        # 嵌套时只用外层，否则同一段文字会被算两遍
        if not block.find_parent(class_="example-block")
    ]
    if not blocks:
        return []
    text = "\n".join(example_block_text(block) for block in blocks)

    labels = list(EX_BLOCK_LABEL_RE.finditer(text))
    fields: list[tuple[str, str]] = []
    for i, match in enumerate(labels):
        end = labels[i + 1].start() if i + 1 < len(labels) else len(text)
        kind = EX_BLOCK_LABEL_KIND[match.group(1).lower()]
        fields.append((kind, text[match.end():end]))

    # 一个「输入」开一道新示例；输出/解释挂到当前示例上
    raw_examples: list[dict] = []
    current: dict | None = None
    for kind, value in fields:
        if kind == "input":
            if current is not None:
                raw_examples.append(current)
            current = {"input": value, "output": "", "explain": ""}
        elif current is None:
            continue
        elif kind == "output":
            current["output"] = (
                f"{current['output']} {value}" if current["output"] else value
            )
        else:
            current["explain"] = (
                f"{current['explain']}\n{value}" if current["explain"] else value
            )
    if current is not None:
        raw_examples.append(current)

    examples: list[dict] = []
    for item in raw_examples:
        raw_in = tidy_example_field(item["input"], keep_lines=False)
        raw_out = tidy_example_field(item["output"], keep_lines=False)
        if not raw_in or not raw_out:
            # 只有解释的 block（纯说明 / 表格）不算示例
            continue
        call_args, params = parse_input_args(raw_in)
        examples.append(
            {
                "input": raw_in,
                "output": raw_out,
                "explain": tidy_example_field(item["explain"], keep_lines=True),
                "callArgs": call_args,
                "params": params,
            }
        )
    return examples


def clean_statement(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if src.startswith("/"):
            img["src"] = "https://leetcode.cn" + src
    for a in soup.find_all("a"):
        a["target"] = "_blank"
        a["rel"] = "noreferrer"
    body = soup.body or soup
    return body.decode_contents()


def load_edge_data() -> dict:
    """读边界用例（输入）和参考解（期望输出 + 源码）。

    返回 {"cases": {题号: [...]}, "expected": {题号: {call: repr}},
          "skipped": {题号: [call]}, "codes": {题号: 参考解源码}}。
    数据缺了也能构建 —— 只是没有边界用例 / 参考答案。
    """
    cases: dict[str, list[dict]] = {}
    expected: dict[str, dict[str, str]] = {}
    skipped: dict[str, list[str]] = {}
    codes: dict[str, str] = {}

    cases_path = DATA / "edge_cases.json"
    if cases_path.exists():
        cases = read_json(cases_path)

    ref_dir = DATA / "ref_solutions"
    if ref_dir.exists():
        for path in sorted(ref_dir.glob("*.json")):
            # 题号不一定是纯数字（面试题 08.06 / 剑指 Offer 04 / LCP 06 都是题号）；
            # 下划线开头的是运行记录（_report.json），不参与构建。
            if path.stem.startswith("_"):
                continue
            try:
                payload = read_json(path)
            except (json.JSONDecodeError, OSError):
                continue
            if not isinstance(payload, dict):
                continue
            no = path.stem
            code = payload.get("code")
            if isinstance(code, str) and code.strip():
                codes[no] = code.strip()
            exp = payload.get("expected")
            if isinstance(exp, dict):
                expected[no] = {str(k): str(v) for k, v in exp.items()}
            skip = payload.get("skipped")
            if isinstance(skip, list):
                skipped[no] = [str(item) for item in skip]

    return {"cases": cases, "expected": expected, "skipped": skipped, "codes": codes}


def slugify(text: str, index: int) -> str:
    base = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text.lower()).strip("-")
    return f"{base[:40] or 'section'}-{index}"


def doc_group(doc_id: str) -> tuple[str, int]:
    if doc_id.startswith("0"):
        return "基础", 0
    if doc_id[:2] in {"10", "11", "12", "13"}:
        return "第一册 · 华为核心 39 题", 1
    if doc_id[:2].isdigit() and 20 <= int(doc_id[:2]) <= 32:
        return "第二册 · 专题全覆盖", 2
    if doc_id[:2].isdigit() and 40 <= int(doc_id[:2]) <= 59:
        return "第三册 · 精讲补全", 3
    return "附录", 4


HEADING_RE = re.compile(r"^##\s+(.+?)\s*$", re.M)
PROBLEM_RE = re.compile(
    r"力扣\s*(剑指\s*Offer\s*[\d\-]+\s*(?:II)?|面试题\s*[\d.]+|补充题\s*\d+|\d+)"
)
METHOD_RE = re.compile(r"def\s+(\w+)\s*\(\s*self")


def parse_tutorial(path: Path) -> dict | None:
    doc_id = path.stem
    if doc_id in {"README", "_写作规范", "总目录"}:
        return None
    text = path.read_text(encoding="utf-8")
    title_m = re.search(r"^#\s+(.+?)\s*$", text, re.M)
    title = title_m.group(1) if title_m else doc_id

    matches = list(HEADING_RE.finditer(text))
    intro = text[: matches[0].start()].strip() if matches else text.strip()
    sections = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        heading = m.group(1)
        head_tail = body[:800]
        no_m = PROBLEM_RE.search(head_tail)
        problem_no = re.sub(r"\s+", " ", no_m.group(1)).strip() if no_m else None
        level_m = re.search(r"[（(](Easy|Medium|Hard|简单|中等|困难)[）)]", heading)
        if not level_m:
            level_m = re.search(
                r"·\s*(Easy|Medium|Hard|简单|中等|困难)", head_tail
            )
        level = norm_level(level_m.group(1)) if level_m else None
        method = None
        for block in re.findall(r"```(?:python)?\n(.*?)```", body, re.S):
            # 只在 class Solution 之后找方法名：
            # 同一个代码块里常常先定义 ListNode / TreeNode，它们的 __init__ 会抢在前面
            idx = block.find("class Solution")
            if idx < 0:
                continue
            mm = METHOD_RE.search(block[idx:])
            if mm:
                method = mm.group(1)
                break
        if method is None:
            for block in re.findall(r"```(?:python)?\n(.*?)```", body, re.S):
                mm = METHOD_RE.search(block)
                if mm and mm.group(1) != "__init__":
                    method = mm.group(1)
                    break
        sections.append(
            {
                "id": slugify(heading, i),
                "title": heading,
                "markdown": body,
                "problemNo": problem_no,
                "level": level,
                "method": method,
                "kind": "review" if "回顾" in heading else "lesson",
                "index": i,
            }
        )

    group, order = doc_group(doc_id)
    first_para = ""
    for para in intro.split("\n\n"):
        clean = para.strip().lstrip("> ").strip()
        if clean and not clean.startswith("#"):
            first_para = re.sub(r"[*`>]", "", clean)[:110]
            break

    return {
        "id": doc_id,
        "title": title,
        "group": group,
        "order": order,
        "summary": first_para,
        "intro": intro,
        "sections": sections,
        "problemCount": len({s["problemNo"] for s in sections if s["problemNo"]}),
    }


def main() -> None:
    master = read_json(DATA / "master.json")
    cx_path = DATA / "complexity.json"
    complexity = read_json(cx_path) if cx_path.exists() else {}
    statements = read_json(DATA / "statements_cache.json")

    catalog_path = DATA / "lc_catalog.json"
    catalog = read_json(catalog_path) if catalog_path.exists() else []
    hot100_path = DATA / "lc_hot100.json"
    hot100 = read_json(hot100_path) if hot100_path.exists() else []
    hot100_group = {str(item.get("no", "")).strip(): item.get("group") for item in hot100}
    catalog_by_no = {str(item.get("no", "")).strip(): item for item in catalog}

    # 面试经典 150：以 data/lc_top150.json 为唯一来源，全量题库（精选 + 补充 + 目录）都按它标记。
    # 题号格式不统一（"1" / 1 / "面试题 08.06"），统一 str().strip() 后比较。
    top150_path = DATA / "lc_top150.json"
    top150 = read_json(top150_path) if top150_path.exists() else []
    top150_set = {
        str(item.get("no", "")).strip() for item in top150 if str(item.get("no", "")).strip()
    }

    tutorials = []
    for path in sorted(TUTORIAL_DIR.glob("*.md")):
        doc = parse_tutorial(path)
        if doc:
            tutorials.append(doc)
    tutorials.sort(key=lambda d: (d["order"], d["id"]))

    # 题号 -> 方法名（优先非回顾章节）
    method_map: dict[str, str] = {}
    for doc in tutorials:
        for sec in doc["sections"]:
            no, method = sec["problemNo"], sec["method"]
            if no and method and (no not in method_map or sec["kind"] == "lesson"):
                method_map[no] = method

    tutorial_refs: dict[str, list[dict]] = {}
    for doc in tutorials:
        for sec in doc["sections"]:
            if not sec["problemNo"]:
                continue
            tutorial_refs.setdefault(sec["problemNo"], []).append(
                {
                    "docId": doc["id"],
                    "docTitle": doc["title"],
                    "sectionId": sec["id"],
                    "sectionTitle": sec["title"],
                    "kind": sec["kind"],
                    "level": sec["level"],
                }
            )

    problems = []
    for item in master:
        no = str(item.get("no", "")).strip()
        if not no:
            continue
        raw_stmt = statements.get(no, {})
        html = raw_stmt.get("translatedContent") or raw_stmt.get("content") or ""
        examples = extract_examples(html) if html else []
        method = method_map.get(no, "solve")
        params = []
        for ex in examples:
            if ex["params"]:
                params = ex["params"]
                break
        refs = tutorial_refs.get(no, [])
        # 目录里的通过率/标签/付费标记更全，精选数据缺的字段用它补齐
        catalog_item = catalog_by_no.get(no, {})
        tags = item.get("tags") or catalog_item.get("tags") or []
        problems.append(
            {
                "no": no,
                "title": item.get("title") or raw_stmt.get("translatedTitle") or no,
                "slug": item.get("slug") or catalog_item.get("slug", ""),
                "level": norm_level(item.get("level")),
                "acRate": ac_percent(item.get("ac_rate"))
                if item.get("ac_rate") is not None
                else ac_percent(catalog_item.get("ac_rate")),
                "tags": tags,
                "paid": bool(item.get("paid", catalog_item.get("paid", False))),
                "huaweiFreq": item.get("huawei_freq"),
                "inHuaweiList": bool(item.get("in_huawei_list")),
                "hot100Group": item.get("hot100_group") or hot100_group.get(no),
                "inTop150": no in top150_set,
                "mjSources": item.get("mj_sources"),
                "mjConfidence": item.get("mj_confidence"),
                "mjScene": item.get("mj_scene"),
                "mjNote": item.get("mj_note"),
                "sources": item.get("sources") or [],
                "tier": item.get("tier") or "其他",
                "category": item.get("category") or "其他",
                "estMin": item.get("est_min"),
                "complexity": complexity.get(no),
                "statementHtml": clean_statement(html) if html else "",
                "examples": examples,
                "method": method,
                "params": params,
                "tutorial": refs,
                "leetcodeUrl": f"https://leetcode.cn/problems/{item.get('slug') or catalog_item.get('slug', '')}/"
                if (item.get("slug") or catalog_item.get("slug"))
                else "",
                # 精选题：有题面/精讲/复杂度，构成学习路线
                "curated": True,
                # LeetCode 热题 100
                "hot100": no in hot100_group,
            }
        )

    known = {p["no"] for p in problems}
    for no, raw in statements.items():
        if no in known:
            continue
        html = raw.get("translatedContent") or raw.get("content") or ""
        problems.append(
            {
                "no": no,
                "title": raw.get("translatedTitle") or raw.get("title") or no,
                "slug": "",
                "level": norm_level(raw.get("difficulty")),
                "acRate": None,
                "tags": [],
                "paid": False,
                "huaweiFreq": None,
                "inHuaweiList": False,
                "hot100Group": None,
                "inTop150": no in top150_set,
                "mjSources": None,
                "mjConfidence": None,
                "mjScene": None,
                "mjNote": None,
                "sources": [],
                "tier": "补充",
                "category": "其他",
                "estMin": None,
                "complexity": complexity.get(no),
                "statementHtml": clean_statement(html),
                "examples": extract_examples(html),
                "method": method_map.get(no, "solve"),
                "params": [],
                "tutorial": tutorial_refs.get(no, []),
                "leetcodeUrl": "",
                "curated": True,
                "hot100": no in hot100_group,
            }
        )

    # ---- 全量题库：目录里剩下的题只带元数据 ----
    known = {p["no"] for p in problems}
    for item in catalog:
        no = str(item.get("no", "")).strip()
        if not no or no in known:
            continue
        slug = item.get("slug") or ""
        tags = item.get("tags") or []
        problems.append(
            {
                "no": no,
                "title": item.get("title") or no,
                "slug": slug,
                "level": norm_level(item.get("level")),
                "acRate": ac_percent(item.get("ac_rate")),
                "tags": tags,
                "paid": bool(item.get("paid")),
                "huaweiFreq": None,
                "inHuaweiList": False,
                "hot100Group": hot100_group.get(no),
                "inTop150": no in top150_set,
                "mjSources": None,
                "mjConfidence": None,
                "mjScene": None,
                "mjNote": None,
                "sources": [],
                "tier": "补充",
                "category": derive_category(tags),
                "estMin": None,
                "complexity": complexity.get(no),
                "statementHtml": "",
                "examples": [],
                "method": method_map.get(no, "solve"),
                "params": [],
                "tutorial": tutorial_refs.get(no, []),
                "leetcodeUrl": f"https://leetcode.cn/problems/{slug}/" if slug else "",
                "curated": False,
                "hot100": no in hot100_group,
            }
        )
        known.add(no)

    problems.sort(key=lambda p: (norm_no(p["no"]), p["no"]))

    # 题号对不上时（比如数据里换了写法）别静默少标，构建时吵一声
    matched_top150 = sum(1 for p in problems if p["inTop150"])
    if top150_set and len(top150_set) != matched_top150:
        print(
            f"warning: lc_top150.json 有 {len(top150_set)} 道题，题库里只匹配到 {matched_top150} 道",
            file=sys.stderr,
        )

    OUT.mkdir(parents=True, exist_ok=True)

    # 全量题面 → 分片文件；problems.json 里只留 hasStatement / shard
    full_path = DATA / "statements_full.json"
    full = read_json(full_path) if full_path.exists() else {}
    edge_data = load_edge_data()
    statement_meta = write_statements(problems, full, statements, edge_data)
    teaching_meta = write_teachings(problems)

    (OUT / "problems.json").write_text(
        json.dumps(problems, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    (OUT / "tutorials.json").write_text(
        json.dumps(tutorials, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "problemCount": len(problems),
        "curatedCount": sum(1 for p in problems if p["curated"]),
        "hot100Count": sum(1 for p in problems if p["hot100"]),
        "top150Count": sum(1 for p in problems if p["inTop150"]),
        **statement_meta,
        **teaching_meta,
        "tutorialCount": len(tutorials),
        "tutorialSectionCount": sum(len(d["sections"]) for d in tutorials),
        "tiers": dict(Counter(p["tier"] for p in problems)),
        "levels": dict(Counter(p["level"] for p in problems)),
        "categories": dict(Counter(p["category"] for p in problems)),
    }
    (OUT / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps(meta, ensure_ascii=False, indent=2))
    print("output:", OUT)


if __name__ == "__main__":
    main()
