#!/usr/bin/env python3
"""给 Hot 100 + 精选 365 道题配「参考解」，并用它跑出边界用例的期望输出。

为什么要这一步：边界用例只有「输入」的话，前端只能把结果打出来、没法判对错，
用户写的错解照样显示"运行成功"。有了可信参考解算出的 `expected`，判题才真的判得对。

参考解从哪来：
- Hot 100（data/lc_hot100.json）：调用 DeepSeek 生成（只输出一个 ```python 代码块）；
- 精选 365（app/public/data/tutorials.json 里 sections[].problemNo 对应的章节）：
  按顺序取出章节 markdown 里的 ```python 代码块，用含 `class Solution` 的那一份；
- Hot 100 若 AI 解两次都验不过，再退回教材代码；教材代码验不过就放弃这道题。

怎么算"可信"：在**子进程**里跑官方示例（题面里解析出来的 输入/输出 对），
必须**全部**对上才继续；对不上就丢弃这个参考解。之后才拿它去跑 data/edge_cases.json
里的边界输入，把结果写成 expected。

安全：参考解是模型 / 教材生成的，一律 `python -I -B` 起子进程跑，单例 5 秒超时、
整体 120 秒超时，主进程绝不 exec 它。

输出：
    data/ref_solutions/<题号>.json   { "code": "...", "expected": {"<call>": "<repr>"}, "skipped": [...] }
    data/ref_solutions/_report.json  本次运行的统计 / 失败原因（构建时按文件名过滤，不会被读）

    skipped = 历史字段：现在参考解自己跑不通的边界输入**不再整条丢弃**，而是「保留用例、
    不写期望」（前端当成只运行不判定），免得用户写对解却被判红叉；字段保留是为了兼容构建。

用法：
    python tools/gen_ref_solutions.py --limit 5      # 先试几道
    python tools/gen_ref_solutions.py --scope hot100 # 只做 Hot 100
    python tools/gen_ref_solutions.py --scope easy --limit 400 --workers 5
                                                    # 扩覆盖率：Easy 难度（可断点续跑）
    python tools/gen_ref_solutions.py --scope all-statements
                                                    # 全部有题面 + 有官方示例 + 有方法名的题
    python tools/gen_ref_solutions.py --scope p01    # master.json 里 tier P0/P1 的中等题
    python tools/gen_ref_solutions.py --scope easy --dry-run   # 只看会跑哪些题，不花钱
    python tools/gen_ref_solutions.py                # 全量（可断点续跑）

题源（targets）：
    all / hot100 / curated 仍是「精选题 ∪ Hot 100」的子集（原语义不变）；
    easy / all-statements 在此基础上按 statements_full.json 扩到全量题库，筛选条件是
    「有 translatedContent + 能解析出 ≥1 条官方示例 + 有 metaData.name」——这三条缺一条
    就没法验证参考解，宁可不生成。新扩出来的题没有教材代码，参考解一律走 AI（两次机会）；
    p01 按 data/master.json 的 tier/level 选 P0/P1 的中等题（同一个可解析性筛选）。
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(__file__))
import build_web_data as B  # noqa: E402  复用题面 / 示例解析，保证和构建口径一致

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "ref_solutions"
ENV = ROOT / "app" / ".env.local"
TUTORIALS = ROOT / "app" / "public" / "data" / "tutorials.json"
MASTER = DATA / "master.json"

API = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"
MAX_TOKENS = 4096
API_TIMEOUT = 180

CASE_TIMEOUT = 5          # 单个用例 5 秒
PROBLEM_BUDGET = 120      # 单题整体 120 秒
MAX_REPR = 240            # 和前端 lc_session.py 的 MAX_REPR 一致，超了就只运行不判定
MAX_EXAMPLES = 6          # 验证时最多跑几条官方示例

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
CALL_RE = re.compile(r"^Solution\s*\(\s*\)\s*\.\s*([A-Za-z_]\w*)\s*\(([\s\S]*)\)$")
OPTIONAL_RE = re.compile(r"^Optional\s*\[\s*(.+?)\s*\]$", re.I)
KWARG_RE = re.compile(r"^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$")

# ---------------------------------------------------------------- Python 前导
# 和 app/src/lib/nodes.ts 的 nodePrelude() 保持一致：链表 / 树的构造与还原，
# 这样 `Solution().addTwoNumbers(l1=[2,4,3], ...)` 在本地和前端跑出同一个结果。
PRELUDE = '''
# ---------------------------------------------------------------
# 本地自测用的辅助函数（和前端 nodes.ts 的 nodePrelude 一致）
# ---------------------------------------------------------------
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self) -> str:
        return f'ListNode({self.val})'


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

    def __repr__(self) -> str:
        return f'TreeNode({self.val})'


def _build_list(values):
    if not values:
        return None
    head = ListNode(values[0])
    cur = head
    for value in values[1:]:
        cur.next = ListNode(value)
        cur = cur.next
    return head


def _dump_list(node):
    if node is None:
        return []
    if not hasattr(node, 'next'):
        return node
    values = []
    seen = set()
    while node is not None:
        if id(node) in seen:
            values.append('...')
            return values
        if len(values) >= 10000:
            values.append('...')
            return values
        seen.add(id(node))
        values.append(node.val)
        node = node.next
    return values


def _build_tree(values):
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    queue = [root]
    index = 1
    while queue and index < len(values):
        node = queue.pop(0)
        if index < len(values):
            value = values[index]
            index += 1
            if value is not None:
                node.left = TreeNode(value)
                queue.append(node.left)
        if index < len(values):
            value = values[index]
            index += 1
            if value is not None:
                node.right = TreeNode(value)
                queue.append(node.right)
    return root


def _dump_tree(root):
    if root is None:
        return []
    if not (hasattr(root, 'left') or hasattr(root, 'right')):
        return root
    values = []
    queue = [root]
    while queue:
        if len(values) > 100000:
            values.append('...')
            break
        node = queue.pop(0)
        if node is None:
            values.append(None)
            continue
        values.append(node.val)
        queue.append(node.left)
        queue.append(node.right)
    while values and values[-1] is None:
        values.pop()
    return values


def _dump_list_list(nodes):
    if nodes is None:
        return None
    return [_dump_list(node) for node in nodes]


def _dump_tree_list(nodes):
    if nodes is None:
        return None
    return [_dump_tree(node) for node in nodes]


# ---------------------------------------------- N 叉树 / 四叉树 / 嵌套列表（385/427/429/558/559/589/590）
# 题面里叫 Node 的类有两种：N 叉树（559/589/590/429）和四叉树（427/558），名字撞车，
# 所以内部用 NaryNode / QuadNode 区分；最后把 Node 指给四叉树那个 —— 只有四叉树的解
# 需要自己 new 节点，N 叉树的解只读 root.children。
class NaryNode:
    """LeetCode 的 N 叉树节点（平台自带，这里只是本地自测用）。"""

    def __init__(self, val=None, children=None):
        self.val = val
        self.children = children if children is not None else []

    def __repr__(self) -> str:
        return f'Node({self.val})'


def _build_nary_tree(values):
    """LeetCode N 叉树层序数组 -> 树：每组子节点前面有一个 None 当分隔符。

    [1, None, 3, 2, 4, None, 5, 6] -> 1 的孩子是 [3, 2, 4]，3 的孩子是 [5, 6]。
    """
    if not values or values[0] is None:
        return None
    root = NaryNode(values[0])
    queue = [root]
    index = 1
    while queue and index < len(values):
        node = queue.pop(0)
        if index < len(values) and values[index] is None:
            index += 1  # 跳过「本组子节点到此结束」的分隔符
        while index < len(values) and values[index] is not None:
            child = NaryNode(values[index])
            node.children.append(child)
            queue.append(child)
            index += 1
    return root


def _dump_nary_tree(root):
    """N 叉树 -> LeetCode 层序数组（和 _build_nary_tree 互逆，尾部多余的 None 裁掉）。

    LeetCode 的序列化是「按 BFS 每个节点先写一个 null、再写它的 children 值」，
    所以没有子节点的节点也会留一个 null；尾部的 null 全部裁掉。
    """
    if root is None:
        return []
    if not hasattr(root, 'children'):
        return root
    values = [root.val]
    queue = [root]
    while queue:
        if len(values) > 100000:
            values.append('...')
            break
        node = queue.pop(0)
        values.append(None)  # 本组子节点的分隔符（没有子节点时就是一个占位 null）
        for child in node.children or []:
            values.append(child.val)
            queue.append(child)
    while values and values[-1] is None:
        values.pop()
    return values


class QuadNode:
    """LeetCode 的四叉树节点（平台自带，这里只是本地自测用）。"""

    def __init__(self, val=0, isLeaf=False, topLeft=None, topRight=None,
                 bottomLeft=None, bottomRight=None):
        self.val = val
        self.isLeaf = isLeaf
        self.topLeft = topLeft
        self.topRight = topRight
        self.bottomLeft = bottomLeft
        self.bottomRight = bottomRight

    def __repr__(self) -> str:
        return f'Node({self.val}, {self.isLeaf})'


# 427 / 558 的解要自己 new 节点（Node(val, isLeaf, tl, tr, bl, br)），所以公开名给四叉树
Node = QuadNode


def _build_quad(values):
    """LeetCode 四叉树层序数组 -> 树。

    数组里每个节点是 [isLeaf, val]；按 BFS 每个节点占 4 个槽位（tl, tr, bl, br），
    叶子节点的 4 个槽位是 None（尾部的 None 会被裁掉）。
    """
    if not values or values[0] is None:
        return None

    def make(item):
        return QuadNode(1 if item[1] else 0, bool(item[0]))

    root = make(values[0])
    queue = [root]
    index = 1
    while queue and index < len(values):
        node = queue.pop(0)
        slots = []
        for _ in range(4):
            item = values[index] if index < len(values) else None
            index += 1
            if item is None:
                slots.append(None)
            else:
                child = make(item)
                slots.append(child)
                queue.append(child)
        if not node.isLeaf:
            node.topLeft, node.topRight, node.bottomLeft, node.bottomRight = slots
    return root


def _quad_entry(node):
    """一个四叉树节点 -> 题面里的 [isLeaf, val]。

    题面明说「isLeaf 为 False 时 val 给 True / False 都会被判题机制接受」，所以非叶子
    节点的 val 一律按 0 输出（规范形式）—— 期望值和用户代码跑出来的形状用同一套规范，
    才不会因为内部节点 val 取值不同被误判。
    """
    leaf = 1 if node.isLeaf else 0
    if not leaf:
        return [0, 0]
    return [1, 1 if node.val else 0]


def _dump_quad(root):
    """四叉树 -> LeetCode 层序数组（和 _build_quad 互逆；尾部 None 裁掉）。"""
    if root is None:
        return []
    if not hasattr(root, 'isLeaf'):
        return root
    values = [_quad_entry(root)]
    queue = [root]
    while queue:
        if len(values) > 100000:
            values.append('...')
            break
        node = queue.pop(0)
        if node.isLeaf:
            children = [None, None, None, None]
        else:
            children = [node.topLeft, node.topRight, node.bottomLeft, node.bottomRight]
        for child in children:
            if child is None:
                values.append(None)
            else:
                values.append(_quad_entry(child))
                queue.append(child)
    while values and values[-1] is None:
        values.pop()
    return values


class NestedInteger:
    """LeetCode 385 的 NestedInteger 最小实现（平台自带，这里只是本地自测用）。"""

    def __init__(self, value=None):
        if isinstance(value, list):
            self._list = list(value)
            self._integer = None
        elif value is None:
            self._list = []
            self._integer = None
        else:
            self._list = None
            self._integer = value

    def isInteger(self) -> bool:
        return self._integer is not None

    def getInteger(self):
        return self._integer

    def getList(self):
        if self._list is None:
            self._list = []
        return self._list

    def add(self, elem) -> None:
        if self._list is None:
            self._list = []
        self._list.append(elem)

    def __repr__(self) -> str:
        if self.isInteger():
            return f'NestedInteger({self._integer!r})'
        return f'NestedInteger({self._list!r})'


def _dump_nested(value):
    """NestedInteger -> 题面里的形式：整数就是整数，列表就是 [123, [456, [789]]]。"""
    if value is None:
        return None
    if not hasattr(value, 'isInteger'):
        return value
    if value.isInteger():
        return value.getInteger()
    return [_dump_nested(item) for item in (value.getList() or [])]


def _build_nested(values):
    """嵌套整数数组 -> NestedInteger（题面里的 List<NestedInteger> 形参用）。"""

    def make(item):
        if isinstance(item, list):
            node = NestedInteger()
            for piece in item:
                node.add(make(piece))
            return node
        return NestedInteger(item)

    if values is None:
        return None
    return make(values)
'''

# ---------------------------------------------------------------- 子进程执行器
# 单独一个文件：主进程只负责拼 job、起进程、收 JSON，绝不 exec 参考解。
RUNNER_SRC = '''
import contextlib
import io
import json
import sys


def main():
    with open(sys.argv[1], encoding='utf-8') as fh:
        job = json.load(fh)
    result = {'ok': False, 'repr': '', 'error': '', 'stdout': ''}
    buf = io.StringIO()
    ns = {'__name__': '__lc__'}
    try:
        exec(compile(job.get('prelude') or '', '<prelude>', 'exec'), ns)
        exec(compile(job.get('code') or '', '<solution>', 'exec'), ns)
    except BaseException as exc:
        result['error'] = '%s: %s' % (type(exc).__name__, exc)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        return

    value = None
    try:
        with contextlib.redirect_stdout(buf):
            value = eval(compile(job.get('call') or '', '<case>', 'eval'), ns)
    except BaseException as exc:
        result['error'] = '%s: %s' % (type(exc).__name__, exc)

    param = job.get('dump_param') or ''
    if not result['error'] and param:
        value = ns.get(param)
        kind = job.get('dump_kind') or ''
        if kind == 'list':
            value = ns['_dump_list'](value)
        elif kind == 'tree':
            value = ns['_dump_tree'](value)
        elif kind == 'nary':
            value = ns['_dump_nary_tree'](value)
        elif kind == 'quad':
            value = ns['_dump_quad'](value)
        elif kind == 'nested':
            value = ns['_dump_nested'](value)

    if not result['error']:
        try:
            result['repr'] = repr(value)[:6000]
            result['ok'] = True
        except BaseException as exc:
            result['error'] = 'repr 失败: %s' % exc
    result['stdout'] = buf.getvalue()[:2000]
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


main()
'''

_TMP = Path(tempfile.mkdtemp(prefix="lc-ref-"))
_RUNNER = _TMP / "_runner.py"
_RUNNER.write_text(RUNNER_SRC, encoding="utf-8")
_seq_lock = threading.Lock()
_seq = [0]


def _job_path() -> Path:
    with _seq_lock:
        _seq[0] += 1
        return _TMP / f"job-{_seq[0]}-{threading.get_ident()}.json"


def run_case(code: str, call: str, dump_param: str = "", dump_kind: str = "") -> dict:
    """在独立子进程里跑一条调用；超时 / 报错都当成「这条用例不可用」。"""
    path = _job_path()
    path.write_text(
        json.dumps(
            {
                "code": code,
                "prelude": PRELUDE,
                "call": call,
                "dump_param": dump_param,
                "dump_kind": dump_kind,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-B", str(_RUNNER), str(path)],
            capture_output=True,
            timeout=CASE_TIMEOUT,
            cwd=str(_TMP),
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "repr": "", "error": "Timeout", "stdout": "", "timeout": True}
    finally:
        path.unlink(missing_ok=True)

    text = proc.stdout.decode("utf-8", "replace").strip()
    if not text:
        err = proc.stderr.decode("utf-8", "replace").strip()[:300]
        return {"ok": False, "repr": "", "error": err or f"exit {proc.returncode}", "stdout": ""}
    try:
        data = json.loads(text.splitlines()[-1])
    except json.JSONDecodeError:
        return {"ok": False, "repr": "", "error": "输出无法解析", "stdout": ""}
    data["timeout"] = False
    return data


# ---------------------------------------------------------------- 输出比对
# 和前端 utils.normalizeOutput 同一套归一化，再补一层「按字面量比」，
# 这样 2.00000 和 2.0、true 和 True 都能算对。
def norm_output(value: str) -> str:
    text = re.sub(r"\s+", "", value or "")
    text = re.sub(r"[\"'`]", "", text)
    text = text.replace("True", "true").replace("False", "false").replace("None", "null")
    return text.lower()


_MISS = object()


def parse_literal(text: str):
    raw = (text or "").strip()
    if not raw:
        return _MISS
    raw = re.sub(r"\bnull\b", "None", raw)
    raw = re.sub(r"\btrue\b", "True", raw)
    raw = re.sub(r"\bfalse\b", "False", raw)
    try:
        return ast.literal_eval(raw)
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return _MISS


def deep_equal(left, right, depth: int = 0) -> bool:
    if depth > 12:
        return False
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        if left == right:
            return True
        span = max(1.0, abs(float(left)), abs(float(right)))
        return abs(float(left) - float(right)) <= 1e-5 * span
    if isinstance(left, str) and isinstance(right, str):
        return left.strip() == right.strip()
    if isinstance(left, (list, tuple)) and isinstance(right, (list, tuple)):
        if len(left) != len(right):
            return False
        return all(deep_equal(a, b, depth + 1) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        if set(left) != set(right):
            return False
        return all(deep_equal(left[k], right[k], depth + 1) for k in left)
    return left == right


def outputs_match(expected: str, actual: str) -> bool:
    if not expected.strip():
        return True
    if norm_output(expected) == norm_output(actual):
        return True
    left = parse_literal(expected)
    right = parse_literal(actual)
    if left is not _MISS and right is not _MISS and deep_equal(left, right):
        return True
    # 原地修改题（26 这种）的题面输出写成 `2, nums = [1,2,_]`：只比前面那个返回值
    head = leading_literal(expected)
    if head is not _MISS and right is not _MISS:
        return deep_equal(head, right)
    return False


HEAD_NUMBER_RE = re.compile(r"^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")


def leading_literal(text: str):
    """题面输出里常带注释：`1` / `[[3,3],[-2,4]] （答案 [[-2,4],[3,3]] 也会被接受。）`。

    从头开始读一个完整的字面量（配平括号 / 引号），读不到返回 _MISS。
    """
    raw = (text or "").strip()
    if not raw:
        return _MISS
    head = raw[0]
    if head in "[{(":
        depth = 0
        quote = ""
        i = 0
        while i < len(raw):
            ch = raw[i]
            if quote:
                if ch == "\\":
                    i += 2
                    continue
                if ch == quote:
                    quote = ""
            elif ch in "\"'":
                quote = ch
            elif ch in "[{(":
                depth += 1
            elif ch in "]})":
                depth -= 1
                if depth == 0:
                    return parse_literal(raw[: i + 1])
            i += 1
        return _MISS
    if head in "\"'":
        quote = head
        i = 1
        while i < len(raw):
            if raw[i] == "\\":
                i += 2
                continue
            if raw[i] == quote:
                return parse_literal(raw[: i + 1])
            i += 1
        return _MISS
    m = HEAD_NUMBER_RE.match(raw)
    if m:
        return parse_literal(m.group(0))
    for word in ("true", "false", "null", "True", "False", "None"):
        if raw.startswith(word):
            return parse_literal(word)
    return _MISS


# ---------------------------------------------------------------- 题面 / 示例
BLOCK_RE = re.compile(r'<div class="example-block">([\s\S]*?)</div>')

# 题库里的示例输入偶尔混进全角标点 / 结尾句号（`n=3，ops=[[2,2]]`、`nums2=[1,3,4,2].`），
# 直接拼成 Python 调用会 SyntaxError，参考解就永远验不过。这里只清洗 callArgs（展示文本不动）。
FULLWIDTH = str.maketrans(
    {
        "，": ",", "（": "(", "）": ")", "：": ":", "；": ";", "。": ".",
        "【": "[", "】": "]", "“": '"', "”": '"', "‘": "'", "’": "'",
        "　": " ", "、": ",",
    }
)
TAIL_PUNCT_RE = re.compile(r"[.。,，、;；:：\s]+$")


def clean_call_args(text: str) -> str:
    """把示例实参文本修成能 eval 的 Python 实参。"""
    raw = (text or "").translate(FULLWIDTH).strip()
    if not raw:
        return ""
    # 结尾的句号 / 顿号：`nums2=[1, 3, 4, 2].` -> `nums2=[1, 3, 4, 2]`
    return TAIL_PUNCT_RE.sub("", raw).strip()


def norm_type(raw: str) -> str:
    text = re.sub(r"\s+", "", raw or "")
    for _ in range(3):
        m = OPTIONAL_RE.match(text)
        if not m:
            break
        text = m.group(1)
    return text


# ---------------------------------------------------------------- 节点类型补全
# 题面 metaData 里的类型名对这几类题是丢过的：559/589/590/429 的 `root` 写成 `integer`，
# 558 的 `quadTree1/2` 写成 `integer[][]`（实际是四叉树 Node），427 的返回值写成
# `list<list<integer>>`（实际是 Node）。光看类型名没法知道要构造 / 还原成节点。
#
# 这里**按题号**把真实类型钉死，理由：
# - 不按方法名猜：`preorder` / `postorder` 在 144/145 上是二叉树，在 589/590 上是 N 叉树；
# - 不按 starterCode 自动推：427 的 `grid` 是货真价实的 integer[][]，只有**返回值**是 Node，
#   558 反过来是形参 Node、返回值也是 Node —— 自动推一定会误伤；
# - 只影响列出来的题号，别的题的 wrap/dump 行为一个字都没变（回归优先）。
#
# 内部类型名（NaryNode / QuadNode）不会出现在题库数据里，所以 wrap_value / dump_kind_of
# 里对它们的支持等价于「只对这几道题生效」。题面公开名见 PUBLIC_TYPE。
NODE_TYPE_OVERRIDES: dict[str, tuple[dict[str, str], str]] = {
    # 题号: ({形参名: 内部类型}, 返回值的内部类型 / "" 表示不改)
    "559": ({"root": "NaryNode"}, ""),          # N 叉树的最大深度
    "589": ({"root": "NaryNode"}, ""),          # N 叉树的前序遍历
    "590": ({"root": "NaryNode"}, ""),          # N 叉树的后序遍历
    "429": ({"root": "NaryNode"}, ""),          # N 叉树的层序遍历
    "385": ({}, "NestedInteger"),               # 迷你语法分析器
    "558": ({"quadTree1": "QuadNode", "quadTree2": "QuadNode"}, "QuadNode"),  # 四叉树交集
    "427": ({}, "QuadNode"),                    # 建立四叉树（顺带覆盖：返回值是 Node）
}

# 内部类型名 -> 题面里给模型看的名字
PUBLIC_TYPE = {"NaryNode": "Node", "QuadNode": "Node", "NestedInteger": "NestedInteger"}

# 内部类型名 -> 提示模型「这个类已经提供了，直接用形参」
NODE_CLASS_HINT = {
    "NaryNode": (
        "Node(val, children)（N 叉树节点，children 是子节点列表）已提供，直接用形参；"
        "输入数组是 LeetCode 层序格式，每组子节点前面有一个 null 分隔。"
    ),
    "QuadNode": (
        "Node(val, isLeaf, topLeft, topRight, bottomLeft, bottomRight)（四叉树节点）已提供，"
        "直接用形参；需要新建节点时就用这个类。"
    ),
    "NestedInteger": (
        "NestedInteger 已提供（isInteger() / getInteger() / getList() / add()），"
        "不要自己再定义它。"
    ),
}


def resolve_meta(no: str, meta: dict) -> tuple[dict, dict]:
    """补回 metaData 丢掉的节点类型；返回 (call_meta, prompt_meta)。

    - call_meta：类型名换成内部名（NaryNode / QuadNode / NestedInteger），
      交给 wrap_value / dump_kind_of 决定要不要 _build_* / _dump_*；
    - prompt_meta：类型名换成题面里的公开名（Node / NestedInteger），只用来拼提示词。

    没有配置的题原样返回（同一个 dict 对象），行为完全不变。
    """
    override = NODE_TYPE_OVERRIDES.get(no)
    if not override:
        return meta, meta
    param_map, ret_type = override
    params = [dict(item) for item in (meta.get("params") or [])]
    for item in params:
        name = str(item.get("name") or "")
        if name in param_map:
            item["type"] = param_map[name]
    ret = dict(meta.get("return") or {})
    if ret_type:
        ret["type"] = ret_type
    call_meta = {**meta, "params": params, "return": ret}

    public_params = [
        {**item, "type": PUBLIC_TYPE.get(str(item.get("type") or ""), item.get("type"))}
        for item in params
    ]
    public_ret = {**ret, "type": PUBLIC_TYPE.get(str(ret.get("type") or ""), ret.get("type"))}
    return call_meta, {**meta, "params": public_params, "return": public_ret}


def node_class_hint(call_meta: dict) -> str:
    """call_meta 里出现了哪些节点类，拼成给模型看的一句提示（没有就返回空串）。"""
    kinds: list[str] = []
    for item in call_meta.get("params") or []:
        kinds.append(norm_type(str(item.get("type") or "")))
    kinds.append(norm_type(str((call_meta.get("return") or {}).get("type") or "")))
    present = [kind for kind in ("NaryNode", "QuadNode", "NestedInteger") if kind in kinds]
    if not present:
        return ""
    return "\n".join(f"- {NODE_CLASS_HINT[kind]}" for kind in present)


def html_to_text(html: str) -> str:
    if not html:
        return ""
    text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|li|pre|h[1-6]|tr)>", "\n", text, flags=re.I)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.I)
    text = re.sub(r"<sup>(.*?)</sup>", r"^\1", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    for src, dst in [
        ("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'),
        ("&#39;", "'"), ("&amp;", "&"),
    ]:
        text = text.replace(src, dst)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def pre_examples_clean(html: str) -> list[dict]:
    """老格式 <pre> 的示例，但取文本时**不插分隔符**。

    为什么要自己再解析一遍：build_web_data.extract_pre_examples 用 `pre.get_text("\\n")`，
    题面里的行内加粗（`"le<strong>e</strong>etcode"`、`["<em><strong>at</strong></em>tention"]`）
    会被拆成 `"le e etcode"` / `" at tention"`，拼出来的调用语义就变了（示例永远验不过）。
    这里用 `get_text("")` 拿到原样的字符串，正则和 parse_input_args 仍复用 build_web_data，
    保证和构建口径一致。
    """
    if not html or "<pre" not in html:
        return []
    soup = B.BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for pre in soup.find_all("pre"):
        text = pre.get_text("").replace("\xa0", " ")
        text = re.sub(r"[ \t]+\n", "\n", text).strip()
        m = re.search(
            r"输入\s*[：:]\s*(.*?)\s*输出\s*[：:]\s*(.*?)(?:\s*解释\s*[：:]\s*(.*))?$",
            text,
            re.S,
        )
        if not m:
            continue
        raw_in = re.sub(r"\s*\n\s*", " ", m.group(1)).strip()
        raw_out = re.sub(r"\s*\n\s*", " ", m.group(2)).strip()
        if not raw_in or not raw_out:
            continue
        call_args, params = B.parse_input_args(raw_in)
        out.append(
            {
                "input": raw_in,
                "output": raw_out,
                "explain": (m.group(3) or "").strip(),
                "callArgs": call_args,
                "params": params,
            }
        )
    return out


def extract_examples(html: str) -> list[dict]:
    """官方示例：老的 `<pre>` 格式走 build_web_data，新的 example-block 格式这里补一份。"""
    examples = []
    if not html:
        return examples
    # <pre> 优先用不带分隔符的干净版；解析不出东西时退回 build_web_data 的结果
    for ex in pre_examples_clean(html) or B.extract_examples(html):
        if ex.get("callArgs") and ex.get("output"):
            examples.append(ex)
    for block in BLOCK_RE.findall(html):
        text = re.sub(r"<[^>]+>", "", block)
        for src, dst in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"),
                         ("&quot;", '"'), ("&#39;", "'"), ("&amp;", "&")]:
            text = text.replace(src, dst)
        text = re.sub(r"[ \t]+", " ", text).strip()
        m = re.search(
            r"输入\s*[：:]\s*([\s\S]*?)\s*输出\s*[：:]\s*([\s\S]*?)(?:\s*解释\s*[：:]\s*([\s\S]*))?$",
            text,
        )
        if not m:
            continue
        raw_in = re.sub(r"\s*\n\s*", " ", m.group(1)).strip()
        raw_out = re.sub(r"\s*\n\s*", " ", m.group(2)).strip()
        if not raw_in or not raw_out:
            continue
        call_args, params = B.parse_input_args(raw_in)
        examples.append(
            {
                "input": raw_in,
                "output": raw_out,
                "explain": (m.group(3) or "").strip(),
                "callArgs": call_args,
                "params": params,
            }
        )
    # 清洗实参：全角标点 / 结尾句号会让拼出来的调用直接 SyntaxError
    cleaned: list[dict] = []
    for ex in examples:
        args = clean_call_args(ex.get("callArgs") or "")
        if not args:
            continue
        if args != ex.get("callArgs"):
            ex = {**ex, "callArgs": args}
        cleaned.append(ex)
    examples = cleaned
    # 去重：同一个输入只留一条
    seen, unique = set(), []
    for ex in examples:
        key = ex["callArgs"]
        if key in seen:
            continue
        seen.add(key)
        unique.append(ex)
    return unique


def meta_of(raw: dict) -> dict:
    """statements_full.json 里的 metaData 有时是 JSON 字符串，统一成 dict。"""
    meta = (raw or {}).get("metaData")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {}
    return meta if isinstance(meta, dict) else {}


def statement_targets(full: dict) -> dict[str, str]:
    """全量题库里「可以生成参考解」的题：{题号: 难度}。

    条件（和任务口径一致）：
    1. 有 translatedContent（题面存在）；
    2. 能解析出至少 1 条官方示例（没有示例就没法验证解，不能算可信）；
    3. metaData.name 存在（设计题只有类名、没有方法名，跳过）；
    4. metaData.params 非空且 return.type 存在 —— SQL 题（combine_two_tables 这种）
       和 rand7 这类依赖外部函数的题没有形参，拼不出 `Solution().method(...)` 调用，
       也没有任何边界用例，跑了也拿不到期望，直接排除。
    """
    out: dict[str, str] = {}
    for no, raw in full.items():
        if not isinstance(raw, dict):
            continue
        html = raw.get("translatedContent") or ""
        if not html:
            continue
        meta = meta_of(raw)
        if not str(meta.get("name") or "").strip():
            continue
        if not (meta.get("params") or []):
            continue
        if not str((meta.get("return") or {}).get("type") or "").strip():
            continue
        if not extract_examples(html):
            continue
        out[str(no)] = str(raw.get("difficulty") or "")
    return out


def master_p01_medium() -> set[str]:
    """data/master.json 里 tier 为 P0/P1 且 level 为「中等」的题号（用户最可能卡住的题）。"""
    if not MASTER.exists():
        return set()
    try:
        items = json.loads(MASTER.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError):
        return set()
    return {
        str(item.get("no") or "").strip()
        for item in items
        if str(item.get("tier") or "").strip() in ("P0", "P1")
        and str(item.get("level") or "").strip() == "中等"
        and str(item.get("no") or "").strip()
    }


def wrap_value(value: str, type_name: str) -> str:
    """节点类型：把数组字面量包成 _build_list / _build_tree（和前端 wrapNodeCall 一致）。"""
    text = value.strip()
    if not text.startswith("["):
        return value
    kind = norm_type(type_name)
    if kind == "ListNode":
        return f"_build_list({text})"
    if kind == "TreeNode":
        return f"_build_tree({text})"
    # N 叉树 / 四叉树 / 嵌套列表：只在 NODE_TYPE_OVERRIDES 列出的题上出现
    if kind == "NaryNode":
        return f"_build_nary_tree({text})"
    if kind == "QuadNode":
        return f"_build_quad({text})"
    if kind in ("ListNode[]", "list<ListNode>"):
        return _wrap_elements(text, "_build_list")
    if kind in ("TreeNode[]", "list<TreeNode>"):
        return _wrap_elements(text, "_build_tree")
    return value


def _wrap_elements(text: str, builder: str) -> str:
    if not text.startswith("["):
        return text
    body = text[1:-1].strip() if text.endswith("]") else text[1:]
    if not body:
        return text
    parts = []
    for piece in B.split_top_level(body):
        item = piece.strip()
        if not item or item == "None" or item.lower() == "null":
            parts.append(item or "None")
        elif item.startswith("["):
            parts.append(f"{builder}({item})")
        else:
            parts.append(item)
    return "[" + ", ".join(parts) + "]"


def dump_kind_of(type_name: str) -> str:
    kind = norm_type(type_name)
    if kind == "ListNode":
        return "list"
    if kind == "TreeNode":
        return "tree"
    # 返回「节点数组」的题（725 分隔链表、95 生成所有二叉搜索树）：逐个节点 dump，
    # 否则 repr 出来是 `<TreeNode object at 0x…>`，示例永远比对不上
    if kind in ("ListNode[]", "list<ListNode>"):
        return "list_list"
    if kind in ("TreeNode[]", "list<TreeNode>"):
        return "tree_list"
    # N 叉树 / 四叉树 / 嵌套列表：只在 NODE_TYPE_OVERRIDES 列出的题上出现
    if kind == "NaryNode":
        return "nary"
    if kind == "QuadNode":
        return "quad"
    if kind == "NestedInteger":
        return "nested"
    return ""


def _split_call(call: str) -> tuple[str, list[str]] | None:
    """`Solution().m(a=1, b=2)` → ('m', ['a=1', 'b=2'])。"""
    m = CALL_RE.match((call or "").strip())
    if not m:
        return None
    inner = m.group(2).strip()
    pieces = [p.strip() for p in B.split_top_level(inner) if p.strip()] if inner else []
    return m.group(1), pieces


def split_call_args(call_args: str, expected_count: int) -> list[str]:
    """切示例实参；题库里有 `s1="ab" s2 = "eidbaooo"` 这种空格分隔的脏数据，再切一刀。"""
    pieces = [piece.strip() for piece in B.split_top_level(call_args or "") if piece.strip()]
    if expected_count > 1 and len(pieces) < expected_count:
        loose: list[str] = []
        for piece in pieces:
            parts = re.split(r"\s+(?=[A-Za-z_]\w*\s*=)", piece)
            loose.extend(part.strip() for part in parts if part.strip())
        if len(loose) == expected_count:
            pieces = loose
    return pieces


BRACKET_PAIRS = {"[": "]", "(": ")", "{": "}"}


def _balance_brackets(text: str) -> str:
    """题面示例被截断时补上缺失的右括号：`grid=[[4,3,8,4],[9,5,1,9],[2,7,6,2]`。"""
    stack: list[str] = []
    quote = ""
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
        elif ch in BRACKET_PAIRS:
            stack.append(BRACKET_PAIRS[ch])
        elif ch in ")]}":
            if stack and stack[-1] == ch:
                stack.pop()
            else:
                return text  # 括号本身是乱的，别硬修
        i += 1
    return text + "".join(reversed(stack))


def repair_call_args(text: str) -> str:
    """修题面示例里的脏数据（只在原样编译不过时才会被用到，见 call_from_args）。"""
    raw = clean_call_args(text)
    # 形参名后面的中文注释：`poured(倾倒香槟总杯数) = 1`
    raw = re.sub(r"\b([A-Za-z_]\w*)\s*\([^()]*\)(\s*=)", r"\1\2", raw)
    # 数值后面的注释：`num=1775(110111011112)`、`A=29 (或者 0b11101)`
    raw = re.sub(r"(?<=[\d\"'\]])\s*\([^()]*\)", "", raw)
    return _balance_brackets(raw)


def _compiles(expr: str) -> bool:
    try:
        compile(expr, "<call>", "eval")
    except (SyntaxError, ValueError):
        return False
    return True


def _render_call(meta: dict, call_args: str) -> str | None:
    method = str(meta.get("name") or "").strip()
    if not IDENT.match(method):
        return None
    params = meta.get("params") or []
    names = [str(p.get("name") or "") for p in params]
    types = {str(p.get("name") or ""): str(p.get("type") or "") for p in params}
    pieces = split_call_args(call_args, len(names))
    if not pieces:
        return None

    rendered: list[str] = []
    for index, piece in enumerate(pieces):
        m = KWARG_RE.match(piece)
        if m and m.group(1) in types:
            rendered.append(f"{m.group(1)}={m.group(2).strip()}")
            continue
        # 位置实参（或名字对不上的关键字实参）：按形参顺序落位
        if index >= len(names) or not names[index]:
            return None
        rendered.append(f"{names[index]}={m.group(2).strip() if m else piece}")
    return f"Solution().{method}({', '.join(rendered)})"


def call_from_args(meta: dict, call_args: str) -> str | None:
    """把示例的实参文本拼成 `Solution().method(...)`（形参名按 metaData 对齐）。

    题库里有少量脏示例（中文注释、截断的括号），原样拼出来编译不过；这时试一次
    `repair_call_args`，修好了才用。修不好就返回原样，让 validate 判「示例失败」并拒绝
    这道题 —— 宁可不生成，也不能拿没验过的解去写期望。
    """
    call = _render_call(meta, call_args)
    if call is None or _compiles(call):
        return call
    repaired = repair_call_args(call_args)
    if repaired != clean_call_args(call_args):
        alt = _render_call(meta, repaired)
        if alt is not None and _compiles(alt):
            return alt
    return call


def prepare_call(meta: dict, call: str) -> tuple[str, bool]:
    """把一条调用整理成「能直接 eval 且结果可比」的表达式。

    返回 (表达式, 是否可比)：
    - 节点形参：数组字面量包成 _build_list / _build_tree（和前端 wrapNodeCall 一致）；
    - 节点返回值：外面包 _dump_list / _dump_tree；
    - void + output.paramindex（原地修改题）：用 lambda 把「改完之后的那个形参」取出来，
      这时返回值是 None、不可比 → 第二项给 False（前端只能比返回值，期望要留空）。
    """
    call = clean_call_args(call)
    split = _split_call(call)
    if not split:
        return call, True
    method, pieces = split
    params = meta.get("params") or []
    names = [str(p.get("name") or "") for p in params]
    types = {str(p.get("name") or ""): str(p.get("type") or "") for p in params}

    args: list[tuple[str, str]] = []
    for index, piece in enumerate(pieces):
        m = KWARG_RE.match(piece)
        if m and m.group(1) in types:
            name, value = m.group(1), m.group(2).strip()
        elif index < len(names) and names[index]:
            name, value = names[index], (m.group(2).strip() if m else piece)
        else:
            args.append(("", piece))
            continue
        args.append((name, wrap_value(value, types.get(name, ""))))

    def render(items: list[tuple[str, str]]) -> str:
        body = ", ".join(f"{name}={value}" if name else value for name, value in items)
        return f"Solution().{method}({body})"

    ret = norm_type(str((meta.get("return") or {}).get("type") or ""))
    kind = dump_kind_of(ret)
    if kind:
        return f"_dump_{kind}({render(args)})", True

    output = meta.get("output") or {}
    param_index = output.get("paramindex") if isinstance(output, dict) else None
    if (
        ret == "void"
        and isinstance(param_index, int)
        and 0 <= param_index < len(args)
    ):
        target_name, target_value = args[param_index]
        placeholder = [
            (name, "_p" if i == param_index else value) for i, (name, value) in enumerate(args)
        ]
        expr = f"(lambda _p: ({render(placeholder)}, _p)[1])({target_value})"
        target_kind = dump_kind_of(types.get(target_name, ""))
        if target_kind:
            expr = f"_dump_{target_kind}({expr})"
        return expr, False

    return render(args), True


# ---------------------------------------------------------------- DeepSeek
SYSTEM = (
    "你是算法竞赛选手，只写正确、能直接运行的 Python 解法。"
    "严格遵守题目给定的类名和方法签名，不要输出任何解释、注释之外的多余文字。"
)


def api_key() -> str:
    text = ENV.read_text(encoding="utf-8-sig")
    m = re.search(r"DEEPSEEK_API_KEY\s*=\s*(\S+)", text)
    if not m:
        raise SystemExit("app/.env.local 里没有 DEEPSEEK_API_KEY")
    return m.group(1)


def build_prompt(no: str, meta: dict, raw: dict, examples: list[dict], node_hint: str = "") -> str:
    html = raw.get("translatedContent") or raw.get("content") or ""
    statement = html_to_text(html)
    if len(statement) > 7000:
        statement = statement[:7000] + "\n…（题面过长，后面省略）"
    params = ", ".join(
        f"{p.get('name')}: {p.get('type')}" for p in (meta.get("params") or [])
    )
    ret = (meta.get("return") or {}).get("type", "?")
    example_text = "\n".join(
        f"输入：{ex['callArgs']}　输出：{ex['output']}" for ex in examples[:4]
    ) or "（题面未提供示例）"
    hint_block = f"\n## 节点类（本地已提供）\n{node_hint}\n" if node_hint else ""
    return f"""题号：{no}　标题：{raw.get('translatedTitle') or raw.get('title') or ''}
