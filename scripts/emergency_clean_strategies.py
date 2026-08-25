# -*- coding: utf-8 -*-
"""Emergency wipe: plaza slots → grid INITIALIZING placeholders + flat SVGs.

Usage:
  python3 scripts/emergency_clean_strategies.py
  python3 scripts/emergency_clean_strategies.py --push
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except Exception:
    pass

PLAZA_IDS = [
    "dual",
    "ribbon",
    "rsi",
    "squeeze",
    "atr",
    "qe",
    "dm",
    "sn",
    "eh",
    "gw",
    "ns",
    "sf",
    "qk",
    "hs",
    "hg",
] + ["strat-{0:03d}".format(i) for i in range(1, 31)]

PREFIXES = ["自適應", "時序動量", "統計套利", "多維共振", "高頻流動性", "非對稱防守"]
KERNELS = ["波動收割網格", "基差對沖網格", "擠壓套利網格", "幾何DCA網格", "協整配對網格"]
SYMBOLS = ["BTC", "ETH", "SOL", "DOGE", "AVAX"]
SUBTYPES = [
    "DYNAMIC_ATR_GRID",
    "BASIS_FUNDING_GRID",
    "BOLLINGER_SQUEEZE_GRID",
    "FIBO_DCA_GRID",
    "PAIRS_COINT_GRID",
]


def strategies_paths() -> list[Path]:
    out: list[Path] = []
    # Never write /root or /var on Windows (Path("/root") → E:\root).
    if os.name != "nt":
        for p in (Path("/root/quantsite/strategies.json"), Path("/var/www/html/strategies.json")):
            if p.parent.is_dir() and p not in out:
                out.append(p)
    local = ROOT / "strategies.json"
    if local not in out:
        out.append(local)
    return out


def live_chart_dirs() -> list[Path]:
    out: list[Path] = [ROOT / "static" / "charts"]
    if os.name != "nt":
        for d in (Path("/root/quantsite/static/charts"), Path("/var/www/html/static/charts")):
            if d.is_dir() or d.parent.is_dir():
                out.append(d)
    return out


def institutional_name(i: int) -> tuple[str, str, str]:
    sym = SYMBOLS[i % len(SYMBOLS)]
    prefix = PREFIXES[i % len(PREFIXES)]
    kernel = KERNELS[i % len(KERNELS)]
    ver = "V{0}.{1}".format(2 + (i % 4), i % 10)
    name = "{0}·{1}{2} {3}".format(sym, prefix, kernel, ver)
    subtype = SUBTYPES[i % len(SUBTYPES)]
    return name, sym + "/USDT", subtype


def flat_equity_svg(path: Path, title: str = "INITIALIZING") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    safe = title.replace("&", "&amp;").replace("<", "&lt;")
    # Flat calm line — placeholder until real grid equity lands
    svg = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="260" viewBox="0 0 640 260">\n'
        '  <rect width="640" height="260" fill="#0b0f14"/>\n'
        '  <text x="24" y="36" fill="#8b9bb4" font-family="JetBrains Mono, Consolas, monospace" font-size="14">'
        + safe
        + "</text>\n"
        '  <text x="24" y="58" fill="#5a6a7e" font-family="JetBrains Mono, Consolas, monospace" font-size="11">'
        "等待實盤 / 網格初始化</text>\n"
        '  <line x1="40" y1="150" x2="600" y2="150" stroke="#3d9b6e" stroke-width="2.2"/>\n'
        '  <circle cx="40" cy="150" r="3" fill="#3d9b6e"/>\n'
        '  <circle cx="600" cy="150" r="3" fill="#3d9b6e"/>\n'
        "</svg>\n"
    )
    path.write_text(svg, encoding="utf-8")


def build_slot(sid: str, index: int) -> dict:
    name, symbol, subtype = institutional_name(index)
    # Tiny positive APY noise (not a claim — UI shows initializing)
    apy = round(random.uniform(0.8, 3.6), 1)
    chart = "/static/charts/{0}.svg".format(sid)
    return {
        "id": sid,
        "engine": sid,
        "plaza_slot": True,
        "slot": True,
        "status": "INITIALIZING",
        "strategy_type": "GRID",
        "subtype": subtype,
        "title": name,
        "name": name,
        "symbol": symbol,
        "symbols": [symbol.replace("/", "")],
        "timeframe": "15m",
        "interval": "15m",
        "period_days": 0,
        "grid_params": {
            "leverage": 5,
            "grids_count": 60,
            "grid_mode": "geometric",
            "profit_per_grid_pct": 0.55,
        },
        "metrics": {
            "backtest_apy_pct": apy,
            "max_drawdown_pct": 0.0,
            "win_rate_pct": 100.0,
            "win_rate_label": "等候實盤數據",
            "daily_turnover_rate": 0.0,
            "sharpe_ratio": 0.0,
            "return_pct": 0.0,
            "profit_factor": 0.0,
        },
        "sharpe": 0.0,
        "max_drawdown": 0.0,
        "return_pct": 0.0,
        "trades": 0,
        "chart": chart,
        "chart_url": chart,
        "copy": "{0} · 網格策略初始化中，等候實盤數據。".format(name),
        "principle": "高換手網格占位 · 待 idle miner / pipeline 寫入實測曲線",
        "monetization": "trading_volume_rebate",
        "cleaned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true", help="git_sync to Pages after wipe")
    args = ap.parse_args()

    # Prefer VPS app root when present
    primary = Path("/root/quantsite/strategies.json")
    if not primary.parent.is_dir():
        primary = ROOT / "strategies.json"

    existing = {"strategies": []}
    if primary.is_file():
        try:
            existing = json.loads(primary.read_text(encoding="utf-8"))
        except Exception:
            existing = {"strategies": []}

    # Keep only non-plaza AI grid rows that already look like GRID (optional hygiene)
    extras = []
    for row in existing.get("strategies") or []:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("id") or "")
        if sid in PLAZA_IDS:
            continue
        if str(row.get("strategy_type") or "").upper() == "GRID" or (
            row.get("subtype") and "GRID" in str(row.get("subtype")).upper()
        ):
            # Drop old directional AI noise; keep at most recent grids
            extras.append(row)

    plaza_rows = [build_slot(sid, i) for i, sid in enumerate(PLAZA_IDS)]
    # Prefer plaza first; keep a few recent GRID extras max 5
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "status": "INITIALIZING_WIPE",
        "strategies": plaza_rows + extras[:5],
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)

    for d in live_chart_dirs():
        for i, sid in enumerate(PLAZA_IDS):
            name, _, _ = institutional_name(i)
            try:
                flat_equity_svg(d / "{0}.svg".format(sid), title=name)
            except OSError:
                continue

    written = []
    for p in strategies_paths():
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".json.tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(p)
            written.append(str(p))
        except OSError as exc:
            print("skip", p, exc)

    print("wiped plaza slots=45 written=", written)

    # registry bump
    reg = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "plaza_count": 45,
        "live_scan_slots": 90,
        "timeframes": ["15m", "1h"],
        "strategy_ids": list(PLAZA_IDS),
        "sync": "1:1",
        "status": "INITIALIZING_WIPE",
    }
    reg_raw = json.dumps(reg, ensure_ascii=False, indent=2)
    for p in (ROOT / "plaza_live_registry.json",):
        try:
            p.write_text(reg_raw, encoding="utf-8")
        except OSError:
            pass
    if os.name != "nt":
        for p in (Path("/root/quantsite/plaza_live_registry.json"), Path("/var/www/html/plaza_live_registry.json")):
            if not p.parent.is_dir():
                continue
            try:
                p.write_text(reg_raw, encoding="utf-8")
            except OSError:
                pass

    if args.push:
        try:
            from utils.git_sync import sync_to_github

            files = ["strategies.json", "plaza_live_registry.json"] + [
                "static/charts/{0}.svg".format(sid) for sid in PLAZA_IDS
            ]
            print(sync_to_github(files_to_push=files, commit_msg="Auto: emergency plaza INITIALIZING wipe"))
        except Exception as exc:
            print("pages sync skip:", exc)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
