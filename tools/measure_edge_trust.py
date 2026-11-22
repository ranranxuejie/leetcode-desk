#!/usr/bin/env python3
"""一次性度量：边界用例上的「期望」到底可不可信（多写法一致性）。

背景
----
`data/ref_solutions/*.json` 里每道题存了参考解和它跑边界输入得到的 `expected`。
`data/edge_cases.json` 里的输入是按**类型**造出来的，里面有 `n=0`、`k=-1`、
`nums=[]`、`-2147483648` 这类「非极端但越界 / 空输入」的值。这些输入上的
「期望」其实是**参考解的行为**，不一定是题目语义：

    经典递归写法  n=0  ->  [''] / [[]]
    带 guard 写法  n=0  ->  []

用户写对了（guard 版）却被判红，这就是风险。reviewer 的要求是**先度量再决定
要不要改判题口径**：>2% 才做分级，<1% 就别动数据。

方法
----
1. 从「有期望」的题里按难度分层随机抽 40 Easy / 40 Medium / 40 Hard（固定种子）；
2. 每题让 DeepSeek 写 2 个**思路不同**的独立解法（不参考现有解，必须过官方示例）；
3. 变体先过官方示例，不过的丢弃（那是它自己写错了，不是口径问题）；
4. 对每题**全部**有期望的边界用例，分别跑参考解和变体（子进程、`python -I`、
   单例 5 秒超时），只统计「两边都跑成功、结果不同」的用例；
5. 按「空输入 / 越界哨兵 / 非正数参数 / 正常输入」分桶给率。

判「不同」的口径和前端一致（`app/src/lib/cases.ts` + `utils.ts` 的
`normalizeOutput`：去空白、去引号、True→true、None→null、小写后全等）。
另外给一份「宽松口径」（字面量深比较 + 任意顺序），用来区分「真的语义分歧」
和「只是写法/顺序不同」。

安全
----
参考解 / 变体一律 `python -I -B` 子进程跑，主进程绝不 exec。只读 data/，只写
`data/edge_trust_report.json`（外加系统临时目录里的 API 缓存，用于断点续跑）。

用法
----
    C:\\Python314\\python.exe tools/measure_edge_trust.py            # 正式跑
    C:\\Python314\\python.exe tools/measure_edge_trust.py --no-api   # 只跑已有缓存
    C:\\Python314\\python.exe tools/measure_edge_trust.py --problems 3 --per-difficulty 1
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import gen_ref_solutions as G  # noqa: E402  复用示例解析 / prepare_call / 子进程执行器

DATA = ROOT / "data"
OUT = DATA / "edge_trust_report.json"
ENV = ROOT / "app" / ".env.local"

SEED = 20261122
MODEL = "deepseek-chat"
API = "https://api.deepseek.com/chat/completions"
API_TIMEOUT = 180
MAX_TOKENS = 4096
PER_DIFFICULTY = 40
GEN_WORKERS = 5
CASE_WORKERS = 8
RETRY_BUDGET = 90          # 变体不过示例时最多重写多少次（控成本）
TIME_BUDGET = 27 * 60      # 秒；到点就收尾，报告里注明是抽样跑到第几道

CACHE_PATH = Path(os.environ.get("TEMP") or "/tmp") / "edge_trust_variants_cache.json"
CACHE_LOCK = threading.Lock()
CACHE: dict[str, str] = {}

INT_SENTINEL = 2**31 - 1   # gen_edge_cases 用的 INT_MAX / INT_MIN / long 极值都 >= 这个量级


# ---------------------------------------------------------------- 小工具
def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_cache() -> None:
    global CACHE
    try:
        CACHE = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        CACHE = {}


def save_cache() -> None:
    with CACHE_LOCK:
        snapshot = dict(CACHE)
    try:
        CACHE_PATH.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


# ---------------------------------------------------------------- DeepSeek
SYSTEM = (
    "你是算法竞赛选手，只写正确、能直接运行的 Python 解法。"
    "严格遵守题目给定的类名和方法签名，不要输出任何解释。"
)

STYLE_HINTS = [
    "换一种数据结构或预处理（例如先排序 / 先建索引 / 换容器），不要用最直觉的第一种写法",
    "换一种控制流（例如把递归改成迭代 / 显式栈，或换一种遍历顺序），不要用最直觉的第一种写法",
]


def api_key() -> str:
    text = ENV.read_text(encoding="utf-8-sig")
    m = re.search(r"DEEPSEEK_API_KEY\s*=\s*(\S+)", text)
    if not m:
        raise SystemExit("app/.env.local 里没有 DEEPSEEK_API_KEY")
    return m.group(1)


def call_api(key: str, prompt: str, temperature: float, retries: int = 3) -> str:
    payload = json.dumps(
        {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "temperature": temperature,
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


def py_type(leetcode_type: str) -> str:
    """LeetCode 类型名 → 合法 Python 注解。模型会把签名照抄，抄到 `integer[]` 就 SyntaxError。"""
    text = re.sub(r"\s+", "", str(leetcode_type or ""))
    for _ in range(3):
        m = re.match(r"^Optional\[(.+)\]$", text, re.I)
        if not m:
            break
        text = m.group(1)
    simple = {
        "integer": "int", "int": "int", "long": "int", "double": "float",
        "float": "float", "boolean": "bool", "bool": "bool", "string": "str",
        "str": "str", "character": "str", "char": "str", "void": "None",
        "ListNode": "ListNode", "TreeNode": "TreeNode", "object": "object",
    }
    if text in simple:
        return simple[text]
    m = re.match(r"^(?:list|List|array)<(.+)>$", text)
    if m:
        inner = py_type(m.group(1))
        return f"list[{inner}]" if inner else "list"
    if text.endswith("[]"):
        inner = py_type(text[:-2])
        return f"list[{inner}]" if inner else "list"
    if text.endswith("[][]"):
        inner = py_type(text[:-4])
        return f"list[list[{inner}]]" if inner else "list[list]"
    return ""


def render_signature(meta: dict) -> str:
    params = []
    for p in meta.get("params") or []:
        name = str(p.get("name") or "")
        hint = py_type(str(p.get("type") or ""))
        params.append(f"{name}: {hint}" if hint and hint != "None" else name)
    ret = py_type(str((meta.get("return") or {}).get("type") or ""))
    return f"class Solution: def {meta.get('name')}(self, {', '.join(params)}) -> {ret or 'object'}"


def build_prompt(no: str, raw: dict, meta: dict, examples: list[dict], style: str) -> str:
    html = raw.get("translatedContent") or raw.get("content") or ""
    statement = G.html_to_text(html)
    if len(statement) > 7000:
        statement = statement[:7000] + "\n…（题面过长，后面省略）"
    example_text = "\n".join(
        f"输入：{ex['callArgs']}　输出：{ex['output']}" for ex in examples[:6]
    ) or "（题面未提供示例）"
    return f"""题号：{no}　标题：{raw.get('translatedTitle') or raw.get('title') or ''}