函数签名：class Solution: def {meta.get('name')}(self, {params}) -> {ret}

## 题面
{statement}
{hint_block}
## 官方示例
{example_text}

## 要求
1. 写一个**完全正确**的 Python3 解法，类名必须是 `Solution`，方法名必须是 `{meta.get('name')}`，形参名保持上面的名字。
2. 只输出一个 ```python 代码块，代码块里是完整可运行的文件内容；不要任何解释文字。
3. 不要写 if __name__ == '__main__'，不要写测试代码，不要读输入。
4. 如果输入是链表 / 树 / N 叉树 / 四叉树 / NestedInteger，按 LeetCode 约定直接用形参（ListNode / TreeNode / Node / NestedInteger 已提供），不要自己定义它们。
5. 注意边界情况：空输入、单元素、全部相同、负数、极值。
"""


def call_api(key: str, prompt: str, retries: int = 3) -> str:
    payload = json.dumps(
        {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "temperature": 0.1,
            "max_tokens": MAX_TOKENS,
        }
    ).encode()
    last = ""
    for attempt in range(retries):
        req = urllib.request.Request(
            API,
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=API_TIMEOUT) as res:
                data = json.loads(res.read().decode())
            return data["choices"][0]["message"]["content"].strip()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()[:200]
            last = f"HTTP {exc.code}: {body}"
            if exc.code in (429, 500, 502, 503, 504):
                time.sleep(3 * (attempt + 1))
                continue
            break
        except Exception as exc:  # noqa: BLE001
            last = str(exc)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(last or "API 失败")


CODE_BLOCK_RE = re.compile(r"```(?:python3?|py)?[ \t]*\n([\s\S]*?)```")
# 模型偶尔在长解法上把回复顶到 max_tokens，闭合围栏被截掉：这时退化成「取到文末」
OPEN_BLOCK_RE = re.compile(r"```(?:python3?|py)?[ \t]*\n([\s\S]*)$")


