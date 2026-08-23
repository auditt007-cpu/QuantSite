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
def frontend_strategy_specs():
    E = te
    return [
        ("dual", "ATR雙SuperTrend", "Dual SuperTrend", lambda d: E.eval_supertrend_break(d, 10, 2.2)),
        ("ribbon", "EMA多周期共振", "Multi-Horizon EMA", lambda d: E.eval_ema_cross(d, 8, 21)),
        ("rsi", "RSI閾值交叉", "RSI Threshold Cross", lambda d: E.eval_rsi_cross(d, 35, 65)),
        ("squeeze", "布林擠壓突破", "BB Squeeze Break", lambda d: E.eval_bb_squeeze_break(d, 20)),
        ("atr", "ATR波動網格", "ATR Volatility Grid", lambda d: E.eval_atr_grid(d, 1.2)),
        ("qe", "短周期動量交叉", "Short-Horizon Momentum", lambda d: E.eval_ema_cross(d, 9, 21)),
        ("dm", "RSI背離代理", "RSI Divergence Proxy", E.eval_rsi_div_proxy),
        ("sn", "布林均值回歸", "Bollinger Rebound", lambda d: E.eval_bb_rebound(d, 20, 1.8)),
        ("eh", "EMA三均共振", "EMA Triple Stack", E.eval_ema_triple),
        ("gw", "唐奇安突破20", "Donchian 20 Break", lambda d: E.eval_donchian(d, 16)),
        ("ns", "MACD柱翻轉", "MACD Histogram Flip", E.eval_macd_hist_cross),
        ("sf", "MACD信號交叉", "MACD Signal Cross", E.eval_macd_signal_cross),
        ("qk", "肯特納突破", "Keltner Breakout", E.eval_keltner_break),
        ("hs", "樞軸點突破", "Pivot Point Break", E.eval_pivot_break),
        ("hg", "Dual Thrust", "Dual Thrust Break", lambda d: E.eval_dual_thrust(d, 3)),
        ("strat-001", "唐奇安突破", "Donchian Breakout", lambda d: E.eval_donchian(d, 12)),
        ("strat-002", "EMA雙均交叉", "EMA Crossover", lambda d: E.eval_ema_cross(d, 12, 26)),
        ("strat-003", "ATR超級趨勢", "SuperTrend Following", lambda d: E.eval_supertrend_break(d, 10, 2.5)),
        ("strat-004", "多周期動量", "Multi-Horizon Trend", lambda d: E.eval_ema_cross(d, 20, 50)),
        ("strat-005", "成交量價差VSA", "Volume Spread Analysis", lambda d: E.eval_vsa_spike(d, 1.3)),
        ("strat-006", "MACD動量", "MACD Momentum", E.eval_macd_signal_cross),
        ("strat-007", "ROC動能", "ROC Momentum", lambda d: E.eval_roc(d, 10, 0.25)),
        ("strat-008", "肯特納通道", "Keltner Channel", E.eval_keltner_break),
        ("strat-009", "樞軸點", "Pivot Points", E.eval_pivot_break),
        ("strat-010", "量均突破", "Volume MA Break", E.eval_vol_ma_break),
        ("strat-011", "複合動能", "Composite Momentum", E.eval_composite_mom),
        ("strat-012", "EMA快線交叉", "EMA Fast Cross", lambda d: E.eval_ema_cross(d, 5, 13)),
        ("strat-013", "布林寬帶回歸", "BB Wide Rebound", lambda d: E.eval_bb_rebound(d, 20, 2.2)),
        ("strat-014", "ROC20動能", "ROC-20 Momentum", lambda d: E.eval_roc(d, 20, 0.35)),
        ("strat-015", "唐奇安10", "Donchian 10", lambda d: E.eval_donchian(d, 10)),
        ("strat-016", "RSI超賣修復", "RSI Oversold Repair", lambda d: E.eval_rsi_cross(d, 32, 68)),
        ("strat-017", "ATR網格1.0", "ATR Grid Tight", lambda d: E.eval_atr_grid(d, 1.0)),
        ("strat-018", "MACD柱翻轉", "MACD Hist Flip", E.eval_macd_hist_cross),
        ("strat-019", "布林擠壓", "BB Squeeze", lambda d: E.eval_bb_squeeze_break(d, 18)),
        ("strat-020", "Dual Thrust快", "Dual Thrust Fast", lambda d: E.eval_dual_thrust(d, 3)),
        ("strat-021", "量價突破", "Vol Price Break", E.eval_vol_ma_break),
        ("strat-022", "EMA8/21", "EMA 8/21 Cross", lambda d: E.eval_ema_cross(d, 8, 21)),
        ("strat-023", "RSI背離", "RSI Divergence", E.eval_rsi_div_proxy),
        ("strat-024", "唐奇安14", "Donchian 14", lambda d: E.eval_donchian(d, 14)),
        ("strat-025", "肯特納快", "Keltner Fast", E.eval_keltner_break),
        ("strat-026", "複合動能B", "Composite Mom B", E.eval_composite_mom),
        ("strat-027", "ROC8動能", "ROC-8 Momentum", lambda d: E.eval_roc(d, 8, 0.2)),
        ("strat-028", "ATR趨勢", "ATR Trend Break", lambda d: E.eval_supertrend_break(d, 8, 2.0)),
        ("strat-029", "布林回歸1.6", "BB Rebound Soft", lambda d: E.eval_bb_rebound(d, 20, 1.6)),
        ("strat-030", "樞軸快線", "Pivot Fast", E.eval_pivot_break),
    ]


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


def slice_data(data, i):
    return {k: data[k][: i + 1] for k in ("h", "l", "c", "v", "t")}


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


def write_outputs(payload):
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(raw)
    if STATIC_PATH != OUT_PATH:
        with open(STATIC_PATH, "w", encoding="utf-8") as fh:
            fh.write(raw)
    log(
        "wrote {0} (rows={1} engines={2} wr_board={3})".format(
            OUT_PATH,
            len(payload["strategies"]),
            len(payload["by_engine"]),
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
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv or sys.argv[1:])
    days = max(1, min(int(args.days), 180))
    full = bool(args.full) or days >= 60
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


if __name__ == "__main__":
    main()
