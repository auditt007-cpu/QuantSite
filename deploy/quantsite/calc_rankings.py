# -*- coding: utf-8 -*-
"""Daily 30-day backtest rankings for 45-strategy matrix — stdlib only."""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import tg_engine as te  # noqa: E402

SYMBOLS = te.SYMBOLS
PERIOD_DAYS = 30
TIMEFRAMES = ("1d", "4h")
UA = te.UA
TIMEOUT = te.TIMEOUT
SSL_CTX = te.SSL_CTX
OUT_PATH = os.path.join(ROOT, "leaderboard.json")
STATIC_PATH = os.environ.get("LEADERBOARD_STATIC", os.path.join(ROOT, "leaderboard.json"))

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


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print("[{0}] {1}".format(ts, msg), flush=True)


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def bar_ms(tf):
    return {"15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000}[tf]


def kline_limit(tf):
    if tf == "1d":
        return max(45, PERIOD_DAYS + 15)
    if tf == "4h":
        return max(200, PERIOD_DAYS * 6 + 30)
    return 200


def binance_interval(tf):
    return tf


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


def fetch_klines(sym, tf):
    limit = kline_limit(tf)
    url = (
        "https://api.binance.com/api/v3/klines?symbol={0}&interval={1}&limit={2}"
    ).format(sym, binance_interval(tf), limit)
    rows = http_json(url)
    now_ms = int(time.time() * 1000)
    if rows and int(rows[-1][6]) > now_ms:
        rows = rows[:-1]
    if len(rows) < 30:
        raise RuntimeError("binance insufficient bars")
    return pack_binance(rows, tf)


def fetch_klines_okx(sym, tf):
    limit = kline_limit(tf)
    inst = te.okx_inst(sym)
    url = (
        "https://www.okx.com/api/v5/market/candles?instId={0}&bar={1}&limit={2}"
    ).format(inst, okx_bar(tf), limit)
    data = http_json(url)
    rows = list(reversed(data.get("data") or []))
    now_ms = int(time.time() * 1000)
    if rows and int(rows[-1][0]) + bar_ms(tf) > now_ms:
        rows = rows[:-1]
    if len(rows) < 30:
        raise RuntimeError("okx insufficient bars")
    return pack_okx(rows, tf)


def load_klines(sym, tf):
    try:
        return fetch_klines(sym, tf)
    except Exception as exc:
        log("{0} {1} binance fail: {2}; fallback okx".format(sym, tf, exc))
        return fetch_klines_okx(sym, tf)


def slice_data(data, i):
    return {k: data[k][: i + 1] for k in ("h", "l", "c", "v", "t")}


def window_start_index(data, tf):
    if not data["t"]:
        return 0
    cutoff = data["t"][-1] - PERIOD_DAYS * 86400000
    for i, ts in enumerate(data["t"]):
        if ts >= cutoff:
            return max(30, i)
    return 30


def backtest(eval_fn, data):
    start = window_start_index(data, data.get("tf", "1d"))
    rets = []
    eq = 1.0
    peak = 1.0
    max_dd = 0.0
    in_pos = False
    entry = 0.0
    c = data["c"]
    for i in range(start, len(c)):
        d = slice_data(data, i)
        try:
            side = eval_fn(d)
        except Exception:
            side = None
        px = c[i]
        if side == "LONG" and not in_pos:
            in_pos = True
            entry = px
        elif side == "SHORT" and in_pos:
            r = (px - entry) / entry if entry else 0.0
            rets.append(r)
            eq *= 1.0 + r
            peak = max(peak, eq)
            max_dd = min(max_dd, (eq - peak) / peak if peak else 0.0)
            in_pos = False
    if in_pos and entry:
        px = c[-1]
        r = (px - entry) / entry
        rets.append(r)
        eq *= 1.0 + r
        peak = max(peak, eq)
        max_dd = min(max_dd, (eq - peak) / peak if peak else 0.0)
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    wr = len(wins) / len(rets) if rets else 0.0
    gp = sum(wins)
    gl = abs(sum(losses))
    pf = gp / gl if gl > 1e-12 else (9.99 if gp > 0 else 0.0)
    return {
        "win_rate": round(wr, 4),
        "profit_factor": round(min(pf, 99.0), 2),
        "max_drawdown": round(max_dd, 4),
        "net_profit_pct": round(eq - 1.0, 4),
        "trades": len(rets),
    }


def family_id(strat_id):
    parts = strat_id.split("_")
    if len(parts) >= 3:
        return "_".join(parts[:-2])
    return strat_id


def run_all():
    rows = []
    pool = {}
    for sym in SYMBOLS:
        for tf in TIMEFRAMES:
            key = (sym, tf)
            try:
                pool[key] = load_klines(sym, tf)
                log("loaded {0} {1} bars={2}".format(sym, tf, len(pool[key]["c"])))
            except Exception as exc:
                log("skip pool {0} {1}: {2}".format(sym, tf, exc))

    for strat in te.STRATEGY_MATRIX:
        best = None
        for sym in SYMBOLS:
            for tf in TIMEFRAMES:
                data = pool.get((sym, tf))
                if not data or len(data["c"]) < 35:
                    continue
                stats = backtest(strat["eval"], data)
                if stats["trades"] < 1:
                    continue
                row = {
                    "id": strat["id"],
                    "family": family_id(strat["id"]),
                    "engine": FAMILY_ENGINE.get(family_id(strat["id"]), family_id(strat["id"])),
                    "name_zh": strat["zht"],
                    "name_en": strat["en"],
                    "symbol": sym,
                    "timeframe": tf,
                    **stats,
                }
                rows.append(row)
                if not best or stats["win_rate"] > best["win_rate"]:
                    best = row
        if best:
            log(
                "rank {0} wr={1:.1%} pf={2} sym={3} tf={4}".format(
                    strat["id"], best["win_rate"], best["profit_factor"], best["symbol"], best["timeframe"]
                )
            )

    by_engine = {}
    for row in rows:
        eng = row["engine"]
        cur = by_engine.get(eng)
        if not cur or row["win_rate"] > cur["win_rate"]:
            by_engine[eng] = {
                "engine": eng,
                "strategy_id": row["id"],
                "name_zh": row["name_zh"],
                "name_en": row["name_en"],
                "symbol": row["symbol"],
                "timeframe": row["timeframe"],
                "win_rate": row["win_rate"],
                "profit_factor": row["profit_factor"],
                "max_drawdown": row["max_drawdown"],
                "net_profit_pct": row["net_profit_pct"],
                "trades": row["trades"],
            }

    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period_days": PERIOD_DAYS,
        "symbols": SYMBOLS,
        "timeframes": list(TIMEFRAMES),
        "strategy_count": len(te.STRATEGY_MATRIX),
        "rows": len(rows),
        "strategies": rows,
        "by_engine": by_engine,
    }
    return payload


def write_outputs(payload):
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(raw)
    if STATIC_PATH != OUT_PATH:
        with open(STATIC_PATH, "w", encoding="utf-8") as fh:
            fh.write(raw)
    log("wrote {0} ({1} strategy rows, {2} engines)".format(OUT_PATH, len(payload["strategies"]), len(payload["by_engine"])))


def main():
    log("calc_rankings start period={0}d".format(PERIOD_DAYS))
    payload = run_all()
    write_outputs(payload)
    log("calc_rankings done")


if __name__ == "__main__":
    main()
