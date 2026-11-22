"""给 Hot 100 生成「非常详细」的讲解（预生成，存成 markdown）。

为什么要预生成：运行时的 AI 解析是 600 字速览，够用但不够「教」；
Hot 100 是最值得反复读的一批题，所以让模型读完整题面后写一篇 2000-3000 字的详解，
直接落盘成数据，打开就能看，不用等、也不花运行时 token。

输出：data/teachings/<题号>.md（可断点续跑，已有文件跳过）
然后跑 tools/build_web_data.py 会把它汇编成 app/public/data/teachings.json

用法：
    python tools/gen_teachings.py --limit 2        # 先试两道
    python tools/gen_teachings.py                  # 生成全部缺的
    python tools/gen_teachings.py --workers 3
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "teachings"
ENV = ROOT / "app" / ".env.local"

API = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"
MAX_TOKENS = 4096
TIMEOUT = 240

SYSTEM = (
    "你是一位带过很多学员的算法面试教练。你写东西的原则是：讲清楚「为什么」，"
    "而不是罗列「是什么」；每个结论都要能在题面上找到依据。"
    "读者学过 Python，但算法基础薄弱，看到题经常「不知道从哪下手」。"
    "你的任务是把这道题从「看不懂」讲到「能自己写出来、还能讲给别人听」。"
)

TEMPLATE = """## 题目
题号：{no}　标题：{title}（{level}）
标签：{tags}
通过率：{ac_rate}
函数签名：Solution.{method}({params}) -> {returns}

## 题面（力扣中文原文，已转纯文本）
{statement}

## 官方示例
{examples}

## 输出要求
写一篇**可以直接拿去教学**的中文详解，Markdown，1800-3000 字。严格按下面九节，节标题用 `## `：

## 1. 一句话本质
用一句话说清这道题在求什么（不要复述题面）。

## 2. 读完题的第一反应
- 朴素解法是什么，它卡在哪（复杂度瓶颈）
- 关键的观察是什么，为什么它能让你想到下一步

## 3. 从暴力到最优
每一步的瓶颈怎么被消掉，配一个**具体的小例子**走一遍（写出中间变量的值）。

## 4. 正确性：为什么不会漏、不会重
用「不变量」或「交换论证」这类明确的说法讲清楚，不要只说「显然正确」。

## 5. 完整代码（Python）
```python
# 符合上面给定的签名，能直接运行
```
代码里每一段关键逻辑要有中文注释。

## 6. 复杂度
时间和空间各是多少，**每一项怎么来的**（谁贡献了 n、谁贡献了 log n）。

## 7. 边界与反例（至少 4 条）
每条写成：输入 → 期望输出 → 为什么容易错。

## 8. 面试追问与变体（3 条）
每条：追问是什么 + 一句话思路。

## 9. 举一反三（2-3 道同类题）
题名 + 和本题的共同点（一句话）。

