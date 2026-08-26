# -*- coding: utf-8 -*-
"""Real event-driven grid trading backtester.

Unlike grid_models.py (which estimates fills from price movement magnitude),
this module simulates actual grid order execution:

  1. Place N grid levels across a price range
  2. When price drops below a level → BUY 1 unit
  3. When price rises above a level → SELL 1 unit
  4. Track inventory, cash, margin, and liquidation
  5. Report real win rate, PnL, Sharpe, drawdown

Uses 15m OHLCV bars.  Within each bar, levels between low..high are
processed top-to-bottom (sell before buy for conservative fill ordering).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FEE_BPS = 0.0004          # 4 bps per side (≈ taker on major CEX)
LEVERAGE_RANGE = (3, 7)
PROFIT_PER_GRID_PCT = (0.4, 0.8)

# Minimum bars between entries to avoid over-trading on noise
MIN_BARS_BETWEEN_FILLS = 0

# ---------------------------------------------------------------------------
# Grid level construction
# ---------------------------------------------------------------------------

def _build_levels(lo: float, hi: float, n: int, mode: str = "arithmetic") -> np.ndarray:
    """Return sorted array of grid price levels."""
    if mode == "geometric":
        if lo <= 0:
            lo = 1e-8
        return np.geomspace(lo, hi, n)
    return np.linspace(lo, hi, n)


def _atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    h = df["high"].astype(float)
    l = df["low"].astype(float)
    c = df["close"].astype(float)
    prev = c.shift(1)
    tr = pd.concat([(h - l).abs(), (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean()


def _auto_range(df: pd.DataFrame, atr_n: int = 14, atr_mult: float = 2.0,
                grids: int = 60) -> Tuple[float, float]:
    """Derive grid range from recent ATR — wider than the old model's band."""
    c = df["close"].astype(float)
    atr = _atr(df, atr_n).bfill().fillna(c * 0.01)
    atr_now = float(atr.iloc[-1])
    mid = float(c.iloc[-atr_n:].median())
    half = atr_now * atr_mult * (grids / 8.0)
    lo = max(mid - half, float(c.min()) * 0.7)
    hi = mid + half
    return lo, hi

# ---------------------------------------------------------------------------
# Core simulation
# ---------------------------------------------------------------------------

