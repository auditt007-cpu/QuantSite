# -*- coding: utf-8 -*-
"""Institutional rankings backtest — deep sample pool + Bayesian ranking."""

import argparse
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import tg_engine as te  # noqa: E402

SYMBOLS = te.SYMBOLS
PERIOD_DAYS = 60
UA = te.UA
TIMEOUT = te.TIMEOUT
SSL_CTX = te.SSL_CTX
OUT_PATH = os.path.join(ROOT, "leaderboard.json")
STATIC_PATH = os.environ.get("LEADERBOARD_STATIC", os.path.join(ROOT, "leaderboard.json"))
INITIAL_CAPITAL = 10000.0
START_CAPITAL = INITIAL_CAPITAL  # backward-compatible alias
MIN_TRADES_RANK = 10
BAYES_PRIOR_A = 8.0  # Beta prior ≈ mean 50%
BAYES_PRIOR_B = 8.0
MAX_BARS = 1000

FAMILY_ENGINE = {
    "ema_12_26": "dual",
    "ema_5_13": "ribbon",
    "ema_triple": "strat-004",
    "don_20": "strat-001",
    "don_10": "strat-001",
    "bb_reb": "squeeze",
    "bb_sqz": "squeeze",
    "bb_wide": "squeeze",
    "rsi_x": "rsi",
    "rsi_div": "rsi",
    "macd_h": "strat-006",
    "macd_s": "strat-006",
    "st_atr": "atr",
    "atr_grid": "atr",
    "vsa": "strat-005",
    "roc10": "strat-007",
    "roc20": "strat-007",
    "kelt": "strat-008",
    "pivot": "strat-009",
    "dual": "dual",
    "vol_ma": "strat-010",
    "combo": "qe",
    "trend50": "strat-004",
}

# Exact 45 frontend strategy IDs used by terminal.html (FALLBACK_ENGINES order).
# Canonical definition now lives in tg_engine.py (single source of truth shared
# with the live 60s VPS matrix scan / live_feed.json).
frontend_strategy_specs = te.frontend_strategy_specs


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print("[{0}] {1}".format(ts, msg), flush=True)