def extract_code(text: str) -> str | None:
    blocks = [block for block in CODE_BLOCK_RE.findall(text or "") if "class Solution" in block]
    if not blocks:
        # 没有闭合围栏（被截断）：取最后一个开围栏到文末，只要里面还有 class Solution
        tail = [block for block in OPEN_BLOCK_RE.findall(text or "") if "class Solution" in block]
        if not tail:
            return None
        blocks = tail
    # 取最长的那块：模型有时会先给个片段再给完整版
    return max(blocks, key=len).strip()


def gen_solution(
    key: str, no: str, meta: dict, raw: dict, examples: list[dict], node_hint: str = ""
) -> str | None:
    prompt = build_prompt(no, meta, raw, examples, node_hint)
    text = call_api(key, prompt)
    return extract_code(text)


# ---------------------------------------------------------------- 教材代码
def tutorial_solutions(no: str, markdowns: list[str]) -> list[str]:
    """按顺序收集章节里的 python 代码块，含 class Solution 的优先。"""
    blocks: list[str] = []
    for md in markdowns:
        for block in CODE_BLOCK_RE.findall(md or ""):
            if block.strip():
                blocks.append(block.strip())
    candidates: list[str] = []
    for block in blocks:
        if "class Solution" in block:
            candidates.append(block)
    if len(blocks) > 1:
        # 兜底：有的教材把 class Solution 和辅助定义拆在两个块里
        candidates.append("\n\n".join(blocks))
    seen, unique = set(), []
    for code in candidates:
        if code in seen:
            continue
        seen.add(code)
        unique.append(code)
    return unique


