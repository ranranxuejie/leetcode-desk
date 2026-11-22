#!/usr/bin/env python3
"""按 LeetCode 参数类型给全量题库生成「边界输入」用例。

为什么需要：官方示例通常只有 2-4 条、而且是最常规的输入，导致「没处理边界的代码
也能跑对」。这里按 metaData 里的形参类型，确定性地生成空数组 / 单元素 / 全相同 /
极值这类真正能抓 bug 的输入。

输出：data/edge_cases.json
    { "<题号>": [{ "call": "Solution().twoSum(nums=[], target=0)", "expected": "" }] }

约定：
- `call` 是能直接 eval 的 Python 表达式，形参名来自 metaData.params，方法名来自 metaData.name；
- `expected` 这里一律留空串（前端当成「只运行不判定」），真正的期望输出由
  tools/gen_ref_solutions.py 用参考解跑出来，再由 tools/build_web_data.py 合并；
- 链表 / 树题直接写数组字面量（`head=[1, 2, 3]`），运行时由前端的 `_build_list` /
  `_build_tree` 负责搭出节点；N 叉树（559/589/590/429）和四叉树（558）同理，用
  `_build_nary_tree` / `_build_quad`，见下面的 PARAM_TYPE_OVERRIDES；
- 只给「形参类型全都认识」的题生成，认不出的类型整题跳过 —— 瞎拼出来的实参只会
  让用户看到一屏 TypeError。

用法：
    python tools/gen_edge_cases.py            # 全量
    python tools/gen_edge_cases.py --limit 50 # 先试 50 道
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import zlib
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SRC = DATA / "statements_full.json"
OUT = DATA / "edge_cases.json"

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PY_KEYWORDS = set(
    "False None True and as assert async await break class continue def del elif else "
    "except finally for from global if import in is lambda nonlocal not or pass raise "
    "return try while with yield".split()
)

# 设计题的 metaData 没有 name（只有 classname/methods），这些名字也不是「一个函数」
SKIP_METHODS = {"", "foobar", "solve", "__init__"}

MAX_CASES = 8
MIN_CASES = 4


# ---------------------------------------------------------------------------
# 类型 → 边界字面量
#
# 每个列表的第一个元素是「最短 / 最空」，最后一个元素是「最长 / 最极端」；
# 多参数组合时用这两个端点拼出「全最短」「全最长」两组。
# ---------------------------------------------------------------------------

INT_MAX = "2147483647"
INT_MIN = "-2147483648"

TYPE_VALUES: dict[str, list[str]] = {
    # 标量
    "integer": ["0", "1", "-1", INT_MAX, INT_MIN],
    "long": ["0", "1", "-1", "9223372036854775807", "-9223372036854775808"],
    "double": ["0.0", "1.0", "-1.5", "0.5"],
    "boolean": ["True", "False"],
    "string": ['""', '"a"', '"aa"', '"abba"'],
    "character": ['"a"', '"A"', '"z"', '"0"'],
    # 一维数组
    "integer[]": ["[]", "[0]", "[1]", "[1, 1]", "[-1, 0, 1]", "[1, 2, 3, 4, 5]"],
    "list<integer>": ["[]", "[0]", "[1]", "[1, 1]", "[-1, 0, 1]", "[1, 2, 3, 4, 5]"],
    "long[]": ["[]", "[0]", "[1, -1]", "[1, 2, 3, 4, 5]"],
    "double[]": ["[]", "[0.0]", "[1.0, -1.5]", "[0.5, 0.5]"],
    "boolean[]": ["[]", "[True]", "[False, True]", "[True, True]"],
    "list<boolean>": ["[]", "[True]", "[False, True]", "[True, True]"],
    "string[]": ["[]", '["a"]', '["ab", "ba"]', '["a", "a", "b"]'],
    "list<string>": ["[]", '["a"]', '["ab", "ba"]', '["a", "a", "b"]'],
    "character[]": ["[]", '["a"]', '["a", "b"]', '["a", "a"]'],
    # 二维数组 / 矩阵
    "integer[][]": [
        "[]",
        "[[1]]",
        "[[1, 2], [3, 4]]",
        "[[1, 2, 3], [4, 5, 6], [7, 8, 9]]",
    ],
    "list<list<integer>>": [
        "[]",
        "[[1]]",
        "[[1, 2], [3, 4]]",
        "[[1, 2, 3], [4, 5, 6], [7, 8, 9]]",
    ],
    "long[][]": ["[]", "[[1]]", "[[1, 2], [3, 4]]", "[[1, 2, 3], [4, 5, 6], [7, 8, 9]]"],
    "string[][]": ["[]", '[["a"]]', '[["ab"], ["ba"]]', '[["a", "b"], ["c", "d"]]'],
    "list<list<string>>": ["[]", '[["a"]]', '[["ab"], ["ba"]]', '[["a", "b"], ["c", "d"]]'],
    "character[][]": ["[]", '[["a"]]', '[["a", "b"], ["c", "d"]]', '[["a", "a"], ["a", "a"]]'],
    # 节点（运行时由前端的 _build_list / _build_tree 构造）
    "ListNode": ["[]", "[1]", "[1, 2]", "[1, 2, 3]"],
    "TreeNode": ["[]", "[1]", "[1, 2, 3]", "[1, 2, 3, 4, 5]"],
    # N 叉树 / 四叉树：metaData 把这两类题的形参类型写成了 integer / integer[][]，
    # 靠 PARAM_TYPE_OVERRIDES 按题号改成这两个内部名（和 gen_ref_solutions.py 的
    # NODE_TYPE_OVERRIDES 一一对应，内部名不会出现在题库数据里，所以别的题碰不到）。
    # 值都是 LeetCode 的层序数组：
    #   N 叉树 [1, None, 3, 2, 4] = 根 1 的孩子是 [3, 2, 4]（每组子节点前一个 None 分隔）；
    #   四叉树 [[isLeaf, val], ...] 每个节点占 4 个槽位，叶子节点的槽位写 None
    #   （和 gen_ref_solutions.py 的 _dump_quad 互逆，也就是官方示例的写法）。
    "NaryNode": [
        "[]",                                   # 空树：maxDepth=0 / 遍历=[]
        "[1]",                                  # 只有一个根
        "[1, None, 2]",                         # 根 + 一个孩子
        "[1, None, 2, 3, 4]",                   # 根 + 三个叶子孩子
        "[1, None, 3, 2, 4, None, 5, 6]",       # 官方示例形状：两层、有一支再分
        "[1, None, 2, None, 3, None, 4]",       # 单链，深度 4（递归深度的边界）
        "[0, None, 1, 1]",                      # 值取 0 / 全相同
    ],
    "QuadNode": [
        "[[1, 0]]",                             # 单叶子、全 0（1*1 也能表示全 0 的大矩阵）
        "[[1, 1]]",                             # 单叶子、全 1
        "[[0, 0], [1, 0], [1, 0], [1, 0], [1, 0]]",           # 未折叠的全 0
        "[[0, 0], [1, 1], [1, 1], [1, 1], [1, 1]]",           # 未折叠的全 1
        "[[0, 0], [1, 0], [1, 1], [1, 1], [1, 0]]",           # 2*2 四象限 0/1/1/0
        # 4*4：只有一个象限再分一层（官方示例那种「同一棵树里深度不一致」的形状）
        "[[0, 0], [1, 1], [0, 0], [1, 1], [1, 0], None, None, None, None, "
        "[1, 0], [1, 0], [1, 0], [1, 0]]",
    ],
    "ListNode[]": ["[]", "[[1]]", "[[1, 2], [3, 4]]", "[[1], [1, 2]]"],
    "list<TreeNode>": ["[]", "[[1]]", "[[1, 2, 3]]", "[[1, 2, 3], [4, 5, 6]]"],
}

# 题号 → {形参名: 内部类型}：metaData 丢掉的节点类型，按题号钉死。
#
# 为什么必须按题号：`root` 在 559/589/590/429 上是 N 叉树、在 104/144/145 上是二叉树，
# 类型名（integer / TreeNode）一模一样，只有题号能区分；558 的 quadTree1/2 被写成了
# integer[][]，而 427 的 grid 是货真价实的 integer[][] —— 只看类型名必然误伤。
# 这份表必须和 gen_ref_solutions.py 的 NODE_TYPE_OVERRIDES 对齐，否则生成的输入
# 和参考解的构造方式对不上（int 上跑 maxDepth 只会 AttributeError）。
PARAM_TYPE_OVERRIDES: dict[str, dict[str, str]] = {
    "559": {"root": "NaryNode"},      # N 叉树的最大深度
    "589": {"root": "NaryNode"},      # N 叉树的前序遍历
    "590": {"root": "NaryNode"},      # N 叉树的后序遍历
    "429": {"root": "NaryNode"},      # N 叉树的层序遍历
    "558": {"quadTree1": "QuadNode", "quadTree2": "QuadNode"},  # 四叉树交集
}

# 题号 → {形参名: 边界字面量}：类型名没错，但通用值违反题目约束，按题覆盖。
PARAM_VALUE_OVERRIDES: dict[str, dict[str, list[str]]] = {
    # 427 的 grid 确实是 integer[][]，但题目要求 n*n（n 是 2 的幂）且每格只取 0/1；
    # 通用 integer[][] 给出的 [[1,2,3],[4,5,6],[7,8,9]] 是非法输入，参考解在上面
    # 只会建出一棵错位的树，拿它当期望等于给用户埋坑。
    "427": {
        "grid": [
            "[[0]]",
            "[[1]]",
            "[[0, 0], [0, 0]]",
            "[[1, 1], [1, 1]]",
            "[[1, 1], [1, 0]]",
            "[[1, 1, 0, 0], [1, 1, 0, 0], [0, 0, 1, 1], [0, 0, 1, 1]]",
        ]
    },
}

# 随机组合时不要碰的值：2**31 这种极值塞进「循环到 n」的题会直接把浏览器跑挂，
# 所以极值只出现在「全最长」那一组（每题最多一条），随机组合用温和的值。
EXTREME = {INT_MAX, INT_MIN, "9223372036854775807", "-9223372036854775808"}

# 类型名归一化：大小写、空格、Optional 外壳
OPTIONAL_RE = re.compile(r"^Optional\s*\[\s*(.+?)\s*\]$", re.I)


def norm_type(raw: str) -> str:
    text = re.sub(r"\s+", "", raw or "")
    for _ in range(3):
        m = OPTIONAL_RE.match(text)
        if not m:
            break
        text = m.group(1)
    return text


def values_for(type_name: str) -> list[str] | None:
    """认识这个类型就返回边界字面量列表，不认识返回 None（调用方整题跳过）。"""
    return TYPE_VALUES.get(norm_type(type_name))


def seed_of(no: str) -> int:
    """固定种子：同一道题每次生成的组合完全一样，方便断点续跑和回归。"""
    text = str(no)
    return int(text) if text.isdigit() else zlib.crc32(text.encode("utf-8"))


def _needs_special_nodes(meta: dict) -> bool:
    """形参或返回值里有没有链表 / 树节点（manual 题里这些多半需要特殊构造）。"""
    types = [str(p.get("type") or "") for p in meta.get("params") or []]
    types.append(str((meta.get("return") or {}).get("type") or ""))
    return any("ListNode" in t or "TreeNode" in t for t in types)


def safe_values(values: list[str]) -> list[str]:
    mild = [v for v in values if v not in EXTREME]
    return mild or values


def build_cases(no: str, meta: dict) -> list[dict] | None:
    """给一道题生成边界用例；生成不出来返回 None。"""
    method = str(meta.get("name") or "").strip()
    if method in SKIP_METHODS or not IDENT.match(method) or PY_KEYWORDS.__contains__(method):
        return None
    # 设计题的方法名是大写开头的类名，没有「一个函数」可调
    if method[0].isupper():
        return None

    params = meta.get("params") or []
    if not params:
        return None
    type_overrides = PARAM_TYPE_OVERRIDES.get(no) or {}
    value_overrides = PARAM_VALUE_OVERRIDES.get(no) or {}
    names: list[str] = []
    candidates: list[list[str]] = []
    for param in params:
        name = str(param.get("name") or "").strip()
        # 类型名先按题号覆盖（N 叉树 / 四叉树），再按形参名覆盖边界字面量（427 的 grid）
        type_name = type_overrides.get(name) or str(param.get("type") or "")
        values = value_overrides.get(name) or values_for(type_name)
        if not name or not IDENT.match(name) or values is None:
            return None
        names.append(name)
        candidates.append(values)

    # 形参名撞上 Python 关键字（`from=1`）会直接语法错误 → 退回位置实参
    use_keywords = all(name not in PY_KEYWORDS for name in names)

    def render(values: list[str]) -> str:
        if use_keywords:
            args = ", ".join(f"{name}={value}" for name, value in zip(names, values))
        else:
            args = ", ".join(values)
        return f"Solution().{method}({args})"

    combos: list[list[str]] = []
    if len(candidates) == 1:
        combos = [[value] for value in candidates[0]]
    else:
        # 1) 全最短 2) 全最长 3/4) 长短交错（保证「一空一满」这种最容易抓 bug 的组合）
        combos.append([values[0] for values in candidates])
        combos.append([values[-1] for values in candidates])
        combos.append(
            [values[i % 2] if i % 2 == 0 else values[-1] for i, values in enumerate(candidates)]
        )
        combos.append(
            [values[-1] if i % 2 == 0 else values[0] for i, values in enumerate(candidates)]
        )
        # 5+) 固定种子的随机组合；极值不进随机组合（2**31 塞进循环题会把浏览器跑挂）
        rng = random.Random(seed_of(no))
        mild = [safe_values(values) for values in candidates]
        for _ in range(12):
            combos.append([rng.choice(values) for values in mild])
            if len(combos) >= MAX_CASES:
                break

    seen: set[str] = set()
    cases: list[dict] = []
    for combo in combos:
        call = render(combo)
        if call in seen:
            continue
        seen.add(call)
        cases.append({"call": call, "expected": ""})
        if len(cases) >= MAX_CASES:
            break
    return cases or None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 道（调试用）")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    raw_all = json.loads(SRC.read_text(encoding="utf-8-sig"))
    out: dict[str, list[dict]] = {}
    skipped: dict[str, int] = {}
    processed = 0

    for no, raw in raw_all.items():
        if not isinstance(raw, dict) or raw.get("__error"):
            continue
        meta = raw.get("metaData")
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except json.JSONDecodeError:
                meta = {}
        if not isinstance(meta, dict) or not meta:
            skipped["no-metadata"] = skipped.get("no-metadata", 0) + 1
            continue
        if meta.get("shell") or meta.get("systemdesign"):
            skipped["shell/design"] = skipped.get("shell/design", 0) + 1
            continue
        if meta.get("manual") and _needs_special_nodes(meta):
            # manual = 平台特殊判题：链表题里多半是「带环 / 随机指针 / 交叉链表」，
            # 这类输入本地表达不出来（数组字面量建不出环），整题跳过。
            skipped["manual-node"] = skipped.get("manual-node", 0) + 1
            continue

        cases = build_cases(str(no), meta)
        if not cases:
            reason = "design/no-name"
            if meta.get("name") and meta.get("params"):
                reason = "unknown-type"
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        out[str(no)] = cases
        processed += 1
        if args.limit and processed >= args.limit:
            break

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    case_total = sum(len(v) for v in out.values())
    print(
        json.dumps(
            {
                "problems": len(out),
                "cases": case_total,
                "avg": round(case_total / len(out), 2) if out else 0,
                "skipped": skipped,
                "out": str(out_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
