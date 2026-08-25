# -*- coding: utf-8 -*-
"""Assign strategies to 7/30/60 day lanes by return rank (top→60, mid→30, low→7)."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(r"E:/QuantSite")
path = ROOT / "strategies.json"
data = json.loads(path.read_text(encoding="utf-8"))
rows = data.get("strategies") or []

def score(s):
    m = s.get("metrics") or {}
    apy = m.get("backtest_apy_pct")
    if isinstance(apy, (int, float)):
        return float(apy)
    r = s.get("return_pct")
    if isinstance(r, (int, float)):
        return float(r) * 100
    return -1e9

ranked = sorted(rows, key=score, reverse=True)
n = len(ranked)
for i, s in enumerate(ranked):
    if i < n / 3:
        days = 60
    elif i < 2 * n / 3:
        days = 30
    else:
        days = 7
    s["period_days"] = days
    s["backtest_days"] = days
    m = s.setdefault("metrics", {})
    m["period_days"] = days
    m["disclaimer"] = f"基於 {days} 日回測數據"
    s["disclaimer"] = m["disclaimer"]

path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
from collections import Counter
print(Counter(s["period_days"] for s in rows))
print("updated", path)