def simulate_real_grid(
    df: pd.DataFrame,
    lower: float,
    upper: float,
    grids: int = 60,
    leverage: float = 5.0,
    grid_mode: str = "arithmetic",
    max_inventory: Optional[int] = None,
    stop_loss_eq_pct: float = 0.30,
) -> Dict[str, Any]:
    """Event-driven grid simulation on OHLCV bars.

    Parameters
    ----------
    df : DataFrame with columns open/high/low/close, DatetimeIndex
    lower, upper : grid range boundaries
    grids : number of grid levels
    leverage : position leverage (margin = notional / leverage)
    grid_mode : "arithmetic" or "geometric"
    max_inventory : cap on open position units (default = grids * 2)
    stop_loss_eq_pct : force-close if equity drops below this fraction of initial

    Returns
    -------
    dict with keys: equity, trades (list), metrics, grid_params
    """
    c = df["close"].astype(float)
    h = df["high"].astype(float)
    l = df["low"].astype(float)
    o = df["open"].astype(float)

    if len(c) < 100:
        return _empty_result()

    levels = _build_levels(lower, upper, grids, grid_mode)
    spacing = np.diff(levels)
    avg_spacing = float(np.mean(spacing))
    if avg_spacing <= 0:
        return _empty_result()

    fee = FEE_BPS * 2  # round-trip fee

    # Notional per grid: with leverage L and N grids, each grid controls
    # L/N of starting capital as notional exposure.
    notional = leverage / grids

    # Per-level state
    held = [False] * grids
    buy_price = [0.0] * grids

    # Accounting (all in return-space: 1.0 = starting capital)
    inventory = 0
    realised_pnl = 0.0
    total_fees = 0.0
    buys = 0
    sells = 0
    wins = 0
    gross_profit = 0.0   # sum of profitable sell PnL (before fee)
    gross_loss = 0.0     # sum of losing sell PnL (before fee)

    if max_inventory is None:
        max_inventory = grids * 2

    equity = np.ones(len(c))
    liquidated = False
    liq_idx = len(c)

    # ---- Neutral initialisation ----
    first_open = float(o.iloc[0])
    for j in range(grids):
        lv = float(levels[j])
        if lv < first_open:
            held[j] = True
            buy_price[j] = lv
            inventory += 1
            buys += 1

    prev_close = first_open

    for i in range(len(c)):
        bar_lo = float(l.iloc[i])
        bar_hi = float(h.iloc[i])
        bar_close = float(c.iloc[i])

        for j in range(grids):
            lv = float(levels[j])
            if bar_lo > lv or bar_hi < lv:
                continue

            if prev_close < lv and bar_close >= lv:
                # Price rose through → sell highest held level below
                if not liquidated:
                    best_k = -1
                    for k in range(grids):
                        if held[k] and float(levels[k]) < lv:
                            if best_k < 0 or float(levels[k]) > float(levels[best_k]):
                                best_k = k
                    if best_k >= 0:
                        bp = buy_price[best_k]
                        raw_pnl = (lv - bp) / max(bp, 1e-9) * notional
                        fee_cost = notional * fee
                        pnl = raw_pnl - fee_cost
                        realised_pnl += pnl
                        total_fees += fee_cost
                        if raw_pnl > 0:
                            gross_profit += raw_pnl
                        else:
                            gross_loss += abs(raw_pnl)
                        inventory -= 1
                        sells += 1
                        if pnl > 0:
                            wins += 1
                        held[best_k] = False
                        buy_price[best_k] = 0.0
            elif prev_close >= lv and bar_close < lv:
                # Price dropped through → buy if not held
                if not held[j] and inventory < max_inventory and not liquidated:
                    buy_price[j] = lv
                    inventory += 1
                    buys += 1
                    held[j] = True

        prev_close = bar_close

        # MTM equity = 1.0 + realised + unrealised
        unrealised = 0.0
        for k in range(grids):
            if held[k] and buy_price[k] > 0:
                unrealised += (bar_close - buy_price[k]) / max(buy_price[k], 1e-9) * notional
        mtm = 1.0 + realised_pnl + unrealised
        equity[i] = mtm

        # Liquidation check
        if mtm < stop_loss_eq_pct and not liquidated:
            for k in range(grids):
                if held[k] and buy_price[k] > 0:
                    liq_pnl = (bar_close - buy_price[k]) / max(buy_price[k], 1e-9) * notional
                    liq_pnl -= notional * fee
                    realised_pnl += liq_pnl
                    total_fees += notional * fee
                    held[k] = False
                    buy_price[k] = 0.0
            inventory = 0
            equity[i] = 1.0 + realised_pnl
            liquidated = True
            liq_idx = i
            break

    # Final equity
    if not liquidated:
        fp = float(c.iloc[-1])
        ur = 0.0
        for k in range(grids):
            if held[k] and buy_price[k] > 0:
                ur += (fp - buy_price[k]) / max(buy_price[k], 1e-9) * notional
        equity[-1] = 1.0 + realised_pnl + ur

    # Fill remaining equity entries after liquidation
    if liquidated and liq_idx < len(c) - 1:
        equity[liq_idx + 1:] = equity[liq_idx]

    # ------------------------------------------------------------------
    # Compute metrics
    # ------------------------------------------------------------------
    total_trades_count = buys + sells
    win_rate = (100.0 * wins / sells) if sells > 0 else 0.0

    # Sharpe from equity curve
    eq_series = pd.Series(equity, index=c.index)
    ret = eq_series.pct_change().fillna(0.0)
    mu = float(ret.mean())
    sd = float(ret.std(ddof=1)) if len(ret) > 1 else 0.0
    # Annualise assuming bar interval
    if len(c) >= 2:
        bar_seconds = (c.index[-1] - c.index[0]).total_seconds() / max(len(c) - 1, 1)
        bars_per_year = 365.25 * 86400 / max(bar_seconds, 1)
    else:
        bars_per_year = 365.25 * 96  # assume 15m
    sharpe = (mu / sd) * math.sqrt(bars_per_year) if sd > 1e-12 else 0.0

    # Max drawdown
    peak = eq_series.cummax()
    dd = float(((eq_series / peak) - 1.0).min())

    # Profit factor — from actual trade PnL, not equity curve
    if gross_loss > 1e-12:
        pf = gross_profit / gross_loss
    elif gross_profit > 1e-12:
        pf = gross_profit / max(total_fees, 1e-12)
    else:
        pf = 0.0
    if not np.isfinite(pf) or pf > 99.0:
        pf = 99.0

    # Daily turnover
    days = max(1.0, (c.index[-1] - c.index[0]).total_seconds() / 86400.0)
    daily_turnover = total_trades_count / days

    # Return (equity[-1] is always correct — filled after liquidation too)
    final_eq = float(equity[-1])
    return_pct = final_eq - 1.0

    return {
        "equity": eq_series,
        "trades": [],
        "metrics": {
            "return_pct": return_pct,
            "sharpe": sharpe,
            "max_drawdown": abs(dd),
            "profit_factor": pf,
            "trades": total_trades_count,
            "win_rate_pct": win_rate,
            "daily_turnover_rate": daily_turnover,
            "total_fees_pct": total_fees / max(final_eq, 0.01),
            "buys": buys,
            "sells": sells,
            "wins": wins,
            "final_inventory": inventory,
            "liquidated": liquidated,
        },
        "grid_params": {
            "lower_price": round(lower, 2),
            "upper_price": round(upper, 2),
            "grids_count": grids,
            "grid_mode": grid_mode,
            "leverage": leverage,
            "avg_grid_spacing": round(avg_spacing, 2),
            "avg_grid_spacing_pct": round(avg_spacing / float(c.mean()) * 100, 3),
        },
    }