# ---------------------------------------------------------------- 单题处理
def _literal_or_head(text: str):
    value = parse_literal(text)
    return value if value is not _MISS else leading_literal(text)


def unordered_equal(left: str, right: str) -> bool:
    """「任意顺序都算对」的题（77/241/451/973…）：把嵌套列表 / 字符串排成规范形式再比。"""
    a = _literal_or_head(left)
    b = _literal_or_head(right)
    if a is _MISS or b is _MISS:
        return False
    if isinstance(a, str) and isinstance(b, str):
        # 451 frequencySort 这种「任意顺序的字符串答案」
        return sorted(a) == sorted(b)
    if not (isinstance(a, list) and isinstance(b, list)):
        return False
    return canonical(a) == canonical(b)


def any_alternative(expected: str, actual: str) -> bool:
    """题面写「1 或 5」「A or B」这种多解输出：任意一个对上就算过。"""
    parts = [part for part in re.split(r"或|\bor\b", expected or "") if part.strip()]
    if len(parts) < 2:
        return False
    return any(outputs_match(part, actual) for part in parts)


def canonical(value) -> str:
    if isinstance(value, list):
        return "[" + ",".join(sorted(canonical(item) for item in value)) + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return repr(round(value, 6))
    if isinstance(value, int):
        return repr(value)
    return repr(value)


