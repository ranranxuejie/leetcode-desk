"""给「没有长精讲」的题生成短解析（800-1200 字），存 data/analyses/<题号>.md。

为什么要分两档：
- data/teachings/ 是 Hot 100 的长精讲（1800-3000 字，含完整代码、正确性证明、举一反三），
  只有 100 篇 —— 每篇都贵，而且只有最值得反复读的题才配得上这种密度；
- data/analyses/ 是其余题的短解析（800-1200 字），目标是「30 秒看懂思路、别踩坑」：
  只给关键片段，不重复 data/ref_solutions/ 里已经有的完整可提交代码。
  全库 4000+ 道题都铺上，前端随便点开一道都有解析可看。

复用选择：
- html_to_text / api_key 直接从 gen_teachings 导入（纯函数、无副作用，改一处两处都受益）；
- call_api 在这里重写一份：温度（0.3 vs 0.35）、max_tokens（2000 vs 4096）和 system prompt
  都不一样，而 gen_teachings 是**正在用**的脚本，改它的 call_api 签名会动到 Hot 100 的
  既有生成行为。各留一份、互不影响，比「加一堆可选参数」安全。

输出：data/analyses/<题号>.md（已有且 > 400 字节就跳过，可断点续跑）
之后跑 tools/build_web_data.py 可以把它汇编进前端数据（那一步不归本脚本管）。

用法：
    python tools/gen_analyses.py --limit 5 --workers 2      # 先试 5 道
    python tools/gen_analyses.py --scope selected           # 只做 master.json 的 352 道
    python tools/gen_analyses.py --scope rest               # 只做 master.json 以外的
    python tools/gen_analyses.py --only 1,2,3               # 只做这几道
    python tools/gen_analyses.py --scope all --dry-run      # 只看会跑哪些题，不花钱
    python tools/gen_analyses.py                            # 全量（scope 默认 all，可断点续跑）

scope：
    all       = statements_full.json 里全部「有题面」的题（约 3700 道）
    selected  = data/master.json 里的精选（352 道）
    rest      = 有题面的题里，去掉 master.json 的那些
    三种 scope 都会自动跳过 data/teachings/ 里已经有长精讲的题（不重复写）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# 同目录导入 gen_teachings：复用它的 html_to_text / api_key（纯函数，import 不会触发 main）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_teachings import api_key, html_to_text  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "analyses"
TEACHINGS = DATA / "teachings"
MASTER = DATA / "master.json"

API = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"
TEMPERATURE = 0.3
MAX_TOKENS = 2000
TIMEOUT = 180

MIN_CHARS = 500        # 低于这个字数算失败，重试
MAX_CHARS = 2000       # 高于这个字数截断（硬上限）
SOFT_MAX_CHARS = 1400  # 高于这个字数先要求压缩重试一次；还是超就截断落盘，不丢题
MIN_FILE_BYTES = 400   # 断点续跑：已有文件大于这个字节数就跳过
MAX_CODE_LINES = 20    # prompt 里承诺「代码片段合计不超过 20 行」，超过 26 行判失败重试
ATTEMPTS = 3           # 单题最多试几次（不合格才重试）

LEVEL_TO_CATALOG = {"简单": "EASY", "中等": "MEDIUM", "困难": "HARD"}

SYSTEM = (
    "你是算法面试教练，擅长用最短的篇幅把一道题讲到点子上。"
    "你写的不是教程，是「速览」：读者已经会写代码，缺的是「第一步该想到什么」和「哪里会翻车」。"
    "你的原则是具体优先——每个结论都必须落到这道题的变量名、具体输入和中间值上，"
    "凡是换个题也能用的空话，一律不写。"
)

TEMPLATE = """题号：{no}　标题：{title}（{level}）
标签：{tags}
通过率：{ac_rate}
函数签名：Solution.{method}({params}) -> {returns}

## 题面（力扣中文原文，已转纯文本）
{statement}

## 官方示例
{examples}

## 输出要求
写一份**短解析**，Markdown，全文 800-1200 字。严格按下面 5 节，节标题就用这五个词
（不要在标题里加括号、字数、英文），每节的字数预算写在该节说明后面的〔〕里：