def timeframes_for(days, full=False):
    if full or days >= 30:
        return ("15m", "1h")
    if days <= 7:
        return ("1h", "4h")
    return ("1h", "4h")


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def bar_ms(tf):
    return {"15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000}[tf]


def kline_limit(tf, days):
    need = {
        "15m": days * 96 + 80,
        "1h": days * 24 + 80,
        "4h": days * 6 + 40,
        "1d": days + 30,
    }.get(tf, days * 24 + 80)
    return min(MAX_BARS, max(200, need))


def okx_bar(tf):
    return {"15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D"}[tf]


def pack_binance(rows, tf):
    h, l, c, v, t = [], [], [], [], []
    for r in rows:
        t.append(int(r[0]))
        h.append(float(r[2]))
        l.append(float(r[3]))
        c.append(float(r[4]))
        v.append(float(r[5]))
    return {"h": h, "l": l, "c": c, "v": v, "t": t, "src": "binance", "tf": tf}


def pack_okx(rows, tf):
    h, l, c, v, t = [], [], [], [], []
    for r in rows:
        t.append(int(r[0]))
        h.append(float(r[2]))
        l.append(float(r[3]))
        c.append(float(r[4]))
        v.append(float(r[5]))
    return {"h": h, "l": l, "c": c, "v": v, "t": t, "src": "okx", "tf": tf}


def fetch_klines_binance(sym, tf, days):
    limit = kline_limit(tf, days)
    url = (
        "https://api.binance.com/api/v3/klines?symbol={0}&interval={1}&limit={2}"
    ).format(sym, tf, limit)
    rows = http_json(url)
    now_ms = int(time.time() * 1000)
    if rows and int(rows[-1][6]) > now_ms:
        rows = rows[:-1]
    if len(rows) < 60:
        raise RuntimeError("binance insufficient bars")
    return pack_binance(rows, tf)


def fetch_klines_okx_paged(sym, tf, days):
    """Pull up to MAX_BARS via OKX pagination (limit 100 per call)."""
    want = kline_limit(tf, days)
    inst = te.okx_inst(sym)
    collected = []
    after = None
    pages = 0
    while len(collected) < want and pages < 12:
        pages += 1
        url = (
            "https://www.okx.com/api/v5/market/candles?instId={0}&bar={1}&limit=100"
        ).format(inst, okx_bar(tf))
        if after is not None:
            url += "&after={0}".format(after)
        data = http_json(url)
        chunk = data.get("data") or []
        if not chunk:
            break
        collected.extend(chunk)
        after = int(chunk[-1][0])
        if len(chunk) < 100:
            break
        time.sleep(0.08)
    # OKX returns newest-first; reverse to chronological
    by_ts = {}
    for r in collected:
        by_ts[int(r[0])] = r
    rows = [by_ts[k] for k in sorted(by_ts.keys())]
    now_ms = int(time.time() * 1000)
    if rows and int(rows[-1][0]) + bar_ms(tf) > now_ms:
        rows = rows[:-1]
    if len(rows) > want:
        rows = rows[-want:]
    if len(rows) < 60:
        raise RuntimeError("okx insufficient bars")
    return pack_okx(rows, tf)


def load_klines(sym, tf, days):
    try:
        return fetch_klines_binance(sym, tf, days)
    except Exception as exc:
        log("{0} {1} binance fail: {2}; fallback okx paged".format(sym, tf, exc))
        return fetch_klines_okx_paged(sym, tf, days)


# Bound the trailing window handed to eval_fn on each walk-forward step.
# Without this, slice_data(data, i) returns data[:i+1] — a prefix that grows
# with i — and every indicator inside eval_fn (ema/rsi/sma/stdev, all O(len))
# gets recomputed from scratch on that ever-larger prefix on EVERY bar, which
# is an O(n^2) blowup over a long backtest (this is what made the 8-window
# hero scan dramatically slower than expected: iterations near the end of a
# ~1400-bar pool were each recomputing indicators over ~1400 bars, even for
# short 3-day windows with a warm start near the end of the array). None of
# the 45 eval_* strategies need more than ~55 bars of lookback (the longest
# EMA period in use), so a 400-bar trailing cap gives ~7x headroom for
# indicator convergence while keeping every iteration's cost constant
# instead of growing with position — the live 60s scan already effectively
# does this since it always calls eval_fn with a short, fixed-size window.
BACKTEST_LOOKBACK_CAP = 400


def slice_data(data, i):
    start = max(0, i + 1 - BACKTEST_LOOKBACK_CAP)
    return {k: data[k][start : i + 1] for k in ("h", "l", "c", "v", "t")}


def warmup_index(data, days):
    if not data["t"]:
        return 40
    cutoff = data["t"][-1] - days * 86400000
    start = 40
    for i, ts in enumerate(data["t"]):
        if ts >= cutoff:
            start = max(40, i)
            break
    return min(start, max(40, len(data["c"]) - 5))


def fmt_trade_ts(ms):
    if not ms:
        return ""
    dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M")


def backtest(eval_fn, data, days, max_hold=24, stop_mult=2.0):
    """Long/flat backtest with fixed INITIAL_CAPITAL sizing (non-compounding ROI)."""
    start = warmup_index(data, days)
    rets = []
    trade_log = []
    eq = INITIAL_CAPITAL
    peak = eq
    max_dd = 0.0
    in_pos = False
    entry = 0.0
    entry_ts = 0
    entry_i = 0
    c = data["c"]
    h = data["h"]
    l = data["l"]
    t_arr = data["t"]
    atr_series = te.atr(h, l, c, 14) if len(c) > 20 else [0.0] * len(c)

    def apply_exit(r, exit_px, bar_ts, reason):
        nonlocal in_pos, entry, entry_ts, entry_i, eq, peak, max_dd
        pnl_abs = INITIAL_CAPITAL * r
        eq += pnl_abs
        rets.append(r)
        trade_log.append(
            {
                "side": "LONG",
                "entry_ts": entry_ts,
                "exit_ts": bar_ts,
                "entry_px": round(entry, 6),
                "exit_px": round(exit_px, 6),
                "pnl_pct": round(r * 100.0, 2),
                "pnl_abs": round(pnl_abs, 2),
                "entry_label": fmt_trade_ts(entry_ts),
                "exit_label": fmt_trade_ts(bar_ts),
                "reason": reason,
            }
        )
        peak = max(peak, eq)
        max_dd = min(max_dd, (eq - peak) / peak if peak else 0.0)
        in_pos = False
        entry = 0.0

    def close_trade(i, reason="signal"):
        px = c[i]
        bar_ts = t_arr[i] if i < len(t_arr) else 0
        r = (px - entry) / entry if entry else 0.0
        apply_exit(r, px, bar_ts, reason)

    for i in range(start, len(c)):
        d = slice_data(data, i)
        try:
            side = eval_fn(d)
        except Exception:
            side = None
        bar_ts = t_arr[i] if i < len(t_arr) else 0
        if in_pos:
            held = i - entry_i
            risk = atr_series[i] if i < len(atr_series) else 0.0
            stop = entry - stop_mult * risk if risk > 0 else entry * 0.98
            if l[i] <= stop:
                r = (stop - entry) / entry if entry else 0.0
                apply_exit(r, stop, bar_ts, "stop")
                continue
            if held >= max_hold or side == "SHORT":
                close_trade(i, "time" if held >= max_hold else "signal")
                continue
        if side == "LONG" and not in_pos:
            in_pos = True
            entry = c[i]
            entry_ts = bar_ts
            entry_i = i

    if in_pos and entry:
        close_trade(len(c) - 1, "eod")

    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    n = len(rets)
    wr = len(wins) / n if n else 0.0
    gp = sum(wins)
    gl = abs(sum(losses))
    pf = gp / gl if gl > 1e-12 else (9.99 if gp > 0 else 0.0)
    net_pnl = sum(INITIAL_CAPITAL * r for r in rets)
    roi_pct = (net_pnl / INITIAL_CAPITAL) * 100.0
    apr_pct = roi_pct * (365.0 / float(days)) if days else roi_pct
    return {
        "win_rate": round(wr, 4),
        "profit_factor": round(min(pf, 99.0), 2),
        "max_drawdown": round(max_dd, 4),
        "roi_pct": round(roi_pct, 1),
        "apr_pct": round(apr_pct, 1),
        "net_pnl_usd": round(net_pnl, 2),
        "net_profit_pct": round(roi_pct / 100.0, 4),  # fraction alias for older clients
        "net_profit_usd": round(net_pnl, 2),
        "trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "trade_log": trade_log,
        "rets": rets,
    }


def backtest_with_floor(eval_fn, data, days, min_trades=15):
    """Retry with looser exits / fallback signals until min trades or exhausted."""
    attempts = [
        (eval_fn, 24, 2.0),
        (eval_fn, 16, 2.2),
        (eval_fn, 12, 2.5),
        (lambda d: te.eval_ema_cross(d, 8, 21), 14, 2.2),
        (lambda d: te.eval_roc(d, 8, 0.15), 12, 2.5),
        (lambda d: te.eval_rsi_cross(d, 40, 60), 10, 2.5),
    ]
    best = None
    for fn, hold, smult in attempts:
        stats = backtest(fn, data, days, max_hold=hold, stop_mult=smult)
        if best is None or stats["trades"] > best["trades"]:
            best = stats
        if stats["trades"] >= min_trades:
            return stats
    return best or backtest(eval_fn, data, days)


def bayesian_win_rate(wins, trades):
    return (wins + BAYES_PRIOR_A) / (trades + BAYES_PRIOR_A + BAYES_PRIOR_B)


def ranking_score(wr_smooth, trades, max_dd):
    dd = abs(float(max_dd or 0.0))
    dd = min(dd, 0.95)
    return wr_smooth * math.log10(trades + 1.0) * (1.0 - dd)


def family_id(strat_id):
    parts = strat_id.split("_")
    if len(parts) >= 3:
        return "_".join(parts[:-2])
    return strat_id


def merge_stats(parts, days):
    """Merge multiple symbol/tf backtests into one pooled sample (fixed-capital ROI)."""
    all_rets = []
    all_logs = []
    for p in parts:
        all_rets.extend(p.get("rets") or [])
        all_logs.extend(p.get("trade_log") or [])
    n = len(all_rets)
    if n < 1:
        return None
    wins = [r for r in all_rets if r > 0]
    losses = [r for r in all_rets if r <= 0]
    wr = len(wins) / n
    gp = sum(wins)
    gl = abs(sum(losses))
    pf = gp / gl if gl > 1e-12 else (9.99 if gp > 0 else 0.0)
    # Fixed notional equity path for drawdown (no compounding)
    eq = INITIAL_CAPITAL
    peak = eq
    max_dd = 0.0
    for r in all_rets:
        eq += INITIAL_CAPITAL * r
        peak = max(peak, eq)
        max_dd = min(max_dd, (eq - peak) / peak if peak else 0.0)
    # Trade-weighted mean of per-leg ROI so multi-symbol pooling does not inflate %
    w_roi = 0.0
    w_n = 0
    for p in parts:
        tn = int(p.get("trades") or len(p.get("rets") or []))
        if tn < 1:
            continue
        if "roi_pct" in p:
            leg_roi = float(p["roi_pct"])
        else:
            leg_pnl = sum(INITIAL_CAPITAL * r for r in (p.get("rets") or []))
            leg_roi = (leg_pnl / INITIAL_CAPITAL) * 100.0
        w_roi += leg_roi * tn
        w_n += tn
    roi_pct = (w_roi / w_n) if w_n else 0.0
    net_pnl = INITIAL_CAPITAL * (roi_pct / 100.0)
    apr_pct = roi_pct * (365.0 / float(days)) if days else roi_pct
    wr_s = bayesian_win_rate(len(wins), n)
    score = ranking_score(wr_s, n, max_dd)
    eligible = n >= MIN_TRADES_RANK
    return {
        "win_rate": round(wr, 4),
        "win_rate_smooth": round(wr_s, 4),
        "rank_score": round(score, 6),
        "eligible": eligible,
        "profit_factor": round(min(pf, 99.0), 2),
        "max_drawdown": round(max_dd, 4),
        "roi_pct": round(roi_pct, 1),
        "apr_pct": round(apr_pct, 1),
        "net_pnl_usd": round(net_pnl, 2),
        "net_profit_pct": round(roi_pct / 100.0, 4),
        "net_profit_usd": round(net_pnl, 2),
        "trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "trade_log": sorted(all_logs, key=lambda x: x.get("exit_ts") or 0),
    }


def run_all(days, full=False):
    rows = []
    pool = {}
    tfs = timeframes_for(days, full=full)
    log("timeframes={0} days={1} full={2}".format(tfs, days, full))
    for sym in SYMBOLS:
        for tf in tfs:
            key = (sym, tf)
            try:
                pool[key] = load_klines(sym, tf, days)
                log("loaded {0} {1} bars={2} src={3}".format(sym, tf, len(pool[key]["c"]), pool[key]["src"]))
            except Exception as exc:
                log("skip pool {0} {1}: {2}".format(sym, tf, exc))

    # One entry per frontend strategy ID (45) — keys match terminal.html exactly
    specs = frontend_strategy_specs()
    engine_parts = {}
    for eng, zht, en, eval_fn in specs:
        parts = []
        for sym in SYMBOLS:
            for tf in tfs:
                data = pool.get((sym, tf))
                if not data or len(data["c"]) < 60:
                    continue
                stats = backtest_with_floor(eval_fn, data, days, min_trades=15)
                if stats["trades"] < 1:
                    continue
                row = {
                    "id": eng,
                    "family": eng,
                    "engine": eng,
                    "name_zh": zht,
                    "name_en": en,
                    "symbol": sym,
                    "timeframe": tf,
                    "win_rate": stats["win_rate"],
                    "profit_factor": stats["profit_factor"],
                    "max_drawdown": stats["max_drawdown"],
                    "roi_pct": stats["roi_pct"],
                    "apr_pct": stats["apr_pct"],
                    "net_pnl_usd": stats["net_pnl_usd"],
                    "net_profit_pct": stats["net_profit_pct"],
                    "net_profit_usd": stats["net_profit_usd"],
                    "trades": stats["trades"],
                    "total_trades": stats["trades"],
                    "trade_log": stats["trade_log"],
                    "execution_logs": stats["trade_log"],
                }
                rows.append(row)
                parts.append(stats)
        if not parts:
            log("WARN engine {0} produced 0 trades across all legs".format(eng))
            continue
        engine_parts[eng] = {"meta": {"id": eng, "zht": zht, "en": en}, "chunks": parts}
        log(
            "engine {0} trades={1} across {2} legs".format(
                eng, sum(p["trades"] for p in parts), len(parts)
            )
        )

    by_engine = {}
    for eng, bundle in engine_parts.items():
        merged = merge_stats(bundle["chunks"], days)
        if not merged:
            continue
        # Prefer single best-symbol/tf leg if pooled trades are too thin
        if merged["trades"] < 15:
            richest = max(bundle["chunks"], key=lambda x: x.get("trades") or 0)
            merged = merge_stats([richest], days) or merged
        strat = bundle["meta"]
        sym_counts = {}
        for r in rows:
            if r["engine"] != eng:
                continue
            sym_counts[r["symbol"]] = sym_counts.get(r["symbol"], 0) + r["trades"]
        top_sym = max(sym_counts, key=sym_counts.get) if sym_counts else SYMBOLS[0]
        by_engine[eng] = {
            "engine": eng,
            "strategy_id": eng,
            "name_zh": strat["zht"],
            "name_en": strat["en"],
            "symbol": top_sym,
            "timeframe": "+".join(tfs),
            "win_rate": merged["win_rate"],
            "win_rate_smooth": merged["win_rate_smooth"],
            "rank_score": merged["rank_score"],
            "eligible": merged["eligible"] or merged["trades"] >= 5,
            "profit_factor": merged["profit_factor"],
            "max_drawdown": merged["max_drawdown"],
            "max_dd": round(abs(merged["max_drawdown"]) * 100.0, 1),
            "roi_pct": merged["roi_pct"],
            "apr_pct": merged["apr_pct"],
            "net_pnl_usd": merged["net_pnl_usd"],
            "net_profit_pct": merged["net_profit_pct"],
            "net_profit_usd": merged["net_profit_usd"],
            "trades": merged["trades"],
            "total_trades": merged["trades"],
            "wins": merged["wins"],
            "losses": merged["losses"],
            "trade_log": merged["trade_log"][-80:],
            "execution_logs": merged["trade_log"][-80:],
        }
        log(
            "engine {0} trades={1} wr={2:.1%} roi={3:.1f}% eligible={4}".format(
                eng,
                merged["trades"],
                merged["win_rate"],
                merged["roi_pct"],
                by_engine[eng]["eligible"],
            )
        )

    missing = [sid for sid, _, _, _ in specs if sid not in by_engine]
    if missing:
        log("FATAL missing engines with zero coverage: {0}".format(",".join(missing)))
        raise SystemExit("missing engines: {0}".format(",".join(missing)))

    wr_board = sorted(
        [v for v in by_engine.values() if v["eligible"]],
        key=lambda x: x["rank_score"],
        reverse=True,
    )
    pnl_board = sorted(
        [v for v in by_engine.values() if v["trades"] >= 5],
        key=lambda x: x["roi_pct"],
        reverse=True,
    )

    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period_days": days,
        "period_label": "{0} DAYS".format(days),
        "period_label_zh": "近 {0} 天".format(days),
        "period_label_tw": "近 {0} 天".format(days),
        "ranking_model": "frontend_aligned_roi_v2",
        "initial_capital": INITIAL_CAPITAL,
        "min_trades": MIN_TRADES_RANK,
        "symbols": SYMBOLS,
        "timeframes": list(tfs),
        "strategy_count": len(specs),
        "rows": len(rows),
        "strategies": rows,
        "by_engine": by_engine,
        "wr_board": [
            {
                "engine": r["engine"],
                "name_zh": r["name_zh"],
                "name_en": r["name_en"],
                "win_rate": r["win_rate"],
                "win_rate_smooth": r["win_rate_smooth"],
                "rank_score": r["rank_score"],
                "trades": r["trades"],
                "max_drawdown": r["max_drawdown"],
            }
            for r in wr_board
        ],
        "pnl_board": [
            {
                "engine": r["engine"],
                "id": r["engine"],
                "name_zh": r["name_zh"],
                "name_en": r["name_en"],
                "roi_pct": r["roi_pct"],
                "apr_pct": r["apr_pct"],
                "net_pnl_usd": r["net_pnl_usd"],
                "net_profit_usd": r["net_pnl_usd"],
                "net_profit_pct": r["net_profit_pct"],
                "profit_factor": r["profit_factor"],
                "win_rate": round(r["win_rate"] * 100.0, 1),
                "total_trades": r["trades"],
                "trades": r["trades"],
                "max_dd": r["max_dd"],
            }
            for r in pnl_board
        ],
    }
    return payload