def _canonical_quad_text(text: str) -> str:
    """把「四叉树层序数组」里的非叶子节点 val 归零。

    题面明说 isLeaf 为 False 时 val 给 True / False 都会被判题机制接受，所以题面的期望
    输出可能写成 `[[0,1],…]` 而参考解跑出来是 `[[0,0],…]`（_dump_quad 已经统一按 0 输出）。
    只在返回类型是 QuadNode 的题上调用，别的题一个字都不影响。
    """
    value = _literal_or_head(text)
    if value is _MISS or not isinstance(value, list):
        return text
    out = []
    for item in value:
        if isinstance(item, list) and len(item) == 2:
            leaf = 1 if item[0] else 0
            out.append([leaf, (1 if item[1] else 0) if leaf else 0])
        else:
            out.append(item)
    return repr(out)


def validate(code: str, meta: dict, examples: list[dict]) -> tuple[bool, list[str], str, bool]:
    """跑官方示例；返回 (是否全部通过, 已跑通的示例 call, 失败原因, 是否「顺序无关」)。"""
    passed: list[str] = []
    order_free = False
    quad = dump_kind_of(str((meta.get("return") or {}).get("type") or "")) == "quad"
    for ex in examples[:MAX_EXAMPLES]:
        call = call_from_args(meta, ex.get("callArgs") or "")
        if not call:
            continue
        wrapped, judgeable = prepare_call(meta, call)
        result = run_case(code, wrapped)
        if not result.get("ok"):
            return False, passed, f"示例失败 {call}: {result.get('error')}", order_free
        expected_text = ex.get("output") or ""
        if quad:
            expected_text = _canonical_quad_text(expected_text)
        if judgeable and not outputs_match(expected_text, result.get("repr") or ""):
            actual = result.get("repr") or ""
            if unordered_equal(expected_text, actual) or any_alternative(expected_text, actual):
                # 题目接受任意顺序 / 多个答案：可以信这个解，但边界期望不能写死
                order_free = True
            else:
                return (
                    False,
                    passed,
                    f"示例不符 {call}: 期望 {ex.get('output')} 实际 {result.get('repr')}",
                    order_free,
                )
        passed.append(call)
    return bool(passed), passed, "" if passed else "没有可解析的官方示例", order_free