## 一句话思路
〔1 句，≤50 字〕说清用什么方法、为什么这个方法成立。不许复述题面。

## 怎么做
〔350-450 字，含代码〕
3-4 个编号步骤，每步只写 1 句话（不要每步都补充第二句解释）。
必须挑**一个具体的输入**（优先用官方示例），用 1-2 句话写出最关键那一步的中间变量值。
至少给一段 ```python 代码片段（除非这道题确实没有可写的代码，比如纯设计题），片段合计 ≤15 行。

## 复杂度
〔2 行，≤80 字〕时间、空间各一行，说清「谁贡献了 n、谁贡献了 log n、额外开了什么」。

## 易错点
〔2 条，共 200-280 字〕每条写成「什么输入 → 会错成什么 → 正确做法」，必须是这道题特有的坑。

## 如果面试官追问
〔1 问 1 答，≤100 字〕延伸追问 + 一句话答法（换约束 / 换数据规模 / 要求输出方案，任选其一）。

## 硬性要求
- **字数优先**：全文超过 1200 字会被判失败重写。写完自己数一遍，超了就删掉所有解释性的第二句、所有形容词和铺垫。
- **全篇 Python**：代码片段一律用 ```python 围栏，语法是 Python（`True`/`False`/`None`、`//` 整除、`and`/`or`/`not`）。
  不许用 Java/C++ 写法：不要出现 `INT_MAX`、`INT_MIN`、`StringBuilder`、`Long.MAX_VALUE`，
  不要用 `false`/`true`/`null` 这种小写字面量，不要用 `x /= 10` 表示整除。
  提到 32 位上限就写 `2**31 - 1` / `-2**31`。
- **Python 整数不会溢出**：凡是涉及溢出的易错点，要写成「题目规定答案按 32 位截断」，
  不许写成「Python 里 `rev * 10` 会溢出」—— 那是 C++/Java 的事实，不是 Python 的。
