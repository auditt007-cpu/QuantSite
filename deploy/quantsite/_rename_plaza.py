# -*- coding: utf-8 -*-
from pathlib import Path

replacements = [
    ("策略廣場", "策略榜"),
    ("策略广场", "策略榜"),
    ("Strategy Plaza", "Strategy Board"),
    ("回測模型廣場", "策略榜"),
    ("回测模型广场", "策略榜"),
    ("Backtest model plaza", "Strategy Board"),
    ("策略廣場已載入 {n} 套 AI 新挖策略（置頂展示）", "策略榜已載入 {n} 套策略（按回測窗口分類）"),
    ("策略广场已载入 {n} 套 AI 新挖策略（置顶展示）", "策略榜已载入 {n} 套策略（按回测窗口分类）"),
    ("Plaza loaded {n} AI-mined strategies (pinned on top)", "Board loaded {n} strategies (grouped by backtest window)"),
    ("點擊任一列進入策略廣場", "點擊任一列進入策略榜"),
    ("点击任一列进入策略广场", "点击任一列进入策略榜"),
]

# i18n keys specifically
i18n = Path(r"E:/QuantSite/i18n.js")
t = i18n.read_text(encoding="utf-8")
for a, b in replacements:
    t = t.replace(a, b)
i18n.write_text(t, encoding="utf-8")
print("i18n updated")

html_files = [
    "strategies.html",
    "index.html",
    "bots.html",
    "live.html",
    "member.html",
    "about.html",
    "affiliate.html",
    "ai-backtest.html",
    "admin.html",
    "marketplace.html",
    "terminal.html",
    "backtest.html",
]
for name in html_files:
    p = Path(r"E:/QuantSite") / name
    if not p.exists():
        continue
    raw = p.read_text(encoding="utf-8")
    out = raw
    for a, b in replacements:
        out = out.replace(a, b)
    if out != raw:
        p.write_text(out, encoding="utf-8")
        print("html", name)

for rel in ["js/compliance.js", "js/plaza-ai.js"]:
    p = Path(r"E:/QuantSite") / rel
    raw = p.read_text(encoding="utf-8")
    out = raw
    for a, b in replacements:
        out = out.replace(a, b)
    if out != raw:
        p.write_text(out, encoding="utf-8")
        print("js", rel)