## 硬性要求
- 不要写「综上所述」「希望对你有帮助」这类客套话
- 不要大段复述题面原文（超过两句就算失败）
- 代码必须是真代码，不许伪代码
- 如果题面信息不足以确定题意，明确写出你的假设
"""


def api_key() -> str:
    text = ENV.read_text(encoding="utf-8-sig")
    m = re.search(r"DEEPSEEK_API_KEY\s*=\s*(\S+)", text)
    if not m:
        raise SystemExit("app/.env.local 里没有 DEEPSEEK_API_KEY")
    return m.group(1)


def html_to_text(html: str) -> str:
    if not html:
        return ''
    text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|li|pre|h[1-6]|tr)>", "\n", text, flags=re.I)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.I)
    text = re.sub(r"<sup>(.*?)</sup>", r"^\1", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    for src, dst in [
        ("&nbsp;", " "),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", '"'),
        ("&#39;", "'"),
        ("&amp;", "&"),
    ]:
        text = text.replace(src, dst)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def build_prompt(no: str, raw: dict, catalog_item: dict) -> str:
    html = raw.get("translatedContent") or raw.get("content") or ""
    statement = html_to_text(html)
    if len(statement) > 6000:
        statement = statement[:6000] + "\n…（题面过长，后面省略）"

    examples = []
    for block in re.findall(r"<pre>(.*?)</pre>", html, flags=re.S):
        text = html_to_text(block)
        if text and ("输入" in text or "Input" in text):
            examples.append(text)
    examples_text = "\n\n".join(f"示例 {i + 1}\n{ex}" for i, ex in enumerate(examples[:4])) or "（题面未提供示例）"

    meta = {}
    try:
        meta = json.loads(raw.get("metaData") or "{}")
    except json.JSONDecodeError:
        pass
    method = meta.get("name") or "solve"
    params = ", ".join(p.get("name", "") for p in (meta.get("params") or [])) or "..."

    return TEMPLATE.format(
        no=no,
        title=raw.get("translatedTitle") or catalog_item.get("title") or "",
        level={"EASY": "简单", "MEDIUM": "中等", "HARD": "困难"}.get(
            (catalog_item.get("level") or "").upper(), "中等"
        ),
        tags=" / ".join(catalog_item.get("tags") or []) or "无",
        ac_rate=f"{(catalog_item.get('ac_rate') or 0) * 100:.1f}%",
        method=method,
        params=params,
        returns=(meta.get("return") or {}).get("type", "?"),
        statement=statement or "（题面未收录）",
        examples=examples_text,
    )


def call_api(key: str, prompt: str, retries: int = 4) -> str:
    payload = json.dumps(
        {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "temperature": 0.35,
            "max_tokens": MAX_TOKENS,
        }
    ).encode()
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
            content = data["choices"][0]["message"]["content"]
            return content.strip()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()[:200]
            if exc.code in (429, 500, 502, 503, 504):
                time.sleep(4 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {exc.code}: {body}") from exc
        except Exception as exc:  # noqa: BLE001
            time.sleep(3 * (attempt + 1))
            if attempt == retries - 1:
                raise RuntimeError(str(exc)) from exc
    raise RuntimeError("重试次数用尽")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    key = api_key()
    hot = json.loads((DATA / "lc_hot100.json").read_text(encoding="utf-8-sig"))
    statements = json.loads((DATA / "statements_full.json").read_text(encoding="utf-8"))
    catalog = {
        str(item["no"]).strip(): item
        for item in json.loads((DATA / "lc_catalog.json").read_text(encoding="utf-8"))
    }
    OUT.mkdir(parents=True, exist_ok=True)

    todo = []
    for item in hot:
        no = str(item["no"]).strip()
        path = OUT / f"{no}.md"
        if path.exists() and path.stat().st_size > 800:
            continue
        raw = statements.get(no) or {}
        if not raw or not (raw.get("translatedContent") or raw.get("content")):
            print(f"  skip {no}（没有题面）", flush=True)
            continue
        todo.append((no, raw, catalog.get(no, {})))
    if args.limit:
        todo = todo[: args.limit]

    print(f"hot100={len(hot)} todo={len(todo)}", flush=True)
    started = time.time()
    lock = threading.Lock()
    done = 0

    def work(item):
        no, raw, cat = item
        prompt = build_prompt(no, raw, cat)
        text = call_api(key, prompt)
        if len(text) < 800:
            raise RuntimeError(f"输出过短（{len(text)} 字）")
        (OUT / f"{no}.md").write_text(text + "\n", encoding="utf-8")
        return no, len(text)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, item): item[0] for item in todo}
        for future in as_completed(futures):
            no = futures[future]
            try:
                _, size = future.result()
                with lock:
                    done += 1
                    print(f"  ok {no} ({size} 字)  {done}/{len(todo)}", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"  FAIL {no}: {exc}", flush=True)

    print(f"done in {round(time.time() - started)}s, files={len(list(OUT.glob('*.md')))}", flush=True)


if __name__ == "__main__":
    main()
