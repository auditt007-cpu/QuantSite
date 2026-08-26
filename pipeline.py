# -*- coding: utf-8 -*-
"""AI mining pipeline — High-Frequency Grid Engine (fee-rebate monetization).

Two-tier backtest:
  1. REAL  — event-driven grid simulation on 15m bars (backtest_grid.py)
  2. LEGACY — formula-based estimation on 1h bars (grid_models.py, fallback)

Daily cron (02/08/14/20) mines one publishable GRID into strategies.json + SVG.
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _ensure_deps() -> None:
    try:
        import dotenv  # noqa: F401
        import httpx  # noqa: F401
        import pandas  # noqa: F401
        import matplotlib  # noqa: F401
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")])


_ensure_deps()

from hub.notify import notify_admin
from llm_pipeline import charts, market, publish, sandbox
from llm_pipeline import write_copy
from llm_pipeline.grid_models import (
    GRID_SYMBOLS,
    SUBTYPES,
    param_combos,
    passes_grid,
    run_subtype,
)
from llm_pipeline.backtest_grid import (
    real_param_combos,
    passes_real,
    run_real_subtype,
)

MAX_PUBLISH_PER_RUN = 1


def _metric_view(agg):
    return {
        "sharpe": agg.get("sharpe"),
        "max_drawdown": agg.get("max_drawdown"),
        "profit_factor": agg.get("profit_factor"),
        "return_pct": agg.get("return_pct"),
        "trades": agg.get("trades"),
        "win_rate_pct": agg.get("win_rate_pct"),
        "daily_turnover_rate": agg.get("daily_turnover_rate"),
    }


def sweep_subtype(universe, subtype: str, symbol: str):
    """Legacy sweep — uses grid_models formula-based simulation (1h data)."""
    best = None
    for params in param_combos(subtype):
        try:
            row = run_subtype(subtype, universe, symbol, params)
        except Exception:
            print(
                "[pipeline] grid fail {0} {1}: {2}".format(
                    subtype, params, sandbox.format_exc().splitlines()[-1]
                ),
                flush=True,
            )
            continue
        if not row:
            continue
        if best is None or row["agg"]["sharpe"] > best["agg"]["sharpe"]:
            best = row
            best["params"] = params
        if passes_grid(row["agg"]):
            # Prefer first gate-pass with highest turnover among passers later
            if best is None or row["agg"].get("daily_turnover_rate", 0) >= best["agg"].get(
                "daily_turnover_rate", 0
            ):
                best = row
                best["params"] = params
                best["_passed"] = True
    return best


def real_sweep_subtype(universe, subtype: str, symbol: str):
    """Real event-driven grid sweep on 15m bars (backtest_grid.py)."""
    best = None
    for params in real_param_combos(subtype):
        try:
            row = run_real_subtype(subtype, universe, symbol, params)
        except Exception:
            print(
                "[pipeline] real grid fail {0} {1}: {2}".format(
                    subtype, params, sandbox.format_exc().splitlines()[-1]
                ),
                flush=True,
            )
            continue
        if not row:
            continue
        if best is None or row["agg"]["sharpe"] > best["agg"]["sharpe"]:
            best = row
            best["params"] = params
        if passes_real(row["agg"]):
            if best is None or row["agg"].get("daily_turnover_rate", 0) >= best["agg"].get(
                "daily_turnover_rate", 0
            ):
                best = row
                best["params"] = params
                best["_passed"] = True
    return best


async def publish_grid(row: dict) -> None:
    agg = row["agg"]
    is_real = row.get("_backtest_type") == "real"
    stem = "ai_grid_{0}_{1}".format(row["subtype"].split("_")[0].lower(), int(time.time()) % 1000000)
    eq = row["equity"].astype(float)
    if float(eq.iloc[0]) != 0:
        eq = eq / float(eq.iloc[0])
    title = "{0} · {1}".format(row.get("title_zh") or row["subtype"], row["symbol"])
    bt_label = "EVENT-DRIVEN REAL BACKTEST" if is_real else "HF GRID ESTIMATE"
    svg = charts.save_equity_svg(
        eq,
        "{0} — {1}".format(title, bt_label),
        stem,
    )
    narrative = "事件驅動網格回測·逐筆撮合·真實勝率" if is_real else "高換手網格·動態風控延長存活"
    copy = await write_copy(
        {
            "strategy_type": "GRID",
            "subtype": row["subtype"],
            "symbol": row["symbol"],
            "sharpe": round(agg["sharpe"], 2),
            "max_drawdown_pct": round(agg["max_drawdown"] * 100, 2),
            "win_rate_pct": round(agg.get("win_rate_pct") or 0, 1),
            "daily_turnover_rate": round(agg.get("daily_turnover_rate") or 0, 1),
            "return_pct": round(agg["return_pct"] * 100, 1),
            "trades": agg.get("trades"),
            "grid_params": row.get("grid_params"),
            "narrative": narrative,
        }
    )
    chart = publish.chart_url(svg)
    days = max(1.0, (eq.index[-1] - eq.index[0]).total_seconds() / 86400.0) if len(eq) > 1 else 90.0
    apy = ((1.0 + agg["return_pct"]) ** (365.0 / days) - 1.0) * 100.0 if agg["return_pct"] > -0.99 else 0.0
    # Real backtests get a tighter APY cap (no fantasy numbers)
    apy_cap = 200.0 if is_real else 980.0
    apy = min(apy, apy_cap)
    entry = {
        "id": stem,
        "strategy_type": "GRID",
        "subtype": row["subtype"],
        "title": title,
        "name": title,
        "symbol": row["symbol"],
        "timeframe": row.get("timeframe") or "15m",
        "period_days": 60 if is_real else 120,
        "backtest_days": 60 if is_real else 120,
        "grid_params": row.get("grid_params") or {},
        "metrics": {
            "backtest_apy_pct": round(apy, 1),
            "max_drawdown_pct": round(agg["max_drawdown"] * 100, 2),
            "daily_turnover_rate": round(float(agg.get("daily_turnover_rate") or 0), 1),
            "sharpe_ratio": round(agg["sharpe"], 3),
            "win_rate_pct": round(float(agg.get("win_rate_pct") or 0), 1),
            "profit_factor": round(agg["profit_factor"], 3),
            "return_pct": round(agg["return_pct"], 4),
        },
        "sharpe": round(agg["sharpe"], 3),
        "max_drawdown": round(agg["max_drawdown"], 4),
        "profit_factor": round(agg["profit_factor"], 3),
        "return_pct": round(agg["return_pct"], 4),
        "trades": int(agg.get("trades") or 0),
        "params": row.get("params") or {},
        "copy": copy,
        "chart": chart,
        "chart_url": chart,
        "symbols": [row["symbol"]],
        "interval": row.get("timeframe") or "15m",
        "monetization": "trading_volume_rebate",
        "backtest_engine": "real_event_driven" if is_real else "legacy_formula",
        "plaza_note": (
            "GRID 进入广场 live 须追加 frontend_strategy_specs + engine-list.js（1:1）；"
            "本产物默认写入 strategies.json 供 bots/strategies 渲染。"
        ),
    }
    if is_real and row.get("_detail"):
        entry["backtest_detail"] = row["_detail"]
    written = publish.publish(entry)
    print("[pipeline] strategies.json -> {0}".format(written), flush=True)
    pages_note = ""
    try:
        from utils import git_sync

        pages_status = git_sync.sync_to_github(
            files_to_push=["strategies.json", "static/charts/{0}.svg".format(stem)],
            commit_msg="Auto: HF grid strategy {0}".format(stem),
        )
        pages_note = " | GitHub Pages: {0}".format(pages_status)
        print("[pipeline] github pages {0}".format(pages_status), flush=True)
    except Exception:
        pages_note = " | GitHub Pages 同步失败"
        print("[pipeline] github pages failed: {0}".format(sandbox.format_exc()[:500]), flush=True)
    await notify_admin(
        "网格挖矿上线 {0} | {1} | 夏普 {2:.2f} | 胜率 {3:.0f}% | 日换手~{4:.0f} | DD {5:.1f}%{6}".format(
            row["subtype"],
            row["symbol"],
            agg["sharpe"],
            agg.get("win_rate_pct") or 0,
            agg.get("daily_turnover_rate") or 0,
            agg["max_drawdown"] * 100,
            pages_note,
        )
    )


async def run_once() -> bool:
    # ---- Tier 1: REAL backtest on 15m bars ----
    print("[pipeline] === Tier 1: Real event-driven grid backtest (15m bars) ===", flush=True)
    try:
        universe_15m = market.load_universe(60, include_pair_extra=True, timeframe="15m")
        print("[pipeline] 15m data loaded: {0}".format(
            {k: len(v) for k, v in universe_15m.items()}), flush=True)
        real_ok = await _run_sweep(universe_15m, real=True)
        if real_ok:
            return True
    except Exception as exc:
        print("[pipeline] 15m data failed: {0} — falling back to legacy".format(
            str(exc)[:200]), flush=True)

    # ---- Tier 2: LEGACY model on 1h bars (original system) ----
    print("[pipeline] === Tier 2: Legacy formula-based grid (1h bars) ===", flush=True)
    universe_1h = market.load_universe(120, include_pair_extra=True)
    return await _run_sweep(universe_1h, real=False)


async def _run_sweep(universe, real: bool = False) -> bool:
    """Sweep all subtypes, publish first gate-passer.  real=True uses backtest_grid."""
    tag = "REAL" if real else "LEGACY"
    candidates = []
    gate_fn = passes_real if real else passes_grid
    sweep_fn = real_sweep_subtype if real else sweep_subtype

    for meta in SUBTYPES:
        subtype = meta["id"]
        symbols = list(GRID_SYMBOLS)
        if subtype == "PAIRS_COINT_GRID":
            symbols = ["BTC/USDT"]
        for sym in symbols:
            print("[pipeline] [{0}] sweep {1} @ {2}".format(tag, subtype, sym), flush=True)
            row = sweep_fn(universe, subtype, sym)
            if not row:
                continue
            detail = ""
            if row.get("_real_backtest"):
                d = row.get("_detail", {})
                detail = " buys={buys} sells={sells} wins={wins} liq={liquidated}".format(**d)
            print("[pipeline] [{0}] best {1} {2} {3}{4}".format(
                tag, subtype, sym, _metric_view(row["agg"]), detail), flush=True)
            candidates.append(row)
            if row.get("_passed") or gate_fn(row["agg"]):
                row["_backtest_type"] = "real" if real else "legacy"
                await publish_grid(row)
                return True

    print("[pipeline] [{0}] no grid passed gates this run".format(tag), flush=True)
    if candidates:
        best = max(candidates, key=lambda r: r["agg"]["sharpe"])
        eq = best["equity"].astype(float)
        if float(eq.iloc[0]) != 0:
            eq = eq / float(eq.iloc[0])
        svg = charts.save_equity_svg(eq, "Last {0} grid run (filters not met)".format(tag), "last_run")
        print("[pipeline] diagnostic svg -> {0}".format(svg), flush=True)
        a = best["agg"]
        gate_desc = "夏普>0.8 回撤<10% 盈亏比>1.3 笔数>=60 胜率>=60% 日换手>=4" if real else \
                    "夏普>1 回撤<18% 盈亏比>1.2 笔数>=40 胜率>=78% 日换手>=8"
        await notify_admin(
            "[{0}] 网格挖矿本轮未达标（需 {1}）。"
            "最佳 {2} {3} | 夏普 {4:.2f} | DD {5:.1f}% | 胜率 {6:.0f}% | 日换手 {7:.1f}".format(
                tag, gate_desc,
                best["subtype"], best["symbol"],
                a["sharpe"], a["max_drawdown"] * 100,
                a.get("win_rate_pct") or 0,
                a.get("daily_turnover_rate") or 0,
            )
        )
    return False


def main() -> None:
    ok = asyncio.run(run_once())
    raise SystemExit(0 if ok else 2)


if __name__ == "__main__":
    main()