def return_may_be_none(meta: dict) -> bool:
    """题面声明的返回类型是否允许「没有值」（void / Optional[...]）。"""
    text = re.sub(r"\s+", "", str((meta.get("return") or {}).get("type") or ""))
    return text in ("", "void") or text.lower().startswith("optional")


def edge_expected(
    code: str, meta: dict, edge_cases: list[dict], deadline: float, order_free: bool = False
) -> tuple[dict[str, str], list[str], list[str]]:
    """用可信参考解跑边界输入；返回 (expected 映射, 无期望但保留的 call, 丢弃的 call)。

    跑挂 / 超时的边界输入**不写 expected，但用例本身保留**（前端当成「只运行不判定」）：
    这样用户还能看到这条边界输入、自己解在它上面的表现，只是不会被判对错。
    """
    expected: dict[str, str] = {}
    run_only: list[str] = []
    skipped: list[str] = []
    allow_none = return_may_be_none(meta)
    for item in edge_cases:
        call = str(item.get("call") or "").strip()
        if not call:
            continue
        if time.time() > deadline:
            run_only.append(call)  # 预算用完了，没验过 -> 留空不判定
            continue
        wrapped, judgeable = prepare_call(meta, call)
        result = run_case(code, wrapped)
        if not result.get("ok"):
            run_only.append(call)
            continue
        text = result.get("repr") or ""
        # 原地修改题 / 无返回值：前端比的是返回值（None），给期望只会误判
        if not judgeable or len(text) > MAX_REPR:
            run_only.append(call)
            continue
        # 参考解返回 None、但题面的返回类型不允许「没有值」：这条输入多半超出了题目约束
        # （385 的 s="" 就违反 1 <= s.length），参考解在这里是猜的，写死期望会误判写对的解。
        if text == "None" and not allow_none:
            run_only.append(call)
            continue
        if order_free:
            # 「任意顺序都算对」的题：只有答案本身唯一时才敢写死期望
            # （`[]` / `[[]]` / `"a"` 这种，换个顺序也变不出别的答案）
            value = parse_literal(text)
            if not (isinstance(value, (list, str)) and len(value) <= 1):
                run_only.append(call)
                continue
        expected[call] = text
    return expected, run_only, skipped


