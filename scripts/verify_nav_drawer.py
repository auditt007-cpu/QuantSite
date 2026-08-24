#!/usr/bin/env python3
"""Sanity-check mobile nav drawer stacking / mask rules."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []

# 1) No active body::before drawer mask in any CSS
for p in ROOT.rglob("*.css"):
    if "node_modules" in p.parts:
        continue
    t = p.read_text(encoding="utf-8", errors="ignore")
    for m in re.finditer(r"(body[^{\n]*nav-drawer[^{\n]*::before)\s*\{([^}]*)\}", t, re.I | re.S):
        sel, body = m.group(1), m.group(2)
        if re.search(r"content\s*:\s*none", body):
            continue
        if re.search(r"content\s*:\s*[\"']{0,2}[\"']", body) or 'content: ""' in body or "content:''" in body:
            errors.append(f"ACTIVE body::before mask in {p}: {sel}")

# 2) mobile-global must host backdrop inside topbar
mg = (ROOT / "css/mobile-global.css").read_text(encoding="utf-8")
for needle in [
    ".topbar > .nav-drawer-backdrop",
    "body > .nav-drawer-backdrop",
    "button:not(.nav-drawer-backdrop)",
    "position: fixed !important",
    "z-index: 10000 !important",
]:
    if needle not in mg:
        errors.append(f"mobile-global.css missing: {needle}")

# 3) nav.js must insert into .topbar
nav = (ROOT / "js/nav.js").read_text(encoding="utf-8")
if "bar.insertBefore(bd" not in nav:
    errors.append("nav.js must insert backdrop into .topbar")
if "bd.parentElement !== bar" not in nav:
    errors.append("nav.js must migrate legacy body-level backdrop")

# 4) All main HTML pages load mobile-global + nav.js
htmls = [
    "index.html", "terminal.html", "live.html", "member.html",
    "about.html", "affiliate.html", "ai-backtest.html", "admin.html",
]
for name in htmls:
    t = (ROOT / name).read_text(encoding="utf-8")
    if "mobile-global.css" not in t:
        errors.append(f"{name} missing mobile-global.css")
    if "js/nav.js" not in t:
        errors.append(f"{name} missing nav.js")

if errors:
    print("FAIL")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("PASS: nav drawer invariants OK across CSS/JS/HTML")
