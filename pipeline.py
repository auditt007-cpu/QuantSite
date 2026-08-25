# -*- coding: utf-8 -*-
"""AI mining pipeline — High-Frequency Grid Engine (fee-rebate monetization).

Converged: only the 5 institutional grid subtypes in llm_pipeline.grid_models.
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


async def publish_grid(row: dict) -> None:
    agg = row["agg"]
    stem = "ai_grid_{0}_{1}".format(row["subtype"].split("_")[0].lower(), int(time.time()) % 1000000)
    eq = row["equity"].astype(float)
    if float(eq.iloc[0]) != 0:
        eq = eq / float(eq.iloc[0])
    title = "{0} · {1}".format(row.get("title_zh") or row["subtype"], row["symbol"])
    svg = charts.save_equity_svg(
        eq,
        "{0} — HF grid equity (fee-rebate engine)".format(title),
        stem,
    )
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
            "narrative": "高換手網格·動態風控延長存活",
        }
    )
    chart = publish.chart_url(svg)
    days = max(1.0, (eq.index[-1] - eq.index[0]).total_seconds() / 86400.0) if len(eq) > 1 else 90.0
    apy = ((1.0 + agg["return_pct"]) ** (365.0 / days) - 1.0) * 100.0 if agg["return_pct"] > -0.99 else 0.0
    entry = {
        "id": stem,
        "strategy_type": "GRID",
        "subtype": row["subtype"],
        "title": title,
        "name": title,
        "symbol": row["symbol"],
        "timeframe": row.get("timeframe") or "15m",
        "period_days": 120,
        "backtest_days": 120,
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
        "plaza_note": (
            "GRID 进入广场 live 须追加 frontend_strategy_specs + engine-list.js（1:1）；"
            "本产物默认写入 strategies.json 供 bots/strategies 渲染。"
        ),
    }
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
    print("[pipeline] HF Grid Engine — loading ETH/SOL/DOGE/AVAX (+BTC pairs) ~120d 1H", flush=True)
    universe = market.load_universe(120, include_pair_extra=True)
    candidates = []
    # Round-robin subtypes × symbols
    for meta in SUBTYPES:
        subtype = meta["id"]
        symbols = list(GRID_SYMBOLS)
        if subtype == "PAIRS_COINT_GRID":
            symbols = ["ETH/USDT"]  # pairs resolved inside run_subtype
        for sym in symbols:
            print("[pipeline] sweep {0} @ {1}".format(subtype, sym), flush=True)
            row = sweep_subtype(universe, subtype, sym)
            if not row:
                continue
            print("[pipeline] best {0} {1} {2}".format(subtype, sym, _metric_view(row["agg"])), flush=True)
            candidates.append(row)
            if row.get("_passed") or passes_grid(row["agg"]):
                await publish_grid(row)
                return True
    print("[pipeline] no grid passed gates this run", flush=True)
    if candidates:
        best = max(candidates, key=lambda r: r["agg"]["sharpe"])
        eq = best["equity"].astype(float)
        if float(eq.iloc[0]) != 0:
            eq = eq / float(eq.iloc[0])
        svg = charts.save_equity_svg(eq, "Last HF grid run (filters not met)", "last_run")
        print("[pipeline] diagnostic svg -> {0}".format(svg), flush=True)
        a = best["agg"]
        await notify_admin(
            "网格挖矿本轮未达标（需 夏普>1 回撤<18% 盈亏比>1.2 笔数>=40 胜率>=78% 日换手>=8）。"
            "最佳 {0} {1} | 夏普 {2:.2f} | DD {3:.1f}% | 胜率 {4:.0f}% | 日换手 {5:.1f}".format(
                best["subtype"],
                best["symbol"],
                a["sharpe"],
                a["max_drawdown"] * 100,
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