- **不要输出完整可提交代码**：禁止出现 `class Solution`，禁止完整函数定义；参考解已经有了，这里只讲关键那几行。
- 不要写「综上所述」「希望对你有帮助」「这是一道经典的…题」这类套话；不要用「不难看出」「我们可以发现」开头。
- 不要大段复述题面（超过两句算失败）。
- 每条结论都要落在本题的具体变量名 / 具体数据上；写不出具体的就删掉，不许用「根据实际情况」糊过去。
- 题面信息不足以确定题意时，用一句话写明你的假设，然后继续。
"""

REQUIRED_SECTIONS = ["一句话思路", "怎么做", "复杂度", "易错点", "追问"]

# C++/Java 写法：模型偶尔会退回 LeetCode 的 C++ 惯性，而这个项目全链路是 Python
CPP_IDIOM_RE = re.compile(r"\bINT_MAX\b|\bINT_MIN\b|\bStringBuilder\b|\bLong\.(?:MAX|MIN)_VALUE\b")
BAD_FENCE_RE = re.compile(r"```(?:text|java|cpp|c\+\+|js|javascript)\b")

# ---------------------------------------------------------------- 用量统计
_usage_lock = threading.Lock()
USAGE = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0}


def _add_usage(usage: dict) -> None:
    with _usage_lock:
        USAGE["calls"] += 1
        USAGE["prompt_tokens"] += int((usage or {}).get("prompt_tokens") or 0)
        USAGE["completion_tokens"] += int((usage or {}).get("completion_tokens") or 0)


# ---------------------------------------------------------------- 题源
def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def master_catalog_item(item: dict) -> dict:
    """master.json 的一条拼成和 lc_catalog.json 同形状（只在 catalog 缺这道题时兜底）。

    level 是中文，要换成 lc_catalog 的英文枚举，否则 build_prompt 会一律落到「中等」；
    ac_rate 是百分数（43.1），lc_catalog 是小数（0.4309），除 100 对齐。
    """
    return {
        "no": str(item.get("no") or "").strip(),
        "title": item.get("title") or "",
        "level": LEVEL_TO_CATALOG.get(str(item.get("level") or "").strip(), "MEDIUM"),
        "ac_rate": (item.get("ac_rate") or 0) / 100,
        "tags": item.get("tags") or [],
    }


def sort_key(no: str):
    """题号排序：数字题号按大小，非数字（LCR/面试题）排后面。"""
    return (0, int(no), "") if no.isdigit() else (1, 0, no)


def has_statement(raw: dict) -> bool:
    return bool((raw or {}).get("translatedContent") or (raw or {}).get("content"))


def build_targets(scope: str, full: dict, catalog: dict, master_nos: set[str],
                  teachings: set[str]) -> tuple[list[tuple[str, dict, dict]], dict]:
    """按 scope 挑题；返回 (todo, 统计)。已有长精讲 / 没题面的题在这里被剔掉。"""
    if scope == "selected":
        pool = set(master_nos)
    elif scope == "rest":
        pool = set(full) - set(master_nos)
    else:
        pool = set(full)

    todo: list[tuple[str, dict, dict]] = []
    skipped_teaching = 0
    skipped_no_statement = 0
    for no in sorted(pool, key=sort_key):
        if no in teachings:
            skipped_teaching += 1
            continue
        raw = full.get(no) or {}
        if not has_statement(raw):
            skipped_no_statement += 1
            continue
        cat = catalog.get(no) or {}
        todo.append((no, raw, cat))

    return todo, {
        "scope": scope,
        "candidates": len(pool),
        "skipExisting": skipped_teaching,
        "skipNoStatement": skipped_no_statement,
    }


# ---------------------------------------------------------------- prompt
def extract_examples(html: str) -> str:
    """题面里的示例：新格式 example-block 和老的 <pre> 都收，去重后最多 3 条。"""
    chunks: list[str] = []
    for block in re.findall(r'<div class="example-block">([\s\S]*?)</div>', html):
        text = html_to_text(block)
        if text:
            chunks.append(text)
    for block in re.findall(r"<pre>(.*?)</pre>", html, flags=re.S):
        text = html_to_text(block)
        if text and ("输入" in text or "Input" in text):
            chunks.append(text)
    seen: set[str] = set()
    unique: list[str] = []
    for chunk in chunks:
        text = re.sub(r"\n{2,}", "\n", chunk).strip()
        if text and text not in seen:
            seen.add(text)
            unique.append(text)
    return "\n\n".join(f"示例 {i + 1}\n{ex}" for i, ex in enumerate(unique[:3])) or "（题面未提供示例）"


def method_of(raw: dict) -> str:
    """题面 metaData 里的方法名；设计题 / SQL 题没有，返回空串。"""
    meta = (raw or {}).get("metaData")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except (json.JSONDecodeError, TypeError):
            return ""
    if not isinstance(meta, dict):
        return ""
    return str(meta.get("name") or "").strip()


def build_prompt(no: str, raw: dict, catalog_item: dict) -> str:
    html = raw.get("translatedContent") or raw.get("content") or ""
    statement = html_to_text(html)
    if len(statement) > 4500:
        statement = statement[:4500] + "\n…（题面过长，后面省略）"

    meta: dict = {}
    try:
        meta = json.loads(raw.get("metaData") or "{}")
    except (json.JSONDecodeError, TypeError):
        pass
    if not isinstance(meta, dict):
        meta = {}
    method = meta.get("name") or "solve"
    params = ", ".join(p.get("name", "") for p in (meta.get("params") or [])) or "..."

    return TEMPLATE.format(
        no=no,
        title=raw.get("translatedTitle") or catalog_item.get("title") or "",
        level={"EASY": "简单", "MEDIUM": "中等", "HARD": "困难"}.get(
            str(catalog_item.get("level") or "").upper(), "中等"
        ),
        tags=" / ".join(catalog_item.get("tags") or []) or "无",
        ac_rate=f"{(catalog_item.get('ac_rate') or 0) * 100:.1f}%",
        method=method,
        params=params,
        returns=(meta.get("return") or {}).get("type", "?"),
        statement=statement or "（题面未收录）",
        examples=extract_examples(html),
    )


# ---------------------------------------------------------------- DeepSeek
def call_api(key: str, prompt: str, retries: int = 4) -> str:
    payload = json.dumps(
        {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "temperature": TEMPERATURE,
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
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                data = json.loads(res.read().decode())
            _add_usage(data.get("usage") or {})
            return data["choices"][0]["message"]["content"].strip()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()[:200]
            last = f"HTTP {exc.code}: {body}"
            if exc.code in (429, 500, 502, 503, 504):
                time.sleep(4 * (attempt + 1))
                continue
            break
        except Exception as exc:  # noqa: BLE001
            last = str(exc)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(last or "API 失败")


# ---------------------------------------------------------------- 校验 / 落盘
def code_lines(text: str) -> int:
    return sum(
        len(block.splitlines())
        for block in re.findall(r"```[^\n]*\n([\s\S]*?)```", text)
    )


# 模型偶尔把「字数预算」抄进节标题（`## 怎么做（350-450 字）`）：前端会原样显示，统一洗干净
HEADING_FIX_RE = re.compile(
    r"^(#{1,3}\s*)(一句话思路|怎么做|复杂度|易错点|如果面试官追问)\s*[（(〔\[].*$", re.M
)


def clean_headings(text: str) -> str:
    return HEADING_FIX_RE.sub(r"\1\2", text)


def check(text: str, require_code: bool) -> str:
    """不合格就返回原因（会重试）；合格返回空串。"""
    if len(text) < MIN_CHARS:
        return f"太短（{len(text)} 字，要求 800-1200，下限 {MIN_CHARS}）"
    if len(text) > SOFT_MAX_CHARS:
        return f"太长（{len(text)} 字，目标 800-1200，按每节预算压缩）"
    headings = re.findall(r"^#{1,3}\s*(.+)$", text, flags=re.M)
    missing = [name for name in REQUIRED_SECTIONS if not any(name in h for h in headings)]
    if missing:
        return "缺少小节：" + "、".join(missing)
    if "class Solution" in text:
        return "输出了完整可提交代码（出现了 class Solution）"
    lines = code_lines(text)
    if lines > MAX_CODE_LINES + 6:
        return f"代码片段太长（{lines} 行，上限 {MAX_CODE_LINES} 行）"
    if BAD_FENCE_RE.search(text):
        return "代码片段用了 text/java/cpp 围栏，必须用 ```python"
    if require_code and "```python" not in text:
        return "没有 ```python 关键代码片段"
    if CPP_IDIOM_RE.search(text):
        return "用了 C++/Java 写法（INT_MAX / StringBuilder 等），要改成 Python"
    return ""


def trim(text: str) -> str:
    """> 2000 字截断：优先在行尾切，别切在句子中间。"""
    if len(text) <= MAX_CHARS:
        return text
    cut = text[:MAX_CHARS]
    line_break = cut.rfind("\n")
    if line_break > MAX_CHARS * 0.8:
        cut = cut[:line_break]
    return cut.rstrip() + "\n\n…（超过 2000 字，已截断）"


def work(key: str, item: tuple[str, dict, dict]) -> tuple[str, int, int]:
    """单题：生成 -> 校验 -> 不合格重试 -> 截断 -> 落盘。返回 (题号, 字数, 尝试次数)。"""
    no, raw, cat = item
    prompt = build_prompt(no, raw, cat)
    require_code = bool(method_of(raw))
    reason = ""
    for attempt in range(ATTEMPTS):
        ask = prompt
        if reason:
            # 重试提示必须短：塞一大段说明会让模型写得更长（实测 5 篇平均 1551 → 1790 字）
            ask = prompt + f"\n（上一版不合格：{reason}。这次压缩到 1000 字左右，直接输出正文。）\n"
        text = clean_headings(call_api(key, ask).strip())
        reason = check(text, require_code)
        if not reason:
            text = trim(text)
            (OUT / f"{no}.md").write_text(text + "\n", encoding="utf-8")
            return no, len(text), attempt + 1
        # 只是超长的话，重试到底还是超长就截断落盘：宁可长一点，也别让这道题没有解析
        if reason.startswith("太长") and attempt == ATTEMPTS - 1:
            text = trim(text)
            (OUT / f"{no}.md").write_text(text + "\n", encoding="utf-8")
            return no, len(text), attempt + 1
    raise RuntimeError(reason or "生成失败")


# ---------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument(
        "--scope",
        choices=["all", "selected", "rest"],
        default="all",
        help="all=全部有题面的；selected=master.json 精选；rest=有题面的题里去掉 master.json",
    )
    ap.add_argument("--only", default="", help="只处理这些题号（逗号分隔）")
    ap.add_argument("--dry-run", action="store_true", help="只打印会处理哪些题，不调用模型")
    args = ap.parse_args()

    full = load_json(DATA / "statements_full.json")
    catalog = {str(item["no"]).strip(): item for item in load_json(DATA / "lc_catalog.json")}
    master = load_json(MASTER) if MASTER.exists() else []
    master_nos = {str(item.get("no") or "").strip() for item in master if str(item.get("no") or "").strip()}
    # catalog 缺 master 里的少数题：用 master 的字段补上（只影响这些题，别的题一个字段都不动）
    for item in master:
        no = str(item.get("no") or "").strip()
        if no and no not in catalog:
            catalog[no] = master_catalog_item(item)

    teachings = {path.stem for path in TEACHINGS.glob("*.md")} if TEACHINGS.exists() else set()

    todo, info = build_targets(args.scope, full, catalog, master_nos, teachings)
    if args.only:
        wanted = {part.strip() for part in args.only.split(",") if part.strip()}
        todo = [item for item in todo if item[0] in wanted]
        info["only"] = len(wanted)

    OUT.mkdir(parents=True, exist_ok=True)
    existing = {path.stem for path in OUT.glob("*.md") if path.stat().st_size > MIN_FILE_BYTES}
    skipped = 0
    pending = []
    for item in todo:
        if item[0] in existing:
            skipped += 1
            continue
        pending.append(item)
    if args.limit:
        pending = pending[: args.limit]

    if args.dry_run:
        print(
            json.dumps(
                {
                    "scope": args.scope,
                    "candidates": info["candidates"],
                    "todo": len(todo),
                    "skipExisting": skipped + info["skipExisting"],
                    "skipNoStatement": info["skipNoStatement"],
                    "willGenerate": len(pending),
                    "sample": [item[0] for item in pending[:30]],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        return

    print(
        f"scope={args.scope} candidates={info['candidates']} todo={len(todo)} "
        f"existing={skipped} teachings-skip={info['skipExisting']} "
        f"no-statement={info['skipNoStatement']} willGenerate={len(pending)}",
        flush=True,
    )
    if not pending:
        print("没有要生成的题（全部已存在）", flush=True)
        return

    key = api_key()
    started = time.time()
    lock = threading.Lock()
    stats = {"ok": 0, "fail": 0, "chars": 0, "retries": 0}
    done = 0

    def run(item):
        return work(key, item)

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(run, item): item[0] for item in pending}
        for future in as_completed(futures):
            no = futures[future]
            with lock:
                done += 1
                try:
                    _, size, attempts = future.result()
                    stats["ok"] += 1
                    stats["chars"] += size
                    stats["retries"] += attempts - 1
                    print(f"  ok {no} ({size} 字, 试 {attempts} 次)  {done}/{len(pending)}", flush=True)
                except Exception as exc:  # noqa: BLE001
                    stats["fail"] += 1
                    print(f"  FAIL {no}: {exc}  {done}/{len(pending)}", flush=True)

    elapsed = round(time.time() - started)
    total = len(todo)
    print(
        "\n===== 统计 =====\n"
        f"总数：{total}（scope={args.scope} 候选 {info['candidates']}）\n"
        f"成功：{stats['ok']}\n"
        f"失败：{stats['fail']}\n"
        f"跳过：{skipped + info['skipExisting'] + info['skipNoStatement']}"
        f"（已有文件 {skipped} / 已有长精讲 {info['skipExisting']} / 无题面 {info['skipNoStatement']}）\n"
        f"总字数：{stats['chars']}"
        f"（平均 {round(stats['chars'] / stats['ok']) if stats['ok'] else 0} 字/篇，重试 {stats['retries']} 次）\n"
        f"耗时：{elapsed}s　API 调用：{USAGE['calls']} 次　"
        f"token：输入 {USAGE['prompt_tokens']} / 输出 {USAGE['completion_tokens']}",
        flush=True,
    )


if __name__ == "__main__":
    main()