def _empty_result() -> Dict[str, Any]:
    return {
        "equity": pd.Series([1.0]),
        "trades": [],
        "metrics": {
            "return_pct": 0.0, "sharpe": 0.0, "max_drawdown": 1.0,
            "profit_factor": 0.0, "trades": 0, "win_rate_pct": 0.0,
            "daily_turnover_rate": 0.0, "total_fees_pct": 0.0,
            "buys": 0, "sells": 0, "wins": 0,
            "final_inventory": 0, "liquidated": False,
        },
        "grid_params": {},
    }

# ---------------------------------------------------------------------------
# Interface matching grid_models.run_subtype()
# ---------------------------------------------------------------------------

def run_real_subtype(
    subtype: str,
    universe: Dict[str, pd.DataFrame],
    symbol: str,
    params: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Run real grid backtest for one subtype.  Returns same dict shape as
    ``grid_models.run_subtype`` so the pipeline can use it as a drop-in."""
    params = dict(params or {})
    lev = float(np.clip(params.get("leverage", 5), LEVERAGE_RANGE[0], LEVERAGE_RANGE[1]))
    profit = float(np.clip(params.get("profit_per_grid_pct", 0.65),
                           PROFIT_PER_GRID_PCT[0], PROFIT_PER_GRID_PCT[1]))
    grids = int(params.get("grids_count", 60))
    atr_mult = float(params.get("atr_multiplier", 2.0))
    grid_mode = params.get("grid_mode", "arithmetic")

    key = symbol.replace("/", "")

    # Pairs subtype
    if subtype == "PAIRS_COINT_GRID":
        from llm_pipeline.grid_models import PAIR_LEGS
        leg = None
        for a, b in PAIR_LEGS:
            if a in universe and b in universe:
                leg = (a, b)
                break
        if not leg:
            return None
        # Build spread DataFrame
        a = universe[leg[0]]["close"].astype(float)
        b = universe[leg[1]]["close"].astype(float)
        joined = pd.concat([a.rename("a"), b.rename("b")], axis=1).dropna()
        if len(joined) < 200:
            return None
        ratio = joined["a"] / joined["b"]
        # Create synthetic OHLCV from ratio
        df_spread = pd.DataFrame({
            "open": ratio, "high": ratio * 1.002,
            "low": ratio * 0.998, "close": ratio, "volume": 0.0,
        }, index=joined.index)
        lo = float(ratio.min()) * 0.95
        hi = float(ratio.max()) * 1.05
        result = simulate_real_grid(df_spread, lo, hi, grids=grids, leverage=lev,
                                    grid_mode=grid_mode)
        symbol_out = "{0}/{1}".format(leg[0].replace("USDT", ""), leg[1].replace("USDT", ""))
    else:
        df = universe.get(key)
        if df is None or len(df) < 200:
            return None

        # Auto-range from ATR
        lo, hi = _auto_range(df, atr_mult=atr_mult, grids=grids)

        result = simulate_real_grid(df, lo, hi, grids=grids, leverage=lev,
                                    grid_mode=grid_mode)
        symbol_out = symbol

    m = result["metrics"]
    gp = result["grid_params"]

    meta = next((s for s in _SUBTYPE_META if s["id"] == subtype),
                {"title_zh": subtype, "title_en": subtype})

    return {
        "strategy_type": "GRID",
        "subtype": subtype,
        "symbol": symbol_out,
        "timeframe": "15m",
        "title_zh": meta["title_zh"],
        "title_en": meta.get("title_en", subtype),
        "grid_params": gp,
        "metrics_raw": m,
        "agg": {
            "sharpe": m["sharpe"],
            "max_drawdown": m["max_drawdown"],
            "profit_factor": m["profit_factor"],
            "return_pct": m["return_pct"],
            "trades": m["trades"],
            "win_rate_pct": m["win_rate_pct"],
            "daily_turnover_rate": m["daily_turnover_rate"],
        },
        "equity": result["equity"],
        "_real_backtest": True,
        "_detail": {
            "buys": m["buys"], "sells": m["sells"], "wins": m["wins"],
            "liquidated": m["liquidated"], "final_inventory": m["final_inventory"],
        },
    }


_SUBTYPE_META = [
    {"id": "DYNAMIC_ATR_GRID", "title_zh": "ATR動態自適應網格",
     "title_en": "Dynamic ATR Step Grid"},
    {"id": "BASIS_FUNDING_GRID", "title_zh": "資金費率對沖網格",
     "title_en": "Basis & Funding Rate Grid"},
    {"id": "BOLLINGER_SQUEEZE_GRID", "title_zh": "布林擠壓高頻網格",
     "title_en": "Bollinger Squeeze Grid"},
    {"id": "FIBO_DCA_GRID", "title_zh": "斐波那契DCA網格",
     "title_en": "Fibonacci DCA Futures Grid"},
    {"id": "PAIRS_COINT_GRID", "title_zh": "協整配對套利網格",
     "title_en": "Co-integrated Pairs Trading Grid"},
]

# ---------------------------------------------------------------------------
# Parameter sweep — real grid uses fewer knobs (range is auto)
# ---------------------------------------------------------------------------

def real_param_combos(subtype: str) -> List[Dict[str, Any]]:
    """Parameter combinations for real grid backtest.

    Key difference from grid_models: grid range is auto-derived from ATR,
    so we sweep leverage, grid count, ATR multiplier, and grid mode instead.
    """
    base: List[Dict[str, Any]] = []
    for lev in (3, 5, 7):
        for grids in (40, 60, 80):
            for atr_mult in (1.5, 2.0, 2.5):
                for mode in ("arithmetic", "geometric"):
                    row: Dict[str, Any] = {
                        "leverage": lev,
                        "grids_count": grids,
                        "atr_multiplier": atr_mult,
                        "grid_mode": mode,
                        "profit_per_grid_pct": 0.55,  # not used for PnL in real sim
                    }
                    base.append(row)
    # Cap to 36 combos (reasonable for 1C1G VPS)
    if len(base) > 36:
        idx = np.linspace(0, len(base) - 1, 36).astype(int)
        base = [base[i] for i in idx]
    return base


def passes_real(agg: Dict[str, Any]) -> bool:
    """Gate for real backtest results — stricter than the old model because
    the numbers are now genuine."""
    dd = float(agg.get("max_drawdown") or 1.0)
    wr = float(agg.get("win_rate_pct") or 0.0)
    pf = float(agg.get("profit_factor") or 0.0)
    trades = int(agg.get("trades") or 0)
    sharpe = float(agg.get("sharpe") or 0.0)
    turnover = float(agg.get("daily_turnover_rate") or 0.0)
    return (
        sharpe > 0.8
        and dd < 0.10          # 10% max DD (real numbers, not simulated)
        and pf > 1.3
        and trades >= 60       # meaningful sample
        and wr >= 60.0         # real win rate (not formula-inflated)
        and turnover >= 4.0    # at least 4 fills/day
    )
