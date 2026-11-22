"""Turn the fetched problem statements into clean plain text for the tutorial writers."""
import html
import json
import os
import re

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
probs = json.load(open(os.path.join(DATA, "tutorial_problems.json"), encoding="utf-8"))


def to_text(h):
    h = re.sub(r"<sup>(.*?)</sup>", r"^\1", h)
    h = re.sub(r"<sub>(.*?)</sub>", r"_\1", h)
    h = re.sub(r"<pre>(.*?)</pre>", lambda m: "\n```\n" + re.sub(r"<[^>]+>", "", m.group(1)) + "\n```\n", h, flags=re.S)
    h = re.sub(r"<li>(.*?)</li>", r"- \1\n", h, flags=re.S)
    h = re.sub(r"<br\s*/?>", "\n", h)
    h = re.sub(r"</p>", "\n\n", h)
    h = re.sub(r"</?strong>", "**", h)
    h = re.sub(r"</?code>", "`", h)
    h = re.sub(r"<[^>]+>", "", h)
    h = html.unescape(h)
    h = re.sub(r"\n{3,}", "\n\n", h)
    return h.strip()


lines = ["# 第一册题面（力扣中文原题，供写作核对）", ""]
order = [
    ("3", "A"), ("567", "A"), ("1004", "A"), ("209", "A"), ("15", "A"), ("1", "A"),
    ("554", "A"), ("560", "A"), ("820", "A"), ("415", "A"), ("56", "A"),
    ("739", "B"), ("20", "B"), ("227", "B"), ("394", "B"), ("316", "B"), ("735", "B"),
    ("19", "C"), ("206", "C"), ("21", "C"), ("146", "C"),
    ("94", "C"), ("102", "C"), ("104", "C"), ("105", "C"), ("200", "C"), ("207", "C"),
    ("5", "D"), ("322", "D"), ("53", "D"), ("300", "D"), ("1143", "D"),
    ("45", "D"), ("55", "D"), ("134", "D"), ("46", "D"), ("22", "D"), ("679", "D"), ("704", "D"),
]
cur = None
for no, vol in order:
    if vol != cur:
        lines.append(f"\n---\n\n# 分册 {vol}\n")
        cur = vol
    p = probs[no]
    lines.append(f"## [{no}] {p['title']}（{p['difficulty']}）\n")
    lines.append(f"slug: `{p['slug']}`\n")
    lines.append(to_text(p["content_html"]))
    if p["examples"]:
        lines.append(f"\n**官方示例输入**：\n```\n{p['examples']}\n```")
    lines.append("\n")

out = os.path.join(DATA, "题面-第一册.md")
open(out, "w", encoding="utf-8").write("\n".join(lines))
print("wrote", out, os.path.getsize(out), "bytes")