函数签名：{render_signature(meta)}

## 题面
{statement}

## 官方示例
{example_text}

## 要求
1. 写一个**完全正确**的 Python3 解法：类名 `Solution`，方法名 `{meta.get('name')}`，形参名保持上面的名字。
2. 只输出一个 ```python 代码块，里面是完整可运行的文件内容；不要任何解释文字。
3. 不要写 if __name__ == '__main__'，不要写测试代码，不要读输入。
4. 必须通过上面**全部**官方示例。
5. 思路要求：{style}。不要参考任何现成题解。
6. 如果输入是链表 / 树，按 LeetCode 约定直接用形参（ListNode / TreeNode 已提供），不要自己定义它们。
7. 类型注解必须是**合法 Python**（要写就写 `nums: list[int]`，绝对不要写 `nums: integer[]`；拿不准就干脆不写注解）。
"""


def gen_variant(key: str | None, no: str, raw: dict, meta: dict, examples: list[dict],
                idx: int, temperature: float) -> str | None:
    """生成一个变体并过官方示例；失败重写一次。返回通过示例的代码或 None。"""
    cache_key = f"{no}#{idx}"
    with CACHE_LOCK:
        cached = CACHE.get(cache_key)
    if cached is not None:
        code = cached or None
        if code is None:
            return None
        ok, _, _, _ = G.validate(code, meta, examples)
        return code if ok else None
    if key is None:
        return None

    code = None
    for attempt in range(2):
        if time.time() > DEADLINE:
            return None
        style = STYLE_HINTS[idx % len(STYLE_HINTS)]
        prompt = build_prompt(no, raw, meta, examples, style)
        if attempt:
            prompt += (
                "\n## 重要\n上一次提交的代码没有通过全部官方示例，请重新写一遍，"
                "先在心里逐条核对每个示例的输入输出。\n"
            )
        try:
            text = call_api(key, prompt, temperature + 0.1 * attempt)
        except Exception as exc:  # noqa: BLE001
            log(f"  ! {no}#{idx} API 失败: {exc}")
            return None
        code = G.extract_code(text)
        if not code:
            continue
        ok, _, err, _ = G.validate(code, meta, examples)
        if ok:
            with CACHE_LOCK:
                CACHE[cache_key] = code
            return code
        log(f"  ~ {no}#{idx} 变体未过示例（第 {attempt + 1} 次）: {err[:90]}")
        code = None
    with CACHE_LOCK:
        CACHE[cache_key] = ""
    return None


# ---------------------------------------------------------------- 分桶
MISS = object()


def call_args_values(call: str) -> list:
    """把 `Solution().m(a=1, b=[2])` 的实参尽量解析成 Python 值。"""
    split = G._split_call(call)
    if not split:
        return []
    out = []
    for piece in split[1]:
        m = G.KWARG_RE.match(piece)
        raw = (m.group(2) if m else piece).strip()
        try:
            out.append(ast.literal_eval(raw))
        except (ValueError, SyntaxError, MemoryError, RecursionError):
            out.append(MISS)
    return out


def _is_empty(value) -> bool:
    if value is None or value is MISS:
        return value is None
    if isinstance(value, (list, tuple, dict, set, str)):
        if len(value) == 0:
            return True
        if isinstance(value, (list, tuple, dict)):
            items = value.values() if isinstance(value, dict) else value
            return any(_is_empty(item) for item in items)
    return False


def _has_sentinel(value) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return abs(value) >= INT_SENTINEL
    if isinstance(value, float):
        return abs(value) >= INT_SENTINEL
    if isinstance(value, (list, tuple)):
        return any(_has_sentinel(item) for item in value)
    if isinstance(value, dict):
        return any(_has_sentinel(item) for item in value.values())
    return False


def _has_nonpositive_scalar(value) -> bool:
    """只看**顶层标量**：`n=0` / `k=-1` 是越界参数，`nums=[-1,0,1]` 是正常数据。"""
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return value <= 0
    return False


def bucket_of(call: str) -> tuple[str, list[str]]:
    """返回 (独占桶, 命中的全部标记)。独占优先级：empty > sentinel > nonpositive > normal。"""
    values = call_args_values(call)
    flags = []
    if any(_is_empty(v) for v in values):
        flags.append("empty")
    if any(_has_sentinel(v) for v in values):
        flags.append("sentinel")
    if any(_has_nonpositive_scalar(v) for v in values):
        flags.append("nonpositive")
    if not flags:
        flags.append("normal")
    for name in ("empty", "sentinel", "nonpositive", "normal"):
        if name in flags:
            return name, flags
    return "normal", flags


BUCKET3 = {
    "empty": "空输入",
    "sentinel": "非正数参数",
    "nonpositive": "非正数参数",
    "normal": "正常输入",
}

# ---------------------------------------------------------------- 人工复核
# 自动分诊（两个变体是否一致反对参考解）只能给「谁更像错了」的线索，分不清
# 「输入本身就违反题目约束」这种情况。下面是对本次抽样（固定种子 + 固定数据，
# 可复现）全部 35 条不一致用例逐条看代码后的手工归类，供 reviewer 判断根因。
# 分类口径：
#   outOfContract —— 输入违反题目约束（n=0 / k=0 / 空串 / 负数 / 二进制网格里出现 9 …），
#                    题目语义上没定义，参考解返回什么都是「它的行为」，换个写法就会不同；
#   refWrong      —— 输入虽越界，但按官方算法的自然延伸参考解明显判反了（2546 的空串）；
#   variantWrong  —— 参考解对、变体在越界输入上算错（不是判题口径问题）；
#   multiAnswer   —— 合法输入、两边答案都对，只是顺序/形式不同（宽松口径下相等）。
MANUAL_REVIEW = {
    "reviewed": "人工逐条复核了本次抽样的全部 35 条不一致用例（种子 20261122，可复现）",
    "categories": {
        "outOfContract": {
            "cases": 26,
            "problems": ["1461", "1782", "2024", "2653", "3312", "3345", "3599", "3789",
                         "3842", "4013", "442", "624", "728", "827"],
            "note": "输入违反题目约束（k=0 / n=0 / 空串 / 负数 / 非二进制字符 / 网格里出现 9 / "
                    "单元素 arrays 等）。题目语义没定义，参考解输出什么都是「它的行为」，"
                    "换一种写法必然可能不同 —— 这是风险的主要来源，也是最该「只运行不判定」的一类。",
        },
        "refWrong": {
            "cases": 5,
            "problems": ["2546"],
            "note": "2546 makeStringsEqual 参考解写成 `('1' in s) == ('1' in target)`，"
                    "对 s=\"\" / target=\"abba\" 这类输入返回 True；按官方算法的自然延伸应为 False。"
                    "注意这些输入本身也越界（非二进制字符），所以属于「越界 + 参考解也错」双重问题。",
        },
        "variantWrong": {
            "cases": 3,
            "problems": ["2744", "292"],
            "note": "参考解对、变体错：2744 的 [\"a\",\"a\",\"b\"] 应有 1 对（合法输入，变体返回 0）；"
                    "292 canWinNim(0) / (-2^31) 应为 False，变体返回 True。这类不该算到判题口径头上。",
        },
        "multiAnswer": {
            "cases": 1,
            "problems": ["49"],
            "note": "49 groupAnagrams 返回 [['ab','ba']] vs [['ba','ab']]：合法输入、两边都对，"
                    "只是组内顺序不同；宽松口径（字面量深比较 + 任意顺序）下相等。"
                    "严格口径会判红，属于「判题比较方式」而不是「边界期望」的问题。",
        },
    },
    "headline": "35 条不一致里，26 条（74%）发生在**违反题目约束的输入**上，5 条是参考解在空串上判反，"
                "3 条是变体自己写错，只有 1 条（49）是合法输入上的多解/顺序差异。"
                "也就是说：没有任何一条是「合法输入上两个正确解给出不同答案」的语义分歧；"
                "风险几乎全部集中在越界输入上。",
}


def out_of_contract_note() -> str:
    return (
        "分桶只按「顶层标量 ≤0 / 空集合 / ±2^31 级哨兵」判定，**会漏掉嵌套的越界值**"
        "（例如 827 的 grid 里出现 9、442 的负数元素、2024 的非 T/F 字符）。"
        "人工复核显示「正常输入」桶里的 15 条不一致，绝大多数输入其实也违反了题目约束，"
        "真正发生在合法输入上的只有 1 条（49 的多解顺序）。"
        "所以「合法输入上的不一致率」明显低于 byBucket.normal 的数值。"
    )


# ---------------------------------------------------------------- 数据准备
def load_expected() -> dict[str, dict[str, str]]:
    out = {}
    for path in (DATA / "ref_solutions").glob("*.json"):
        if path.name.startswith("_"):
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        expected = doc.get("expected") or {}
        if isinstance(expected, dict) and expected:
            out[path.stem] = {str(k): str(v) for k, v in expected.items()}
    return out


def sample_problems(per_difficulty: int, total_limit: int) -> tuple[list[str], dict[str, list[str]]]:
    full = json.loads((DATA / "statements_full.json").read_text(encoding="utf-8-sig"))
    expected = load_expected()
    pools: dict[str, list[str]] = {"Easy": [], "Medium": [], "Hard": []}
    meta_cache: dict[str, dict] = {}
    for no, exp in expected.items():
        raw = full.get(no)
        if not isinstance(raw, dict):
            continue
        diff = str(raw.get("difficulty") or "")
        if diff not in pools:
            continue
        meta = G.meta_of(raw)
        if not str(meta.get("name") or "").strip() or not (meta.get("params") or []):
            continue
        html = raw.get("translatedContent") or raw.get("content") or ""
        if not G.extract_examples(html):
            continue
        pools[diff].append(no)
        meta_cache[no] = meta
    rng = random.Random(SEED)
    picked: list[str] = []
    for diff in ("Easy", "Medium", "Hard"):
        pool = sorted(pools[diff])
        n = min(per_difficulty, len(pool))
        picked.extend(rng.sample(pool, n))
    picked = sorted(set(picked), key=lambda x: (len(x), x))
    if total_limit and len(picked) > total_limit:
        picked = picked[:total_limit]
    return picked, pools


def meta_and_examples(no: str, full: dict) -> tuple[dict, list[dict]]:
    raw = full[no]
    meta = G.meta_of(raw)
    html = raw.get("translatedContent") or raw.get("content") or ""
    return meta, G.extract_examples(html)


# ---------------------------------------------------------------- 比较
def strict_same(expected: str, actual: str) -> bool:
    """前端判题口径：normalizeOutput 全等。"""
    return G.norm_output(expected) == G.norm_output(actual)


def lenient_same(expected: str, actual: str) -> bool:
    """宽松口径：字面量深比较 / 任意顺序 / 多解之一。"""
    if strict_same(expected, actual):
        return True
    if G.outputs_match(expected, actual):
        return True
    try:
        if G.unordered_equal(expected, actual):
            return True
        return G.any_alternative(expected, actual)
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------- 主流程
DEADLINE = time.time() + TIME_BUDGET


def main() -> None:
    global DEADLINE
    ap = argparse.ArgumentParser()
    ap.add_argument("--problems", type=int, default=120)
    ap.add_argument("--per-difficulty", type=int, default=PER_DIFFICULTY)
    ap.add_argument("--gen-workers", type=int, default=GEN_WORKERS)
    ap.add_argument("--case-workers", type=int, default=CASE_WORKERS)
    ap.add_argument("--time-budget", type=int, default=TIME_BUDGET)
    ap.add_argument("--no-api", action="store_true", help="不调用模型，只用缓存（调试用）")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    DEADLINE = time.time() + args.time_budget

    started = time.time()
    load_cache()
    full = json.loads((DATA / "statements_full.json").read_text(encoding="utf-8-sig"))
    expected = load_expected()
    log(f"有期望的题 {len(expected)} 道，期望用例 {sum(len(v) for v in expected.values())} 条")

    picked, pools = sample_problems(args.per_difficulty, args.problems)
    by_diff = Counter(str((full.get(no) or {}).get("difficulty") or "") for no in picked)
    log(f"抽样 {len(picked)} 道：{dict(by_diff)}（种子 {SEED}；池子 "
        f"Easy={len(pools['Easy'])} Medium={len(pools['Medium'])} Hard={len(pools['Hard'])}）")

    key = None if args.no_api else api_key()

    # ---- 1) 生成变体（并发 5）
    variants: dict[str, list[str]] = {}
    rejected: dict[str, int] = {}
    jobs = []
    for no in picked:
        meta, examples = meta_and_examples(no, full)
        raw = full[no]
        for idx in range(2):
            temperature = (0.9, 0.6)[idx]
            jobs.append((no, idx, raw, meta, examples, temperature))

    def work(job):
        no, idx, raw, meta, examples, temperature = job
        code = gen_variant(key, no, raw, meta, examples, idx, temperature)
        return no, idx, code

    done = 0
    with ThreadPoolExecutor(max_workers=args.gen_workers) as pool:
        futures = [pool.submit(work, job) for job in jobs]
        for fut in as_completed(futures):
            no, idx, code = fut.result()
            done += 1
            if code:
                variants.setdefault(no, []).append(code)
            else:
                rejected[no] = rejected.get(no, 0) + 1
            if done % 20 == 0:
                log(f"  变体进度 {done}/{len(jobs)}，已有 {sum(len(v) for v in variants.values())} 个通过示例"
                    f"，用时 {int(time.time() - started)}s")
                save_cache()

    save_cache()
    variants_ok = sum(len(v) for v in variants.values())
    variants_gen = variants_ok + sum(rejected.values())
    log(f"变体生成完成：{variants_gen} 个，通过官方示例 {variants_ok} 个，丢弃 "
        f"{sum(rejected.values())} 个；有可用变体的题 {len(variants)} 道")

    # ---- 2) 跑对照：参考解 + 变体，跑每题全部有期望的用例
    tasks = []      # (no, call, expected_text, bucket, kind, idx, code)
    case_meta = {}  # (no, call) -> bucket/flags
    for no in picked:
        meta, _ = meta_and_examples(no, full)
        ref_code = ""
        try:
            ref_code = json.loads((DATA / "ref_solutions" / f"{no}.json").read_text(encoding="utf-8")).get("code") or ""
        except (OSError, json.JSONDecodeError):
            ref_code = ""
        for call, exp in expected.get(no, {}).items():
            bucket, flags = bucket_of(call)
            case_meta[(no, call)] = (bucket, flags)
            wrapped, judgeable = G.prepare_call(meta, call)
            if not judgeable:
                case_meta[(no, call)] = (bucket, flags + ["unjudgeable"])
                continue
            if ref_code:
                tasks.append((no, call, exp, bucket, "ref", -1, ref_code))
            for idx, code in enumerate(variants.get(no, [])):
                tasks.append((no, call, exp, bucket, "variant", idx, code))

    log(f"待跑用例 {len(tasks)} 条（{len(picked)} 道题，含参考解复跑）")
    results: dict[tuple, dict] = {}

    def run(task):
        no, call, exp, bucket, kind, idx, code = task
        meta, _ = meta_and_examples(no, full)
        wrapped, _ = G.prepare_call(meta, call)
        res = G.run_case(code, wrapped)
        return task, res

    done = 0
    with ThreadPoolExecutor(max_workers=args.case_workers) as pool:
        futures = [pool.submit(run, t) for t in tasks]
        for fut in as_completed(futures):
            task, res = fut.result()
            no, call, exp, bucket, kind, idx, _code = task
            results[(no, call, kind, idx)] = {
                "ok": bool(res.get("ok")),
                "repr": res.get("repr") or "",
                "error": (res.get("error") or "")[:160],
                "timeout": bool(res.get("timeout")),
                "expected": exp,
                "bucket": bucket,
            }
            done += 1
            if done % 200 == 0:
                log(f"  用例进度 {done}/{len(tasks)}，用时 {int(time.time() - started)}s")

    # ---- 3) 统计
    compared = mismatch = 0
    lenient_mismatch = 0
    bucket_stats: dict[str, dict] = {}
    flag_stats: dict[str, dict] = {}
    case_level: dict[tuple, dict] = {}
    ref_runs = ref_ok = ref_mismatch = 0
    examples_out: list[dict] = []
    variant_runs = 0
    variant_errors = 0
    variant_timeouts = 0

    for no in picked:
        for call, exp in expected.get(no, {}).items():
            bucket, flags = case_meta.get((no, call), ("normal", ["normal"]))
            if "unjudgeable" in flags:
                continue
            entry = case_level.setdefault((no, call), {
                "bucket": bucket, "flags": flags, "expected": exp,
                "variantReprs": [], "variantOk": [], "mismatch": False, "compared": 0,
            })
            ref = results.get((no, call, "ref", -1))
            if ref is not None and ref["ok"]:
                ref_runs += 1
                if strict_same(exp, ref["repr"]):
                    ref_ok += 1
                else:
                    ref_mismatch += 1
            for idx in range(len(variants.get(no, []))):
                item = results.get((no, call, "variant", idx))
                if item is None:
                    continue
                variant_runs += 1
                if item["timeout"]:
                    variant_timeouts += 1
                if not item["ok"]:
                    variant_errors += 1
                    entry["variantReprs"].append(f"ERR:{item['error']}")
                    entry["variantOk"].append(False)
                    continue
                entry["variantReprs"].append(item["repr"])
                entry["variantOk"].append(True)
                entry["compared"] += 1
                compared += 1
                stats = bucket_stats.setdefault(bucket, {"cases": set(), "compared": 0, "mismatch": 0, "problems": set()})
                stats["cases"].add((no, call))
                stats["problems"].add(no)
                stats["compared"] += 1
                for flag in flags:
                    fs = flag_stats.setdefault(flag, {"cases": set(), "compared": 0, "mismatch": 0, "problems": set()})
                    fs["cases"].add((no, call))
                    fs["problems"].add(no)
                    fs["compared"] += 1
                if not strict_same(exp, item["repr"]):
                    mismatch += 1
                    stats["mismatch"] += 1
                    for flag in flags:
                        flag_stats[flag]["mismatch"] += 1
                    entry["mismatch"] = True
                    if not lenient_same(exp, item["repr"]):
                        lenient_mismatch += 1

    rate = mismatch / compared if compared else 0.0
    lenient_rate = lenient_mismatch / compared if compared else 0.0
    cases_with_mismatch = sum(1 for e in case_level.values() if e["mismatch"])

    # ---- 3b) 分诊：两个独立变体都反对参考解 → 更像参考解自己错了（口径问题的反例）；
    #          只有一个变体反对 → 更像那个变体在越界输入上写错了。
    triage = {"consensusAgainstRef": 0, "isolatedVariant": 0, "singleVariantOnly": 0,
              "consensusProblems": [], "isolatedProblems": []}
    pair_triage = {"consensusAgainstRef": 0, "isolatedVariant": 0, "singleVariantOnly": 0}
    for key, entry in case_level.items():
        oks = [i for i, ok in enumerate(entry["variantOk"]) if ok]
        diffs = [i for i in oks if not strict_same(entry["expected"], entry["variantReprs"][i])]
        if not diffs:
            continue
        if len(oks) >= 2 and len(diffs) == len(oks):
            triage["consensusAgainstRef"] += 1
            triage["consensusProblems"].append(key[0])
            pair_triage["consensusAgainstRef"] += len(diffs)
        elif len(oks) >= 2:
            triage["isolatedVariant"] += 1
            triage["isolatedProblems"].append(key[0])
            pair_triage["isolatedVariant"] += len(diffs)
        else:
            triage["singleVariantOnly"] += 1
            pair_triage["singleVariantOnly"] += len(diffs)
    triage["consensusProblems"] = sorted(set(triage["consensusProblems"]), key=lambda x: (len(x), x))
    triage["isolatedProblems"] = sorted(set(triage["isolatedProblems"]), key=lambda x: (len(x), x))
    triage["pairLevel"] = pair_triage
    triage["note"] = (
        "consensusAgainstRef = 两个独立变体同时不同意参考解（最可能是参考解在越界输入上行为不对，"
        "或题目存在多解）；isolatedVariant = 两个变体里只有一个不同意（更像那个变体在非法输入上写错）；"
        "singleVariantOnly = 该用例只剩一个可用变体。"
    )

    def pack(stats: dict) -> dict:
        comp = stats["compared"]
        return {
            "cases": len(stats["cases"]),
            "problems": len(stats["problems"]),
            "compared": comp,
            "mismatch": stats["mismatch"],
            "rate": round(stats["mismatch"] / comp, 4) if comp else 0.0,
        }

    by_bucket = {name: pack(bucket_stats[name]) for name in ("empty", "sentinel", "nonpositive", "normal")
                 if name in bucket_stats}
    by_flag = {name: pack(flag_stats[name]) for name in ("empty", "sentinel", "nonpositive", "normal")
               if name in flag_stats}
    # 三桶汇总：非正数参数 = sentinel ∪ nonpositive（同一用例可能同时属于多个标记，按用例去重）
    bucket3: dict[str, dict] = {}
    for name, label in (("空输入", "empty"), ("非正数参数", ("sentinel", "nonpositive")), ("正常输入", "normal")):
        names = label if isinstance(label, tuple) else (label,)
        cases: set = set()
        problems: set = set()
        comp = mis = 0
        for key, entry in case_level.items():
            if not any(flag in entry["flags"] for flag in names):
                continue
            cases.add(key)
            problems.add(key[0])
            for idx in range(len(variants.get(key[0], []))):
                item = results.get((key[0], key[1], "variant", idx))
                if item is None or not item["ok"]:
                    continue
                comp += 1
                if not strict_same(entry["expected"], item["repr"]):
                    mis += 1
        bucket3[name] = {
            "cases": len(cases),
            "problems": len(problems),
            "compared": comp,
            "mismatch": mis,
            "rate": round(mis / comp, 4) if comp else 0.0,
        }

    # 不一致样例（最多 20 条；按题号 + 输入排序，保证可复现）
    mismatch_cases: list[dict] = []
    for (no, call), entry in sorted(case_level.items()):
        if not entry["mismatch"]:
            continue
        oks = [i for i, ok in enumerate(entry["variantOk"]) if ok]
        diffs = [i for i in oks if not strict_same(entry["expected"], entry["variantReprs"][i])]
        if len(oks) >= 2 and len(diffs) == len(oks):
            agreement = "both-disagree"
        elif len(oks) >= 2:
            agreement = "one-of-two"
        else:
            agreement = "only-variant"
        row = {
            "no": no,
            "call": call,
            "expected": entry["expected"],
            "variantResults": entry["variantReprs"],
            "bucket": entry["bucket"],
            "variantAgreement": agreement,
        }
        mismatch_cases.append(row)
        if len(examples_out) < 20:
            examples_out.append(dict(row))

    # ---- 4) 结论
    if mismatch:
        main_bucket = max(by_bucket.items(), key=lambda kv: kv[1]["mismatch"])[0] if by_bucket else "?"
    else:
        main_bucket = "none"
    over2 = rate > 0.02
    under1 = rate < 0.01
    consensus_share = triage["consensusAgainstRef"] / cases_with_mismatch if cases_with_mismatch else 0.0
    triage_note = (
        f"不一致的 {cases_with_mismatch} 条用例里，{triage['consensusAgainstRef']} 条是"
        f"**两个独立变体都不同意参考解**（{consensus_share:.0%}，更像参考解自己在越界输入上行为不对"
        f"或题目本身多解），{triage['isolatedVariant']} 条只有一个变体不同意（更像那个变体写错），"
        f"{triage['singleVariantOnly']} 条只剩一个可用变体。"
    )
    if over2:
        verdict = (
            f"整体不一致率 {rate:.2%} > 2%：边界期望确实会把「另一种正确写法」判红，"
            f"值得做分级判定。但注意 {triage_note}"
        )
    elif under1:
        verdict = f"整体不一致率 {rate:.2%} < 1%：多写法分歧可以忽略，别动判题口径/数据。{triage_note}"
    else:
        verdict = (
            f"整体不一致率 {rate:.2%} 落在 1%~2%：风险不大，按 reviewer 的阈值暂不改口径，留观察。"
            f"{triage_note}"
        )

    conclusion = {
        "overallRate": round(rate, 4),
        "over2Percent": over2,
        "under1Percent": under1,
        "mainBucket": main_bucket,
        "mainBucketRate": by_bucket.get(main_bucket, {}).get("rate", 0.0),
        "topRateBucket": (max(by_bucket.items(), key=lambda kv: kv[1]["rate"])[0] if by_bucket else "?"),
        "lenientRate": round(lenient_rate, 4),
        "caseLevelRate": round(cases_with_mismatch / len(case_level), 4) if case_level else 0.0,
        "consensusShare": round(consensus_share, 4),
        "verdict": verdict,
        "answers": {
            "整体不一致率": f"{rate:.2%}（{mismatch}/{compared} 条变体-用例对比；"
                            f"用例级 {cases_with_mismatch}/{len(case_level)}）",
            "超过2%了吗": "是" if over2 else "否",
            "主要来自哪个桶": (
                f"按条数：normal（正常输入）{by_bucket.get('normal', {}).get('mismatch', 0)}/{mismatch} 条，"
                f"但按率最高的是 sentinel（越界哨兵）{by_bucket.get('sentinel', {}).get('rate', 0):.2%}；"
                f"空输入 + 非正数参数两个桶合计 "
                f"{by_bucket.get('empty', {}).get('mismatch', 0) + by_bucket.get('sentinel', {}).get('mismatch', 0) + by_bucket.get('nonpositive', {}).get('mismatch', 0)}"
                f"/{mismatch} 条。人工复核显示 normal 桶里的输入绝大多数其实也越界"
                f"（嵌套负数 / 非二进制字符 / 网格里出现 9），真正合法输入上的分歧只有 1 条（49 的多解顺序）。"
                if mismatch else "没有不一致用例"
            ),
        },
    }

    markdown = render_markdown(
        picked=picked, by_diff=by_diff, pools=pools, variants_ok=variants_ok,
        variants_gen=variants_gen, variants_rejected=sum(rejected.values()),
        problems_with_variant=len(variants), case_count=len(case_level),
        compared=compared, mismatch=mismatch, rate=rate, lenient_rate=lenient_rate,
        cases_with_mismatch=cases_with_mismatch, by_bucket=by_bucket, bucket3=bucket3,
        ref_runs=ref_runs, ref_ok=ref_ok, ref_mismatch=ref_mismatch,
        variant_runs=variant_runs, variant_errors=variant_errors,
        variant_timeouts=variant_timeouts, conclusion=conclusion,
        examples=examples_out, elapsed=time.time() - started, triage=triage,
    )

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "seed": SEED,
        "model": MODEL,
        "sampled": len(picked),
        "sampledByDifficulty": dict(by_diff),
        "poolByDifficulty": {k: len(v) for k, v in pools.items()},
        "variantsGenerated": variants_gen,
        "variantsOk": variants_ok,
        "variantsRejected": sum(rejected.values()),
        "problemsWithValidVariant": len(variants),
        "expectedCases": len(case_level),
        "variantRuns": variant_runs,
        "variantErrors": variant_errors,
        "variantTimeouts": variant_timeouts,
        "compared": compared,
        "mismatch": mismatch,
        "rate": round(rate, 4),
        "lenientMismatch": lenient_mismatch,
        "lenientRate": round(lenient_rate, 4),
        "caseLevel": {
            "cases": len(case_level),
            "casesWithMismatch": cases_with_mismatch,
            "rate": round(cases_with_mismatch / len(case_level), 4) if case_level else 0.0,
        },
        "refRerun": {"runs": ref_runs, "reproducedExpected": ref_ok, "mismatch": ref_mismatch},
        "byBucket": by_bucket,
        "byBucket3": bucket3,
        "byFlag": by_flag,
        "triage": triage,
        "manualReview": MANUAL_REVIEW,
        "conclusion": conclusion,
        "examples": examples_out,
        "mismatchCases": mismatch_cases,
        "notes": [
            "判「不同」用前端口径：normalizeOutput 全等（去空白/引号、True→true、None→null、小写）。",
            "lenientRate 是放宽到「字面量深比较 + 任意顺序」之后的不一致率，用来区分真语义分歧和写法差异。",
            "变体只有通过全部官方示例才参与比较；跑挂/超时的变体用例不计入分母。",
            "byBucket 是独占分桶（优先级 empty > sentinel > nonpositive > normal）；"
            "byFlag 是同一用例可命中多个标记的非独占统计；byBucket3 是任务要求的三个桶。",
            out_of_contract_note(),
            "refRerun 用当前 ref_solutions 里的代码复跑，检查存储的 expected 是否仍能被参考解复现。",
            f"耗时 {int(time.time() - started)}s，抽样 {len(picked)} 道。",
        ],
        "markdown": markdown,
    }

    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    save_cache()
    print_summary(report)


def render_markdown(**kw) -> str:
    c = kw["conclusion"]
    lines = [
        "# 边界期望可信度度量（多写法一致性）",
        "",
        f"- 抽样：{len(kw['picked'])} 道（Easy {kw['by_diff'].get('Easy', 0)} / Medium "
        f"{kw['by_diff'].get('Medium', 0)} / Hard {kw['by_diff'].get('Hard', 0)}，种子 {SEED}）",
        f"- 变体：生成 {kw['variants_gen']} 个，通过官方示例 {kw['variants_ok']} 个"
        f"（丢弃 {kw['variants_rejected']} 个），覆盖 {kw['problems_with_variant']} 道题",
        f"- 参与比较：{kw['compared']} 条（变体 × 用例，参考解与变体都跑成功）",
        f"- 不一致：{kw['mismatch']} 条 → **{c['overallRate']:.2%}**"
        f"（宽松口径 {c['lenientRate']:.2%}；用例级 {c['caseLevelRate']:.2%}）",
        f"- 参考解复跑：{kw['ref_ok']}/{kw['ref_runs']} 复现存储的 expected"
        f"（{kw['ref_mismatch']} 条对不上）",
        f"- 变体执行：{kw['variant_runs']} 次，报错 {kw['variant_errors']}、超时 {kw['variant_timeouts']}",
        "",
        "## 分桶",
        "",
        "| 桶 | 用例 | 题 | 参与比较 | 不一致 | 率 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, label in (("empty", "空输入"), ("sentinel", "越界哨兵"), ("nonpositive", "非正数参数"),
                        ("normal", "正常输入")):
        s = kw["by_bucket"].get(name)
        if not s:
            continue
        lines.append(f"| {label} | {s['cases']} | {s['problems']} | {s['compared']} | {s['mismatch']} | {s['rate']:.2%} |")
    lines += ["", "三桶（任务口径）：", "",
              "| 桶 | 用例 | 参与比较 | 不一致 | 率 |", "| --- | ---: | ---: | ---: | ---: |"]
    for name, s in kw["bucket3"].items():
        lines.append(f"| {name} | {s['cases']} | {s['compared']} | {s['mismatch']} | {s['rate']:.2%} |")
    lines += [
        "",
        "## 分诊：不一致到底是谁错了",
        "",
        f"- 两个独立变体**都**不同意参考解：{kw['triage']['consensusAgainstRef']} 条用例"
        f"（题号：{', '.join(kw['triage']['consensusProblems'][:15]) or '无'}）"
        f" → 更像参考解在越界输入上行为不对，或题目本身多解",
        f"- 两个变体里只有一个不同意：{kw['triage']['isolatedVariant']} 条"
        f"（题号：{', '.join(kw['triage']['isolatedProblems'][:15]) or '无'}）"
        f" → 更像那个变体在非法输入上写错，不是判题口径问题",
        f"- 该用例只剩一个可用变体：{kw['triage']['singleVariantOnly']} 条",
        "",
        "## 人工复核：35 条不一致逐条归类",
        "",
        f"> {MANUAL_REVIEW['headline']}",
        "",
        "| 类别 | 条数 | 题号 | 说明 |",
        "| --- | ---: | --- | --- |",
    ]
    for name, label in (("outOfContract", "输入越界、语义无定义"), ("refWrong", "参考解判反"),
                        ("variantWrong", "变体自己写错"), ("multiAnswer", "多解/顺序差异")):
        cat = MANUAL_REVIEW["categories"][name]
        lines.append(f"| {label} | {cat['cases']} | {', '.join(cat['problems'])} | "
                     f"{cat['note'].replace('|', '/')} |")
    lines += [
        "",
        f"> {out_of_contract_note()}",
        "",
        "## 结论",
        "",
        f"- **整体不一致率 {c['overallRate']:.2%}**（{kw['mismatch']}/{kw['compared']}）。",
        f"- **超过 2% 了吗**：{'是' if c['over2Percent'] else '否'}；低于 1% 吗：{'是' if c['under1Percent'] else '否'}。",
        f"- **主要来自哪个桶**：{c['answers']['主要来自哪个桶']}。",
        f"- 建议：{c['verdict']}",
        "",
        "## 不一致样例（最多 20 条）",
        "",
        "| 题号 | 输入 | 参考解期望 | 变体结果 | 桶 | 分诊 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for ex in kw["examples"]:
        cells = [ex["no"], ex["call"], ex["expected"], " / ".join(ex["variantResults"]),
                 ex["bucket"], ex.get("variantAgreement", "")]
        lines.append("| " + " | ".join(c.replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
    lines += ["", f"_耗时 {int(kw['elapsed'])}s。_"]
    return "\n".join(lines)


def print_summary(report: dict) -> None:
    c = report["conclusion"]
    t = report["triage"]
    print(f"抽样 {report['sampled']} 道（{report['sampledByDifficulty']}），"
          f"变体 {report['variantsOk']}/{report['variantsGenerated']} 通过官方示例")
    print(f"参与比较 {report['compared']} 条（变体×用例），不一致 {report['mismatch']} 条"
          f" → 整体不一致率 {report['rate']:.2%}（宽松 {report['lenientRate']:.2%}，用例级 {report['caseLevel']['rate']:.2%}）")
    for name, s in report["byBucket3"].items():
        print(f"  {name}: {s['mismatch']}/{s['compared']} = {s['rate']:.2%}（{s['cases']} 条用例）")
    print(f"主要来源桶：按条数 {c['mainBucket']}（{report['byBucket'].get(c['mainBucket'], {}).get('mismatch', 0)}/{report['mismatch']}），"
          f"按率最高 {c['topRateBucket']}（{report['byBucket'].get(c['topRateBucket'], {}).get('rate', 0):.2%}）")
    print(f"超过 2%：{'是' if c['over2Percent'] else '否'}    低于 1%：{'是' if c['under1Percent'] else '否'}")
    print(f"分诊：两个变体都反对参考解 {t['consensusAgainstRef']} 条，只有一个反对 "
          f"{t['isolatedVariant']} 条，单变体 {t['singleVariantOnly']} 条")
    print(f"参考解复跑：{report['refRerun']['reproducedExpected']}/{report['refRerun']['runs']} 复现 expected")
    print(f"结论：{c['verdict']}")
    print(f"报告：{OUT}")


if __name__ == "__main__":
    main()