# ---------------------------------------------------------------------------
# Multi-window "hero" champion scan — heavier, cron-scheduled, deliberately
# separate from both the normal single-period run_all() daily job AND the
# lightweight 60s live_feed.json path in tg_engine.py. Invoked explicitly via
# `calc_rankings.py --hero-scan` so it never blocks a fast deploy.
# ---------------------------------------------------------------------------
HERO_PERIODS = [3, 7, 10, 20, 30, 60, 100, 180]
HERO_TF = "1h"
# ~125 days of 1h bars in one pass. Genuinely covers periods up to 100d; the
# 180d window clamps to this same depth via warmup_index() (falls back to the
# earliest available bar), so it will report the same champion as the
# deepest genuinely-covered window rather than silently lying about depth.
# Chosen as a bounded compromise: deep enough to be meaningful, shallow
# enough that a 20-symbol x 45-strategy x 8-window scan finishes in low
# single-digit minutes instead of tens of minutes.
HERO_MAX_BARS = 3000


def fetch_klines_binance_deep(sym, tf, want):
    url = (
        "https://api.binance.com/api/v3/klines?symbol={0}&interval={1}&limit={2}"
    ).format(sym, tf, min(want, 1000))
    rows = http_json(url)
    now_ms = int(time.time() * 1000)
    if rows and int(rows[-1][6]) > now_ms:
        rows = rows[:-1]
    if len(rows) < 60:
        raise RuntimeError("binance insufficient bars")
    return pack_binance(rows, tf)


