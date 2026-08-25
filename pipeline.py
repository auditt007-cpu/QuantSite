# -*- coding: utf-8 -*-
"""LLM strategy generation, param sweep, multi-asset backtest, chart + TG publish."""
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
from llm_pipeline import backtest, charts, market, publish, sandbox, sweep
from llm_pipeline import generate_strategy_code, repair_strategy_code, write_copy

MAX_FIX = 3
MAX_STRATEGIES = 10
FAMILIES = [
    "EMA crossover trend",
    "RSI mean reversion",
    "Bollinger band breakout",
    "Donchian channel breakout",
    "MACD histogram + EMA filter",
    "ATR trailing stop trend",
    "dual RSI + SMA regime",
    "Keltner channel squeeze",
    "momentum ROC + SMA",
    "mean-reversion z-score of close",
]


def _metric_view(agg):
    return {
        "sharpe": agg.get("sharpe"),
        "max_drawdown": agg.get("max_drawdown"),
        "profit_factor": agg.get("profit_factor"),
        "return_pct": agg.get("return_pct"),
        "trades": agg.get("trades"),
    }


async def build_function(hint: str = ""):
    code = await generate_strategy_code(hint)
    last_err = ""
    for attempt in range(MAX_FIX):
        try:
            fn = sandbox.compile_generate_signals(code)
            return fn, code
        except Exception:
            last_err = sandbox.format_exc()
            print("[pipeline] exec failed attempt {0}: {1}".format(attempt + 1, last_err[:400]), flush=True)
            if attempt >= MAX_FIX - 1:
                break
            code = await repair_strategy_code(code, last_err)
    raise RuntimeError("strategy exec failed after {0} retries:\n{1}".format(MAX_FIX, last_err))


def evaluate_universe(universe, fn):
    return {sym: backtest.evaluate_symbol(df, fn) for sym, df in universe.items()}


def sweep_logic(universe, fn, code):
    extra = getattr(fn, "_param_spec", {}) or {}
    spec = sweep.extract_param_spec(fn, extra)
    grid = sweep.expand_grid(spec, max_combos=40)
    print("[pipeline] param spec {0} combos={1}".format(spec, len(grid)), flush=True)
    best_pass = None
    best_local = None
    for i, params in enumerate(grid):
        bound = sweep.bind_params(fn, params)
        try:
            per = evaluate_universe(universe, bound)
            agg = backtest.aggregate(per)
        except Exception:
            print("[pipeline] combo {0} failed {1}".format(params, sandbox.format_exc().splitlines()[-1]), flush=True)
            continue
        row = {"agg": agg, "per": per, "code": code, "params": params}
        if best_local is None or agg["sharpe"] > best_local["agg"]["sharpe"]:
            best_local = row
        if backtest.passes(agg):
            print("[pipeline] sweep hit {0} {1}".format(params, _metric_view(agg)), flush=True)
            if best_pass is None or agg["sharpe"] > best_pass["agg"]["sharpe"]:
                best_pass = row
        if (i + 1) % 8 == 0:
            top = (best_pass or best_local)["agg"]["sharpe"]
            print("[pipeline] sweep {0}/{1} best_sharpe={2:.3f}".format(i + 1, len(grid), top), flush=True)
    return best_pass or best_local


FAMILY_ZH = {
    "EMA": "AI EMA 雙均趨勢",
    "RSI": "AI RSI 均值回歸",
    "Bollinger": "AI 布林帶突破",
    "Donchian": "AI 唐奇安通道",
    "MACD": "AI MACD 動能",
    "ATR": "AI ATR 跟蹤",
    "Keltner": "AI 肯特納通道",
    "ROC": "AI ROC 動能",
    "z-score": "AI 殘差回歸",
}


def _title_from_hint(hint, stem):
    h = hint or ""
    for key, title in FAMILY_ZH.items():
        if key.lower() in h.lower() or key in h:
            return title
    return "AI 時序研究 {0}".format(stem.replace("ai_", "")[-6:])


