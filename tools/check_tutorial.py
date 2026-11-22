"""Quality gate for the tutorial markdown files.

- extracts every ```python block and exec()s it (syntax + import-time errors)
- scans for banned phrases
- reports section counts
"""
import glob
import io
import os
import re
import sys
import textwrap
import traceback

ROOT = os.path.join(os.path.dirname(__file__), "..")
TUT = os.path.join(ROOT, "教程")

PRELUDE = """
from typing import List, Optional, Dict, Set, Tuple, Any
from collections import deque, Counter, defaultdict, OrderedDict
import heapq, bisect, math, itertools, functools, re, string

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
"""

BANNED = ["显然", "自行验证", "众所周知", "不用多说", "读者可以自行"]


def check_file(path):
    text = open(path, encoding="utf-8").read()
    blocks = re.findall(r"```python\n(.*?)```", text, flags=re.S)
    errors = []
    ok = 0
    checked = 0
    for i, b in enumerate(blocks, 1):
        g = {"__name__": "__tutorial__"}
        src = textwrap.dedent(b)
        # 只校验"完整解法"代码块；骨架/错误示范/伪代码片段不参与
        if "class Solution" not in src and "class " not in src:
            continue
        checked += 1
        try:
            exec(PRELUDE + src, g)
            ok += 1
        except Exception as e:
            errors.append((i, type(e).__name__, str(e)[:160], src.splitlines()[:3]))
    banned = [w for w in BANNED if w in text]
    sections = len(re.findall(r"^##\s+\S", text, flags=re.M))
    return {
        "file": os.path.basename(path),
        "size_kb": round(os.path.getsize(path) / 1024, 1),
        "sections": sections,
        "code_blocks": len(blocks),
        "exec_ok": ok,
        "errors": errors,
        "banned": banned,
    }


def main():
    files = sorted(glob.glob(os.path.join(TUT, "*.md")))
    total_err = 0
    for f in files:
        r = check_file(f)
        status = "OK " if not r["errors"] and not r["banned"] else "!! "
        print(f"{status}{r['file']:<44} {r['size_kb']:>6}KB  sections={r['sections']:>2}  code={r['code_blocks']:>2}  exec_ok={r['exec_ok']:>2}")
        if r["banned"]:
            print(f"     banned words: {r['banned']}")
        for i, t, msg, head in r["errors"]:
            total_err += 1
            print(f"     block#{i} {t}: {msg}")
            print(f"       >>> {head}")
    print(f"\nTOTAL syntax/import errors: {total_err}")


if __name__ == "__main__":
    main()