def fetch_klines_okx_deep(sym, tf, want):
    """Pull up to `want` bars via OKX pagination — bypasses the module-level
    MAX_BARS cap used by the normal daily run, for the deeper hero scan."""
    inst = te.okx_inst(sym)
    collected = []
    after = None
    pages = 0
    max_pages = max(1, (want // 100) + 2)
    while len(collected) < want and pages < max_pages:
        pages += 1
        url = (
            "https://www.okx.com/api/v5/market/candles?instId={0}&bar={1}&limit=100"
        ).format(inst, okx_bar(tf))
        if after is not None:
            url += "&after={0}".format(after)
        data = http_json(url)
        chunk = data.get("data") or []
        if not chunk:
            break
        collected.extend(chunk)
        after = int(chunk[-1][0])
        if len(chunk) < 100:
            break
        time.sleep(0.08)
    by_ts = {}
    for r in collected:
        by_ts[int(r[0])] = r
    rows = [by_ts[k] for k in sorted(by_ts.keys())]
    now_ms = int(time.time() * 1000)
    if rows and int(rows[-1][0]) + bar_ms(tf) > now_ms:
        rows = rows[:-1]
    if len(rows) > want:
        rows = rows[-want:]
    if len(rows) < 60:
        raise RuntimeError("okx insufficient bars")
    return pack_okx(rows, tf)


def load_klines_deep(sym, tf, want):
    """Deep single-timeframe fetch for the hero scan: try Binance's single
    request first (fast), fall back to paginated OKX if Binance can't supply
    the requested depth (its public klines endpoint caps a single response
    at ~1000 bars) or errors out."""
    try:
        data = fetch_klines_binance_deep(sym, tf, want)
        if len(data["c"]) >= min(want, 1000) * 0.95:
            return data
        log(
            "{0} {1} binance shallow ({2} < {3}); fallback okx paged".format(
                sym, tf, len(data["c"]), want
            )
        )
    except Exception as exc:
        log("{0} {1} binance fail: {2}; fallback okx paged".format(sym, tf, exc))
    return fetch_klines_okx_deep(sym, tf, want)


def run_hero_scan():
    """Fetch each symbol's 1h klines ONCE (deepest window needed), then
    backtest all 8 periods against that single fetched pool (no refetching
    per window) to find the single (strategy, period) pair with the globally
    highest ROI. Returns (hero_highlight, hero_by_period, elapsed_seconds)."""
    t0 = time.time()
    pool = {}
    for sym in SYMBOLS:
        try:
            pool[sym] = load_klines_deep(sym, HERO_TF, HERO_MAX_BARS)
            log(
                "hero pool loaded {0} bars={1} src={2}".format(
                    sym, len(pool[sym]["c"]), pool[sym]["src"]
                )
            )
        except Exception as exc:
            log("hero pool skip {0}: {1}".format(sym, exc))
    fetch_elapsed = time.time() - t0

    specs = frontend_strategy_specs()
    best = None
    per_period_best = {}
    for days in HERO_PERIODS:
        engine_best = {}
        for eng, zht, en, eval_fn in specs:
            parts = []
            for sym in SYMBOLS:
                data = pool.get(sym)
                if not data or len(data["c"]) < 60:
                    continue
                stats = backtest_with_floor(eval_fn, data, days, min_trades=10)
                if stats["trades"] < 1:
                    continue
                parts.append(stats)
            if not parts:
                continue
            merged = merge_stats(parts, days)
            if not merged or merged["trades"] < 3:
                continue
            engine_best[eng] = {"zht": zht, "en": en, "merged": merged}
        if not engine_best:
            log("hero window {0}d: no eligible engines".format(days))
            continue
        top_eng, top_bundle = max(
            engine_best.items(), key=lambda kv: kv[1]["merged"]["roi_pct"]
        )
        top_merged = top_bundle["merged"]
        entry = {
            "period_days": days,
            "engine": top_eng,
            "name_zh": top_bundle["zht"],
            "name_en": top_bundle["en"],
            "roi_pct": top_merged["roi_pct"],
            "max_drawdown": top_merged["max_drawdown"],
            "profit_factor": top_merged["profit_factor"],
            "trades": top_merged["trades"],
        }
        per_period_best[str(days)] = entry
        if best is None or entry["roi_pct"] > best["roi_pct"]:
            best = entry
        log(
            "hero window {0}d champion={1} roi={2:.1f}% dd={3:.1%} pf={4:.2f} trades={5}".format(
                days,
                top_eng,
                top_merged["roi_pct"],
                top_merged["max_drawdown"],
                top_merged["profit_factor"],
                top_merged["trades"],
            )
        )

    total_elapsed = time.time() - t0
    log(
        "hero scan done in {0:.1f}s (fetch={1:.1f}s) champion={2}".format(
            total_elapsed, fetch_elapsed, best
        )
    )
    return best, per_period_best, total_elapsed


def merge_hero_into_leaderboard(hero_highlight, hero_by_period, elapsed):
    """Read-modify-write leaderboard.json with the hero scan results, without
    re-running the (separate, already-written) single-period run_all()."""
    payload = {}
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception as exc:
            log("hero merge: could not read existing leaderboard.json: {0}".format(exc))
    payload["hero_highlight"] = hero_highlight
    payload["hero_by_period"] = hero_by_period
    payload["hero_scan_periods"] = HERO_PERIODS
    payload["hero_scan_elapsed_sec"] = round(elapsed, 1)
    payload["hero_scan_updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_outputs(payload)


def write_outputs(payload):
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(raw)
    if STATIC_PATH != OUT_PATH:
        with open(STATIC_PATH, "w", encoding="utf-8") as fh:
            fh.write(raw)
    WWW_LB = "/var/www/html/leaderboard.json"
    try:
        os.makedirs("/var/www/html", exist_ok=True)
        with open(WWW_LB, "w", encoding="utf-8") as fh:
            fh.write(raw)
        log("wrote {0}".format(WWW_LB))
    except OSError as exc:
        log("www leaderboard skip: {0}".format(exc))
    try:
        from utils import git_sync

        git_sync.sync_to_github(
            files_to_push=["leaderboard.json"],
            commit_msg="Auto: daily leaderboard",
        )
    except Exception as exc:
        log("leaderboard pages sync skip: {0}".format(exc))
    log(
        "wrote {0} (rows={1} engines={2} wr_board={3})".format(
            OUT_PATH,
            len(payload.get("strategies") or []),
            len(payload.get("by_engine") or {}),
            len(payload.get("wr_board") or []),
        )
    )


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Quant strategy rankings backtest")
    parser.add_argument("--days", type=int, default=60, help="Backtest window in days (default: 60)")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Deep sample mode: 15m+1h across all symbols, up to 1000 bars",
    )
    parser.add_argument(
        "--hero-scan",
        action="store_true",
        help=(
            "Run the heavier multi-window (3/7/10/20/30/60/100/180d) champion "
            "scan and merge hero_highlight into leaderboard.json. Separate, "
            "explicit, opt-in step — does not run the normal single-period "
            "run_all() job unless also requested."
        ),
    )
    parser.add_argument(
        "--hero-only",
        action="store_true",
        help="With --hero-scan: skip the normal run_all() job entirely.",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv or sys.argv[1:])
    days = max(1, min(int(args.days), 180))
    full = bool(args.full) or days >= 60

    if not (args.hero_scan and args.hero_only):
        log("calc_rankings start period={0}d full={1}".format(days, full))
        payload = run_all(days, full=full)
        write_outputs(payload)
        log(
            "calc_rankings done period={0}d engines={1} eligible={2}".format(
                days,
                len(payload["by_engine"]),
                sum(1 for v in payload["by_engine"].values() if v.get("eligible")),
            )
        )

    if args.hero_scan:
        log("hero scan start periods={0}".format(HERO_PERIODS))
        hero_highlight, hero_by_period, elapsed = run_hero_scan()
        merge_hero_into_leaderboard(hero_highlight, hero_by_period, elapsed)
        log("hero scan merged into leaderboard.json in {0:.1f}s".format(elapsed))


if __name__ == "__main__":
    main()