async def publish_hit(universe, row, hint=""):
    import pandas as pd

    agg, per, code = row["agg"], row["per"], row["code"]
    print("[pipeline] filters passed {0} params={1}".format(_metric_view(agg), row.get("params")), flush=True)
    stem = "ai_{0}".format(int(time.time()))
    frames = []
    for v in per.values():
        s = v["equity"].astype(float)
        s = s / float(s.iloc[0])
        frames.append(s.rename(None))
    eq = pd.concat(frames, axis=1).mean(axis=1)
    svg = charts.save_equity_svg(eq, "AI strategy cumulative equity (BTC/ETH/SOL 1H)", stem)
    copy = await write_copy(
        {
            "sharpe": round(agg["sharpe"], 2),
            "max_drawdown_pct": round(agg["max_drawdown"] * 100, 2),
            "profit_factor": round(agg["profit_factor"], 2),
            "return_pct": round(agg["return_pct"] * 100, 1),
            "trades": agg.get("trades"),
            "params": row.get("params"),
            "symbols": list(universe.keys()),
        }
    )
    ret_pct = agg["return_pct"] * 100
    chart = publish.chart_url(svg)
    title = _title_from_hint(hint, stem)
    entry = {
        "id": stem,
        "title": title,
        "name": title,
        "sharpe": round(agg["sharpe"], 3),
        "max_drawdown": round(agg["max_drawdown"], 4),
        "profit_factor": round(agg["profit_factor"], 3),
        "return_pct": round(agg["return_pct"], 4),
        "trades": int(agg.get("trades") or 0),
        "params": row.get("params") or {},
        "copy": copy,
        "chart": chart,
        "chart_url": chart,
        "metrics": {
            "sharpe": round(agg["sharpe"], 3),
            "max_drawdown": round(agg["max_drawdown"], 4),
            "profit_factor": round(agg["profit_factor"], 3),
            "return_pct": round(agg["return_pct"], 4),
        },
        "symbols": list(universe.keys()),
        "interval": "1h",
        "code": code,
    }
    written = publish.publish(entry)
    print("[pipeline] strategies.json -> {0}".format(written), flush=True)
    print("[pipeline] svg -> {0}".format(svg), flush=True)
    pages_note = ""
    try:
        from utils import git_sync

        pages_status = git_sync.sync_to_github(
            files_to_push=["strategies.json", "static/charts/{0}.svg".format(stem)],
            commit_msg=None,
        )
        pages_note = " | GitHub Pages: {0}".format(pages_status)
        print("[pipeline] github pages {0}".format(pages_status), flush=True)
    except Exception:
        pages_note = " | GitHub Pages 同步失败，请检查 VPS git push"
        print("[pipeline] github pages failed: {0}".format(sandbox.format_exc()[:500]), flush=True)
    sign = "+" if ret_pct >= 0 else ""
    await notify_admin(
        "🚀 [AI 挖矿成功] 新策略已上线网站！夏普: {0:.1f} | 收益率: {1}{2:.0f}% | 介绍: {3}{4}".format(
            agg["sharpe"], sign, ret_pct, copy[:120], pages_note
        )
    )
    print("[pipeline] telegram admin broadcast sent", flush=True)


BUILTIN_SOURCES = [
    (
        "builtin RSI mean-reversion",
        """
PARAMS = {
    "n": {"low": 8, "high": 24, "step": 2, "kind": "period"},
    "os_level": {"low": 20, "high": 35, "step": 5, "kind": "threshold"},
    "ob_level": {"low": 65, "high": 80, "step": 5, "kind": "threshold"},
}
def generate_signals(df, n=14, os_level=30, ob_level=70):
    r = rsi(df["close"], n)
    raw = pd.Series(0.0, index=df.index)
    raw = raw.mask(r < os_level, 1.0)
    raw = raw.mask(r > ob_level, -1.0)
    return raw.replace(0, np.nan).ffill().fillna(0.0)
""",
    ),
    (
        "builtin EMA cross + RSI filter",
        """
PARAMS = {
    "fast": {"low": 8, "high": 20, "step": 4, "kind": "period"},
    "slow": {"low": 24, "high": 48, "step": 8, "kind": "period"},
    "rsi_n": {"low": 10, "high": 20, "step": 5, "kind": "period"},
}
def generate_signals(df, fast=12, slow=26, rsi_n=14):
    f = ema(df["close"], fast)
    s = ema(df["close"], slow)
    r = rsi(df["close"], rsi_n)
    trend = (f > s).astype(float) * 2 - 1
    trend = trend.mask((trend > 0) & (r > 75), 0.0)
    trend = trend.mask((trend < 0) & (r < 25), 0.0)
    return trend.fillna(0.0)
""",
    ),
    (
        "builtin Bollinger mean-reversion",
        """
PARAMS = {
    "n": {"low": 12, "high": 32, "step": 4, "kind": "period"},
    "k": {"low": 1.5, "high": 2.5, "step": 0.5, "kind": "threshold"},
}
def generate_signals(df, n=20, k=2.0):
    c = df["close"].astype(float)
    mid = sma(c, n)
    sd = c.rolling(int(n)).std()
    z = (c - mid) / sd.replace(0, np.nan)
    raw = pd.Series(0.0, index=df.index)
    raw = raw.mask(z < -k, 1.0)
    raw = raw.mask(z > k, -1.0)
    return raw.replace(0, np.nan).ffill().fillna(0.0)
""",
    ),
]