def finalize(
    no: str,
    meta: dict,
    edge_cases: list[dict],
    code: str,
    source: str,
    order_free: bool,
    deadline: float,
    second: str = "",
    is_hot: bool = False,
) -> dict:
    """跑边界输入、写结果文件、返回统计。"""
    expected, run_only, skipped = edge_expected(code, meta, edge_cases, deadline, order_free)

    # 交叉校验：Hot 100 若还有第二个可信解，两条解结果不一致的边界输入就丢掉期望
    # （用例保留、不判定，而不是整条删掉）
    if is_hot and second:
        for call in list(expected):
            wrapped, _ = prepare_call(meta, call)
            result = run_case(second, wrapped)
            if not result.get("ok") or not outputs_match(expected[call], result.get("repr") or ""):
                expected.pop(call, None)

    payload = {"code": code, "expected": expected, "skipped": skipped}
    (OUT / f"{no}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return {
        "no": no,
        "status": "ok",
        "source": source,
        "expected": len(expected),
        "runOnly": len(run_only),
        "skipped": len(skipped),
        "hot": is_hot,
    }


def process(
    no: str,
    raw: dict,
    meta: dict,
    edge_cases: list[dict],
    markdowns: list[str],
    is_hot: bool,
    key: str | None,
    use_ai_fallback: bool,
    cached_code: str = "",
    ai_primary: bool = False,
) -> dict:
    started = time.time()
    deadline = started + PROBLEM_BUDGET
    html = raw.get("translatedContent") or raw.get("content") or ""
    examples = extract_examples(html)
    if not examples:
        return {"no": no, "status": "no-examples"}

    # 559/589/590/429/385/558/427 的 metaData 把节点类型写成了 integer / integer[][]，
    # 这里补回来：call_meta 决定怎么构造实参、怎么还原返回值；prompt_meta 只用来拼提示词。
    call_meta, prompt_meta = resolve_meta(no, meta)
    node_hint = node_class_hint(call_meta)

    # --recompute：直接复用已有参考解，不再调用模型，只重算边界期望
    if cached_code:
        ok, _, err, free = validate(cached_code, call_meta, examples)
        if not ok:
            return {"no": no, "status": "untrusted", "detail": f"cached: {err}"[:400]}
        result = finalize(no, call_meta, edge_cases, cached_code, "cached", free, deadline, "", is_hot)
        result["sec"] = round(time.time() - started, 1)
        return result

    sources: list[tuple[str, str]] = []  # (来源, 代码)
    errors: list[str] = []
    # ai_primary：新扩的题（Easy / 全量题面）没有教材代码可用，直接让模型写，
    # 和 Hot 100 一样「AI 首解 + 一次重试」；hot 以外的老题仍走「教材优先 + AI 兜底」。
    if (is_hot or ai_primary) and key:
        try:
            code = gen_solution(key, no, prompt_meta, raw, examples, node_hint)
            if code:
                sources.append(("ai", code))
            else:
                errors.append("ai: 没有可用的代码块（回复被 max_tokens 截断 / 没按格式输出）")
        except Exception as exc:  # noqa: BLE001
            return {"no": no, "status": "ai-error", "detail": str(exc)[:200]}
    for code in tutorial_solutions(no, markdowns):
        sources.append(("tutorial", code))

    trusted: list[tuple[str, str]] = []
    order_free = False
    for source, code in sources:
        ok, _, err, free = validate(code, call_meta, examples)
        if ok:
            trusted.append((source, code))
            order_free = order_free or free
            if source == "ai":
                break  # AI 解验过就够了，省掉教材代码的验证开销
        else:
            errors.append(f"{source}: {err}")
            if source == "ai" and key:
                # Hot 100：AI 解没过就再生成一次
                try:
                    retry = gen_solution(key, no, prompt_meta, raw, examples, node_hint)
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"ai-retry: {exc}"[:200])
                    retry = None
                if retry:
                    ok2, _, err2, free2 = validate(retry, call_meta, examples)
                    if ok2:
                        trusted.append(("ai-retry", retry))
                        order_free = order_free or free2
                        break
                    errors.append(f"ai-retry: {err2}")

    # ai_primary 的题上面已经试过两次 AI，不再兜第三次（控制成本）
    if not trusted and use_ai_fallback and key and not ai_primary:
        try:
            code = gen_solution(key, no, prompt_meta, raw, examples, node_hint)
            if code:
                ok, _, err, free = validate(code, call_meta, examples)
                if ok:
                    trusted.append(("ai-fallback", code))
                    order_free = order_free or free
                else:
                    errors.append(f"ai-fallback: {err}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"ai-fallback: {exc}"[:200])

    if not trusted:
        return {
            "no": no,
            "status": "untrusted",
            "detail": " | ".join(errors)[:400],
            "hot": is_hot,
        }

    source, code = trusted[0]
    second = trusted[1][1] if len(trusted) > 1 else ""
    result = finalize(no, call_meta, edge_cases, code, source, order_free, deadline, second, is_hot)
    result["sec"] = round(time.time() - started, 1)
    return result


def failure_kind(result: dict) -> str:
    """把失败归到「示例不符 / 示例跑挂 / 无示例 / AI 报错 / 其他」，便于看分布。"""
    status = str(result.get("status") or "")
    detail = str(result.get("detail") or "")
    if status == "untrusted":
        if "示例不符" in detail:
            return "example-mismatch"
        if "示例失败" in detail:
            return "example-error"
        if "没有可解析的官方示例" in detail:
            return "no-examples"
        return "untrusted-other"
    if status in ("ai-error", "crash", "no-examples"):
        return status
    return status or "unknown"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument(
        "--scope",
        choices=["all", "hot100", "curated", "easy", "all-statements", "p01"],
        default="all",
        help=(
            "all=精选题∪Hot100（原语义）；hot100=只做 Hot100；curated=只做精选（去掉 Hot100）；"
            "easy=全部 Easy 难度题；all-statements=全部有题面且能解析出官方示例的题；"
            "p01=master.json 里 tier P0/P1 的中等题（用户最可能卡住的题）"
        ),
    )
    ap.add_argument("--only", default="", help="只处理这些题号（逗号分隔）")
    ap.add_argument(
        "--difficulty",
        choices=["Easy", "Medium", "Hard", "easy", "medium", "hard"],
        default="",
        help="只处理这个难度的题（和任何 scope 叠加，用于分批发）",
    )
    ap.add_argument("--force", action="store_true", help="已有结果也重跑")
    ap.add_argument(
        "--recompute",
        action="store_true",
        help="复用已有参考解，只重算边界期望（不调用模型，改判定规则后用它刷新）",
    )
    ap.add_argument("--no-ai-fallback", action="store_true", help="教材解验不过时不要用 AI 兜底")
    ap.add_argument("--dry-run", action="store_true", help="只打印会处理哪些题，不调用模型")
    args = ap.parse_args()

    full = json.loads((DATA / "statements_full.json").read_text(encoding="utf-8-sig"))
    hot_list = json.loads((DATA / "lc_hot100.json").read_text(encoding="utf-8-sig"))
    hot = {str(item["no"]).strip() for item in hot_list}
    edge_all = json.loads((DATA / "edge_cases.json").read_text(encoding="utf-8"))

    tutorials = json.loads(TUTORIALS.read_text(encoding="utf-8"))
    markdown_by_no: dict[str, list[str]] = {}
    for doc in tutorials:
        for section in doc.get("sections") or []:
            no = str(section.get("problemNo") or "").strip()
            if no and section.get("markdown"):
                markdown_by_no.setdefault(no, []).append(section["markdown"])

    base_targets = set(markdown_by_no) | hot
    statements: dict[str, str] = {}  # {题号: 难度}，只有扩量 scope 才需要算
    if args.scope in ("easy", "all-statements", "p01"):
        statements = statement_targets(full)
        if args.scope == "p01":
            wanted = master_p01_medium()
            targets = {no for no in (set(statements) | base_targets) if no in wanted}
            print(
                f"statement-targets={len(statements)} master-p01-medium={len(wanted)} "
                f"eligible={len(wanted & set(statements))}",
                flush=True,
            )
        else:
            targets = base_targets | set(statements)
            if args.scope == "easy":
                # 只保留 Easy：难度缺失的（不在 statements_full 里）不算 Easy
                targets = {no for no in targets if statements.get(no) == "Easy"}
            print(
                f"statement-targets={len(statements)} "
                f"(easy={sum(1 for d in statements.values() if d == 'Easy')})",
                flush=True,
            )
    else:
        targets = set(base_targets)
        if args.scope == "hot100":
            targets &= hot
        elif args.scope == "curated":
            targets -= hot
    # 按难度过滤（和任何 scope 叠加；全量扩量时用它分批发）
    if args.difficulty:
        want = args.difficulty.strip().lower()
        targets = {
            no
            for no in targets
            if str((full.get(no) or {}).get("difficulty") or "").strip().lower() == want
        }
    # 这些题没有教材代码，参考解只能由 AI 写（process 里走 ai_primary 分支）
    ai_targets = targets - base_targets
    if args.only:
        wanted = {part.strip() for part in args.only.split(",") if part.strip()}
        targets &= wanted
        ai_targets &= wanted

    OUT.mkdir(parents=True, exist_ok=True)
    todo = []
    # 排序：有边界用例的先跑（没有边界用例的题跑出来也挂不上期望，放最后）
    for no in sorted(targets, key=lambda x: (0 if edge_all.get(x) else 1, len(x), x)):
        path = OUT / f"{no}.json"
        cached = ""
        if path.exists():
            if not args.recompute and not args.force:
                continue
            try:
                cached = str(json.loads(path.read_text(encoding="utf-8")).get("code") or "")
            except (json.JSONDecodeError, OSError):
                cached = ""
            if args.recompute and not cached:
                continue
        raw = full.get(no) or {}
        meta = meta_of(raw)
        if not meta.get("name"):
            continue
        todo.append(
            (
                no,
                raw,
                meta,
                edge_all.get(no) or [],
                markdown_by_no.get(no) or [],
                cached,
                str(raw.get("difficulty") or ""),
            )
        )
    if args.limit:
        todo = todo[: args.limit]

    if args.dry_run:
        print(
            json.dumps(
                {
                    "scope": args.scope,
                    "targets": len(targets),
                    "todo": len(todo),
                    "aiOnly": len(ai_targets),
                    "withEdgeCases": sum(1 for item in todo if item[3]),
                    "sample": [item[0] for item in todo[:30]],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        return

    key = None
    try:
        key = api_key()
    except SystemExit:
        print("! app/.env.local 里没有 DEEPSEEK_API_KEY：只跑教材解，不做 AI 生成", flush=True)

    print(
        f"targets={len(targets)} todo={len(todo)} hot100={len(hot)} "
        f"aiOnly={len(ai_targets)} existing={len(list(OUT.glob('*.json')))}",
        flush=True,
    )
    if not todo:
        return

    started = time.time()
    lock = threading.Lock()
    done = 0
    stats = {"ok": 0, "untrusted": 0, "no-examples": 0, "ai-error": 0}
    hot_ok = 0
    curated_ok = 0
    results = []

    def work(item):
        no, raw, meta, edges, markdowns, cached, diff = item
        try:
            result = process(
                no,
                raw,
                meta,
                edges,
                markdowns,
                no in hot,
                key,
                not args.no_ai_fallback,
                cached,
                ai_primary=no in ai_targets,
            )
        except Exception as exc:  # noqa: BLE001
            result = {"no": no, "status": "crash", "detail": f"{type(exc).__name__}: {exc}"[:300]}
        result["difficulty"] = diff
        result["aiOnly"] = no in ai_targets
        return result

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, item): item[0] for item in todo}
        for future in as_completed(futures):
            no = futures[future]
            result = future.result()
            results.append(result)
            with lock:
                done += 1
                status = result.get("status", "?")
                stats[status] = stats.get(status, 0) + 1
                if status == "ok":
                    if result.get("hot"):
                        hot_ok += 1
                    else:
                        curated_ok += 1
                    print(
                        f"  ok {no} [{result.get('source')}] 期望 {result.get('expected')} 条 "
                        f"{result.get('sec')}s  {done}/{len(todo)}",
                        flush=True,
                    )
                else:
                    print(f"  -- {no} {status} {str(result.get('detail') or '')[:120]}", flush=True)

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "seconds": round(time.time() - started),
        "scope": args.scope,
        "todo": len(todo),
        "stats": stats,
        "hot100Ok": hot_ok,
        "curatedOk": curated_ok,
        "aiOnlyOk": sum(1 for r in results if r.get("status") == "ok" and r.get("aiOnly")),
        "expectedWritten": sum(
            int(r.get("expected") or 0) for r in results if r.get("status") == "ok"
        ),
        "byDifficulty": {
            diff: {
                "todo": sum(1 for r in results if r.get("difficulty") == diff),
                "ok": sum(
                    1 for r in results if r.get("difficulty") == diff and r.get("status") == "ok"
                ),
            }
            for diff in sorted({str(r.get("difficulty") or "") for r in results})
        },
        "failureKinds": {},
        "failures": [r for r in results if r.get("status") != "ok"],
    }
    for result in report["failures"]:
        kind = failure_kind(result)
        report["failureKinds"][kind] = report["failureKinds"].get(kind, 0) + 1
    (OUT / "_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "failures"}, ensure_ascii=False, indent=2))
    print(f"done in {report['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