async def run_once() -> bool:
    print("[pipeline] loading BTC/ETH/SOL 1H ~180d", flush=True)
    universe = market.load_universe(180)
    best = None
    for name, code in BUILTIN_SOURCES:
        print("[pipeline] builtin sweep {0}".format(name), flush=True)
        try:
            fn = sandbox.compile_generate_signals(code)
            row = sweep_logic(universe, fn, code)
        except Exception:
            print("[pipeline] builtin failed: {0}".format(sandbox.format_exc()[:400]), flush=True)
            continue
        if not row:
            continue
        print("[pipeline] builtin best {0}".format(_metric_view(row["agg"])), flush=True)
        if best is None or row["agg"]["sharpe"] > best["agg"]["sharpe"]:
            best = row
        if backtest.passes(row["agg"]):
            await publish_hit(universe, row, name)
            return True
    for i in range(MAX_STRATEGIES):
        family = FAMILIES[i % len(FAMILIES)]
        hint = "Candidate {0}/10. Family: {1}.".format(i + 1, family)
        print("[pipeline] candidate {0}/10 {1}".format(i + 1, family), flush=True)
        try:
            fn, code = await build_function(hint)
        except Exception:
            print("[pipeline] generate failed: {0}".format(sandbox.format_exc()[:400]), flush=True)
            continue
        try:
            row = sweep_logic(universe, fn, code)
        except Exception:
            err = sandbox.format_exc()
            print("[pipeline] sweep error, repairing", flush=True)
            try:
                code = await repair_strategy_code(code, err)
                fn = sandbox.compile_generate_signals(code)
                row = sweep_logic(universe, fn, code)
            except Exception:
                print("[pipeline] repair still failing: {0}".format(sandbox.format_exc()[:500]), flush=True)
                continue
        if not row:
            continue
        print("[pipeline] family best {0}".format(_metric_view(row["agg"])), flush=True)
        if best is None or row["agg"]["sharpe"] > best["agg"]["sharpe"]:
            best = row
        if backtest.passes(row["agg"]):
            await publish_hit(universe, row, family)
            return True
        print("[pipeline] filters not met (Sharpe>1.3 MDD<22% PF>1.3 trades>=30)", flush=True)
    print("[pipeline] no strategy passed filters this run", flush=True)
    if best:
        import pandas as pd

        frames = []
        for v in best["per"].values():
            s = v["equity"].astype(float)
            s = s / float(s.iloc[0])
            frames.append(s.rename(None))
        eq = pd.concat(frames, axis=1).mean(axis=1)
        svg = charts.save_equity_svg(eq, "Last run equity (did not pass filters)", "last_run")
        print("[pipeline] diagnostic svg -> {0}".format(svg), flush=True)
        a = best["agg"]
        await notify_admin(
            "⚠️ [AI 挖矿] 本轮无达标策略（需 夏普>1.3 回撤<22% 盈亏比>1.3 笔数>=30）。"
            "最佳夏普: {0:.2f} | 回撤: {1:.1f}% | 盈亏比: {2:.2f} | 收益: {3:.1f}% | 笔数: {4}".format(
                a["sharpe"], a["max_drawdown"] * 100, a["profit_factor"], a["return_pct"] * 100, a.get("trades")
            )
        )
        print("[pipeline] telegram admin miss-report sent", flush=True)
    return False


def main() -> None:
    ok = asyncio.run(run_once())
    raise SystemExit(0 if ok else 2)


if __name__ == "__main__":
    main()
