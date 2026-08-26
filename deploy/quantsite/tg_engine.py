# -*- coding: utf-8 -*-
"""Event-driven Telegram signal engine — shared kline pool, 45-strategy matrix."""

import asyncio
import concurrent.futures as cf
import gc
import hashlib
import json
import logging
import math
import os
import ssl
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

try:
    import edge_tts
except ImportError:  # pragma: no cover - edge-tts not installed yet on this host
    edge_tts = None

try:
    from dotenv import load_dotenv

    _here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_here, ".env"))
    load_dotenv(os.path.join(_here, "..", "..", ".env"))
except Exception:
    pass

_here = os.path.dirname(os.path.abspath(__file__))
for _p in (_here, os.path.abspath(os.path.join(_here, "..", ".."))):
    if _p and _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from data_provider import fetch_engine_pack, last_meta as rails_last_meta
except Exception:
    fetch_engine_pack = None
    rails_last_meta = lambda: {}

try:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        force=True,
    )
except TypeError:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
logger = logging.getLogger("tg_engine")

BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "").strip()
CHANNEL = (
    os.environ.get("TG_CHANNEL_ID", "").strip()
    or os.environ.get("TG_CHANNEL", "").strip()
    or "@quant_alpha_signals"
)
# 20-symbol display universe (ticker / feed metadata)
SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
    "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT", "NEARUSDT", "ONDOUSDT",
    "OPUSDT", "ARBUSDT", "PEPEUSDT", "SHIBUSDT", "APTUSDT", "INJUSDT",
    "RENDERUSDT", "AAVEUSDT",
]
# Mainstream scan pool — includes live-room 8 so tape rows match the war-room watchlist
SCAN_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "ONDOUSDT", "DOGEUSDT", "SUIUSDT",
    "NEARUSDT", "PEPEUSDT", "BNBUSDT", "XRPUSDT", "LINKUSDT", "AVAXUSDT",
]
LIVE_ROOM_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "ONDOUSDT", "DOGEUSDT", "SUIUSDT",
    "NEARUSDT", "PEPEUSDT",
]
# Per-strategy tape cap: prefer these when multiple symbols fire same cycle
PRIORITY_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
MAX_TAPE_EVENTS_PER_STRATEGY = 3
TG_CHANNEL_TF = "1h"
TG_BRIEF_SYMBOLS = frozenset({"BTCUSDT", "ETHUSDT", "SOLUSDT"})
TG_DIGEST_BUF = []
TG_DIGEST_HOUR = None
TIMEFRAMES = ("15m", "1h")
POLL_SEC = 15
FEED_PUBLISH_SEC = 5
HEARTBEAT_SEC = 180
KLINE_LIMIT = 200
POOL_WORKERS = 8
LIVE_FEED_WORKERS = 8
LIVE_FEED_TF = "1h"
LIVE_FEED_WINDOW_SEC = 3 * 3600
LIVE_FEED_LOOKBACK_BARS = 4  # small margin over the 3h window in 1h bars
LIVE_FEED_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_feed.json")
WEB_FEED_PATH = os.environ.get("WEB_FEED_PATH", "/var/www/html/live_feed.json")
WEB_SIGNALS_PATH = os.environ.get("WEB_SIGNALS_PATH", "/var/www/html/data/signals.json")
LIVE_EXEC_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_exec_log.json")
LIVE_POSITION_STATE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "live_position_state.json"
)
LIVE_EXEC_LOG_MAX = 200
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
TIMEOUT = 15
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

SIGNAL_STATE = {}
HEARTBEAT_STATE = {}
HEARTBEAT_POOL = {}
KLINE_POOL = {}
LIVE_POSITION_STATE = {}
LIVE_POSITION_LOCK = threading.Lock()
_POSITION_STATE_LOADED = False
# True only on the first cycle after a missing/empty state file. Snapshot
# current holdings without writing tape rows — otherwise a restart looks
# like 45×20 brand-new fills.
_POSITION_STATE_HYDRATING = False

SIDE_ZHT = {"LONG": "做多", "SHORT": "做空"}
SIDE_EN = {"LONG": "LONG", "SHORT": "SHORT"}


def log(msg, level=logging.INFO):
    try:
        logger.log(level, "%s", msg)
    except Exception:
        try:
            sys.stderr.write(str(msg) + "\n")
        except Exception:
            pass


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as resp:
        raw = resp.read().decode("utf-8", "replace")
    return json.loads(raw)


def okx_inst(sym):
    return "{0}-USDT".format(sym.replace("USDT", ""))


def binance_interval(tf):
    if tf in ("1m", "5m", "15m"):
        return tf
    return "1h"


def okx_bar(tf):
    return {"1m": "1m", "5m": "5m", "15m": "15m"}.get(tf, "1H")


def bar_duration_ms(tf):
    mins = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440}.get(
        str(tf or "1h").lower(), 60
    )
    return mins * 60 * 1000


def tf_seconds(tf):
    return int(bar_duration_ms(tf) / 1000)


def bar_close_ts(open_ts, tf):
    """Stamp signals at candle CLOSE time (open + interval), not open."""
    try:
        n = int(float(open_ts))
    except (TypeError, ValueError):
        return 0
    if n > 10_000_000_000:
        n = int(n / 1000)
    if n <= 0:
        return 0
    return int(n + tf_seconds(tf))


def fetch_binance_klines(sym, tf, limit):
    """US-neutral rails (Coinbase -> Binance.US -> Kraken). Name kept for call-sites."""
    if fetch_engine_pack is not None:
        pack = fetch_engine_pack(sym, tf, limit)
        if pack and pack.get("c") and len(pack["c"]) >= 20:
            return pack
        raise RuntimeError((rails_last_meta() or {}).get("error") or "neutral rails empty")
    raise RuntimeError("data_provider missing")


def fetch_klines(sym, tf):
    return fetch_binance_klines(sym, tf, KLINE_LIMIT)


def fetch_klines_okx(sym, tf):
    url = (
        "https://www.okx.com/api/v5/market/candles?instId={0}&bar={1}&limit={2}"
    ).format(okx_inst(sym), okx_bar(tf), KLINE_LIMIT)
    data = http_json(url)
    rows = list(reversed(data.get("data") or []))
    now_ms = int(time.time() * 1000)
    if rows and int(rows[-1][0]) + bar_duration_ms(tf) > now_ms:
        rows = rows[:-1]
    if len(rows) < 60:
        raise RuntimeError("okx insufficient bars")
    return pack_rows(rows, "okx", binance=False, tf=tf)


def pack_rows(rows, src, binance, tf="15m"):
    h, l, c, v, t = [], [], [], [], []
    close_ms = 0
    for r in rows:
        if binance:
            t.append(int(r[0]))
            h.append(float(r[2]))
            l.append(float(r[3]))
            c.append(float(r[4]))
            v.append(float(r[5]))
            close_ms = int(r[6])
        else:
            t.append(int(r[0]))
            h.append(float(r[2]))
            l.append(float(r[3]))
            c.append(float(r[4]))
            v.append(float(r[5]))
    if not binance:
        if len(t) >= 2:
            close_ms = t[-1] + abs(t[-1] - t[-2])
        elif t:
            close_ms = t[-1] + bar_duration_ms(tf)
    return {"h": h, "l": l, "c": c, "v": v, "t": t, "close_ms": close_ms, "src": src}


def load_klines(sym, tf):
    return fetch_klines(sym, tf)


def refresh_pool():
    """Parallel-fetch every (symbol, timeframe) pair so a 20-symbol pool still
    refreshes comfortably inside the 60s poll budget."""
    global KLINE_POOL
    pairs = [(sym, tf) for sym in SYMBOLS for tf in TIMEFRAMES]

    def fetch_one(pair):
        sym, tf = pair
        try:
            return pair, load_klines(sym, tf), None
        except Exception as exc:
            return pair, None, exc

    with cf.ThreadPoolExecutor(max_workers=POOL_WORKERS) as ex:
        for pair, data, exc in ex.map(fetch_one, pairs):
            if data is not None:
                KLINE_POOL[pair] = data
            else:
                log("pool skip {0} {1}: {2}".format(pair[0], pair[1], exc))


def ema(vals, n):
    if not vals:
        return []
    k = 2.0 / (n + 1)
    out = [vals[0]]
    for x in vals[1:]:
        out.append(x * k + out[-1] * (1 - k))
    return out


def sma(vals, n):
    out = []
    s = 0.0
    for i, x in enumerate(vals):
        s += x
        if i >= n:
            s -= vals[i - n]
        out.append(s / float(n) if i >= n - 1 else s / float(i + 1))
    return out


def stdev(vals, n):
    out = [0.0] * len(vals)
    for i in range(len(vals)):
        w = vals[max(0, i - n + 1) : i + 1]
        m = sum(w) / float(len(w))
        out[i] = math.sqrt(sum((x - m) ** 2 for x in w) / float(len(w)))
    return out


def rsi(closes, n=14):
    out = [50.0] * len(closes)
    if len(closes) < n + 1:
        return out
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            gains += d
        else:
            losses -= d
    ag = gains / n
    al = losses / n
    out[n] = 100.0 if al == 0 else 100.0 - 100.0 / (1 + ag / al)
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        g = d if d > 0 else 0.0
        l = -d if d < 0 else 0.0
        ag = (ag * (n - 1) + g) / n
        al = (al * (n - 1) + l) / n
        out[i] = 100.0 if al == 0 else 100.0 - 100.0 / (1 + ag / al)
    return out


def macd_line_signal(closes):
    e12 = ema(closes, 12)
    e26 = ema(closes, 26)
    line = [a - b for a, b in zip(e12, e26)]
    sig = ema(line, 9)
    return line, sig


def macd_hist(closes):
    line, sig = macd_line_signal(closes)
    return [a - b for a, b in zip(line, sig)]


def atr(h, l, c, n=14):
    tr = [0.0] * len(c)
    for i in range(len(c)):
        if i == 0:
            tr[i] = h[i] - l[i]
        else:
            tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    return ema(tr, n)


def cross_up(a, b):
    return a[-1] > b[-1] and a[-2] <= b[-2]


def cross_down(a, b):
    return a[-1] < b[-1] and a[-2] >= b[-2]


def event_long_short(cond_long, cond_short):
    if cond_long:
        return "LONG"
    if cond_short:
        return "SHORT"
    return None


def levels(px, side, risk):
    if side == "LONG":
        return round(px - risk, 6), round(px + 2.0 * risk, 6)
    return round(px + risk, 6), round(px - 2.0 * risk, 6)


def eval_ema_cross(d, fast, slow):
    c = d["c"]
    if len(c) < slow + 2:
        return None
    f, s = ema(c, fast), ema(c, slow)
    return event_long_short(cross_up(f, s), cross_down(f, s))


def eval_ema_triple(d):
    c = d["c"]
    if len(c) < 58:
        return None
    e8, e21, e55 = ema(c, 8), ema(c, 21), ema(c, 55)
    long_ok = e8[-1] > e21[-1] > e55[-1] and not (e8[-2] > e21[-2] > e55[-2])
    short_ok = e8[-1] < e21[-1] < e55[-1] and not (e8[-2] < e21[-2] < e55[-2])
    return event_long_short(long_ok, short_ok)


def eval_donchian(d, n):
    h, l, c = d["h"], d["l"], d["c"]
    if len(c) < n + 2:
        return None
    up = max(h[-n - 1 : -1])
    dn = min(l[-n - 1 : -1])
    return event_long_short(c[-1] > up and c[-2] <= up, c[-1] < dn and c[-2] >= dn)


def eval_bb_rebound(d, n, mult):
    c = d["c"]
    if len(c) < n + 2:
        return None
    m = sma(c, n)
    sd = stdev(c, n)
    lo = m[-1] - mult * sd[-1]
    hi = m[-1] + mult * sd[-1]
    return event_long_short(c[-1] > lo and c[-2] <= lo, c[-1] < hi and c[-2] >= hi)


def eval_bb_micro(d):
    """Looser 5m band touch — keeps the war-room tape alive in chop."""
    return eval_bb_rebound(d, 20, 1.45)


def eval_bb_squeeze_break(d, n):
    c = d["c"]
    if len(c) < n + 5:
        return None
    m = sma(c, n)
    sd = stdev(c, n)
    width = [(sd[i] / m[i] if m[i] else 0) for i in range(len(c))]
    tight = width[-2] < sorted(width[-n:])[n // 4]
    hi = m[-1] + 2 * sd[-1]
    lo = m[-1] - 2 * sd[-1]
    if not tight:
        return None
    return event_long_short(c[-1] > hi, c[-1] < lo)


def eval_rsi_cross(d, lo, hi):
    c = d["c"]
    r = rsi(c, 14)
    if len(r) < 3:
        return None
    return event_long_short(r[-2] < lo <= r[-1], r[-2] > hi >= r[-1])


def eval_rsi_div_proxy(d):
    c = d["c"]
    r = rsi(c, 14)
    if len(c) < 5:
        return None
    long_ok = c[-1] < c[-3] and r[-1] > r[-3] and r[-2] < 35
    short_ok = c[-1] > c[-3] and r[-1] < r[-3] and r[-2] > 65
    return event_long_short(long_ok, short_ok)


def eval_macd_hist_cross(d):
    hist = macd_hist(d["c"])
    if len(hist) < 3:
        return None
    return event_long_short(cross_up(hist, [0.0] * len(hist)), cross_down(hist, [0.0] * len(hist)))


def eval_macd_signal_cross(d):
    line, sig = macd_line_signal(d["c"])
    if len(line) < 3:
        return None
    return event_long_short(cross_up(line, sig), cross_down(line, sig))


def eval_supertrend_break(d, atr_n, mult):
    h, l, c = d["h"], d["l"], d["c"]
    a = atr(h, l, c, atr_n)
    mid = (h[-1] + l[-1]) / 2.0
    up = mid + mult * a[-1]
    dn = mid - mult * a[-1]
    return event_long_short(c[-1] > up and c[-2] <= up, c[-1] < dn and c[-2] >= dn)


def eval_atr_grid(d, mult):
    h, l, c = d["h"], d["l"], d["c"]
    a = atr(h, l, c, 14)
    mid = ema(c, 20)[-1]
    band = mult * a[-1]
    return event_long_short(c[-1] > mid + band and c[-2] <= mid + band, c[-1] < mid - band and c[-2] >= mid - band)


def eval_vsa_spike(d, vol_mult):
    c, v = d["c"], d["v"]
    if len(c) < 22:
        return None
    avg_v = sum(v[-21:-1]) / 20.0
    spike = v[-1] > vol_mult * avg_v
    if not spike:
        return None
    up_bar = c[-1] >= c[-2]
    return event_long_short(up_bar, not up_bar)


def eval_roc(d, n, thresh):
    c = d["c"]
    if len(c) <= n + 1 or c[-n - 1] == 0:
        return None
    roc = (c[-1] / c[-n - 1] - 1.0) * 100.0
    roc_p = (c[-2] / c[-n - 2] - 1.0) * 100.0
    return event_long_short(roc > thresh and roc_p <= thresh, roc < -thresh and roc_p >= -thresh)


def eval_keltner_break(d):
    h, l, c = d["h"], d["l"], d["c"]
    if len(c) < 22:
        return None
    mid = ema(c, 20)
    a = atr(h, l, c, 10)
    up = mid[-1] + 1.5 * a[-1]
    dn = mid[-1] - 1.5 * a[-1]
    return event_long_short(c[-1] > up and c[-2] <= up, c[-1] < dn and c[-2] >= dn)


def eval_pivot_break(d):
    h, l, c = d["h"], d["l"], d["c"]
    if len(c) < 3:
        return None
    piv = (h[-2] + l[-2] + c[-2]) / 3.0
    r1 = 2 * piv - l[-2]
    s1 = 2 * piv - h[-2]
    return event_long_short(c[-1] > r1 and c[-2] <= r1, c[-1] < s1 and c[-2] >= s1)


def eval_dual_thrust(d, k):
    h, l, c = d["h"], d["l"], d["c"]
    if len(c) < k + 2:
        return None
    hh = max(h[-k - 1 : -1])
    ll = min(l[-k - 1 : -1])
    rng = hh - ll
    up = c[-2] + 0.5 * rng
    dn = c[-2] - 0.5 * rng
    return event_long_short(c[-1] > up, c[-1] < dn)


def eval_vol_ma_break(d):
    c, v = d["c"], d["v"]
    if len(v) < 22:
        return None
    vma = sma(v, 20)
    return event_long_short(v[-1] > vma[-1] * 1.2 and c[-1] > c[-2], v[-1] > vma[-1] * 1.2 and c[-1] < c[-2])


def eval_composite_mom(d):
    c = d["c"]
    hist = macd_hist(c)
    if len(c) < 12:
        return None
    roc = (c[-1] / c[-11] - 1.0) if c[-11] else 0.0
    return event_long_short(hist[-1] > 0 and roc > 0.003, hist[-1] < 0 and roc < -0.003)


# ---------------------------------------------------------------------------
# Canonical plaza strategy IDs (must stay byte-identical to
# js/engine-list.js / terminal.js FALLBACK_ENGINES and calc_rankings.py).
# Live scan is 1:1 with this list — add one here (+ engine-list.js) and it
# enters live on the next tg-bot cycle after deploy/restart.
# ---------------------------------------------------------------------------
def frontend_strategy_specs():
    return [
        ("dual", "ATR雙SuperTrend", "Dual SuperTrend", lambda d: eval_supertrend_break(d, 10, 2.2)),
        ("ribbon", "EMA多周期共振", "Multi-Horizon EMA", lambda d: eval_ema_cross(d, 8, 21)),
        ("rsi", "RSI閾值交叉", "RSI Threshold Cross", lambda d: eval_rsi_cross(d, 35, 65)),
        ("squeeze", "布林擠壓突破", "BB Squeeze Break", lambda d: eval_bb_squeeze_break(d, 20)),
        ("atr", "ATR波動網格", "ATR Volatility Grid", lambda d: eval_atr_grid(d, 1.2)),
        ("qe", "短周期動量交叉", "Short-Horizon Momentum", lambda d: eval_ema_cross(d, 9, 21)),
        ("dm", "RSI背離代理", "RSI Divergence Proxy", eval_rsi_div_proxy),
        ("sn", "布林均值回歸", "Bollinger Rebound", lambda d: eval_bb_rebound(d, 20, 1.8)),
        ("eh", "EMA三均共振", "EMA Triple Stack", eval_ema_triple),
        ("gw", "唐奇安突破20", "Donchian 20 Break", lambda d: eval_donchian(d, 16)),
        ("ns", "MACD柱翻轉", "MACD Histogram Flip", eval_macd_hist_cross),
        ("sf", "MACD信號交叉", "MACD Signal Cross", eval_macd_signal_cross),
        ("qk", "肯特納突破", "Keltner Breakout", eval_keltner_break),
        ("hs", "樞軸點突破", "Pivot Point Break", eval_pivot_break),
        ("hg", "Dual Thrust", "Dual Thrust Break", lambda d: eval_dual_thrust(d, 3)),
        ("strat-001", "唐奇安突破", "Donchian Breakout", lambda d: eval_donchian(d, 12)),
        ("strat-002", "EMA雙均交叉", "EMA Crossover", lambda d: eval_ema_cross(d, 12, 26)),
        ("strat-003", "ATR超級趨勢", "SuperTrend Following", lambda d: eval_supertrend_break(d, 10, 2.5)),
        ("strat-004", "多周期動量", "Multi-Horizon Trend", lambda d: eval_ema_cross(d, 20, 50)),
        ("strat-005", "成交量價差VSA", "Volume Spread Analysis", lambda d: eval_vsa_spike(d, 1.3)),
        ("strat-006", "MACD動量", "MACD Momentum", eval_macd_signal_cross),
        ("strat-007", "ROC動能", "ROC Momentum", lambda d: eval_roc(d, 10, 0.25)),
        ("strat-008", "肯特納通道", "Keltner Channel", eval_keltner_break),
        ("strat-009", "樞軸點", "Pivot Points", eval_pivot_break),
        ("strat-010", "量均突破", "Volume MA Break", eval_vol_ma_break),
        ("strat-011", "複合動能", "Composite Momentum", eval_composite_mom),
        ("strat-012", "EMA快線交叉", "EMA Fast Cross", lambda d: eval_ema_cross(d, 5, 13)),
        ("strat-013", "布林寬帶回歸", "BB Wide Rebound", lambda d: eval_bb_rebound(d, 20, 2.2)),
        ("strat-014", "ROC20動能", "ROC-20 Momentum", lambda d: eval_roc(d, 20, 0.35)),
        ("strat-015", "唐奇安10", "Donchian 10", lambda d: eval_donchian(d, 10)),
        ("strat-016", "RSI超賣修復", "RSI Oversold Repair", lambda d: eval_rsi_cross(d, 32, 68)),
        ("strat-017", "ATR網格1.0", "ATR Grid Tight", lambda d: eval_atr_grid(d, 1.0)),
        ("strat-018", "MACD柱翻轉", "MACD Hist Flip", eval_macd_hist_cross),
        ("strat-019", "布林擠壓", "BB Squeeze", lambda d: eval_bb_squeeze_break(d, 18)),
        ("strat-020", "Dual Thrust快", "Dual Thrust Fast", lambda d: eval_dual_thrust(d, 3)),
        ("strat-021", "量價突破", "Vol Price Break", eval_vol_ma_break),
        ("strat-022", "EMA8/21", "EMA 8/21 Cross", lambda d: eval_ema_cross(d, 8, 21)),
        ("strat-023", "RSI背離", "RSI Divergence", eval_rsi_div_proxy),
        ("strat-024", "唐奇安14", "Donchian 14", lambda d: eval_donchian(d, 14)),
        ("strat-025", "肯特納快", "Keltner Fast", eval_keltner_break),
        ("strat-026", "複合動能B", "Composite Mom B", eval_composite_mom),
        ("strat-027", "ROC8動能", "ROC-8 Momentum", lambda d: eval_roc(d, 8, 0.2)),
        ("strat-028", "ATR趨勢", "ATR Trend Break", lambda d: eval_supertrend_break(d, 8, 2.0)),
        ("strat-029", "布林回歸1.6", "BB Rebound Soft", lambda d: eval_bb_rebound(d, 20, 1.6)),
        ("strat-030", "樞軸快線", "Pivot Fast", eval_pivot_break),
    ]


def plaza_strategy_ids():
    return [sid for sid, _z, _e, _fn in frontend_strategy_specs()]


def build_strategy_matrix(plaza_specs=None):
    """Plaza → Live 1:1. Same strategy_id as the plaza, scanned on each live TF."""
    plaza = plaza_specs if plaza_specs is not None else frontend_strategy_specs()
    out = []
    for sid, zht, en, fn in plaza:
        for tf in TIMEFRAMES:
            out.append(
                {
                    "id": sid,
                    "zht": zht,
                    "en": en,
                    "tf": tf,
                    "eval": fn,
                    "plaza_id": sid,
                }
            )
    return out


STRATEGY_MATRIX = build_strategy_matrix()


def refresh_strategy_matrix():
    """Rebuild live matrix from plaza specs each cycle (add one → enters live)."""
    global STRATEGY_MATRIX
    STRATEGY_MATRIX = build_strategy_matrix()
    return STRATEGY_MATRIX


def write_plaza_live_registry():
    """Publish plaza↔live registry so ops/UI can verify 1:1 sync."""
    ids = plaza_strategy_ids()
    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "plaza_count": len(ids),
        "live_scan_slots": len(ids) * len(TIMEFRAMES),
        "timeframes": list(TIMEFRAMES),
        "strategy_ids": ids,
        "sync": "1:1",
        "how_to_add": (
            "Append to frontend_strategy_specs() and js/engine-list.js, "
            "redeploy tg-bot — next cycle picks it up."
        ),
    }
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    try:
        atomic_write_json(
            os.path.join(os.path.dirname(LIVE_FEED_PATH), "plaza_live_registry.json"),
            raw,
        )
    except Exception as exc:
        log("plaza_live_registry write skip: {0}".format(exc))
    try:
        web = os.path.join(os.path.dirname(WEB_FEED_PATH), "plaza_live_registry.json")
        atomic_write_json(web, raw)
    except Exception as exc:
        log("plaza_live_registry web skip: {0}".format(exc))
    return payload


def _slice_tail(data, i):
    return {
        "h": data["h"][: i + 1],
        "l": data["l"][: i + 1],
        "c": data["c"][: i + 1],
        "v": data["v"][: i + 1],
        "t": data["t"][: i + 1],
    }


def _scan_recent_signal(eval_fn, data, now_sec, tf="1h"):
    """Walk the last few CLOSED bars (newest first) and return the most recent
    LONG/SHORT hit still inside the live-feed window, or None.
    bar_ts is stamped at candle CLOSE (open + interval)."""
    c = data["c"]
    n = len(c)
    if n < 30:
        return None
    # Skip the still-forming last candle so close-time stamps are in the past.
    end_i = n - 2 if n >= 31 else n - 1
    floor_i = max(29, end_i - LIVE_FEED_LOOKBACK_BARS)
    for i in range(end_i, floor_i - 1, -1):
        open_sec = data["t"][i] / 1000.0
        close_sec = open_sec + tf_seconds(tf)
        if close_sec < now_sec - LIVE_FEED_WINDOW_SEC:
            break
        try:
            side = eval_fn(_slice_tail(data, i))
        except Exception:
            continue
        if side in ("LONG", "SHORT"):
            return {"side": side, "bar_ts": close_sec, "price": c[i]}
    return None


LIVE_FEED_KLINE_LIMIT = 150
# Dedicated fast-path limit for the live-feed matrix. Deliberately small so
# the fetch (20 symbols x 1h, parallelized) finishes in a couple seconds and
# never depends on the heavier KLINE_LIMIT=200 x (15m+1h) x 20-symbol pool
# used by the legacy TG-alert scanner. It must still be >~58 bars though,
# since the hungriest eval_* strategy (eval_ema_triple, EMA-55 stack) needs
# that much warmup to ever produce a signal — literally fetching only the
# last few hours of candles would make almost every strategy return None
# forever (they safely guard with `if len(c) < N: return None`, so nothing
# crashes, but the feed would look permanently empty). 150 x 1h bars (~6
# days) is the sweet spot: fast to fetch, deep enough for every strategy.


# ---------------------------------------------------------------------------
# Edge-TTS sweet-voice audio pipeline
#
# Design constraints: TTS generation must NEVER block the fast live_feed.json
# write cycle. Every generation call runs on a small dedicated background
# thread pool; callers get the public URL immediately if the mp3 already
# exists on disk (from an earlier cycle), or None otherwise while generation
# continues in the background — the next 60s cycle will pick up the finished
# file naturally since signals keep the same cache key until their bar ages
# out of the lookback window.
# ---------------------------------------------------------------------------
AUDIO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio")
AUDIO_VOICE = "zh-TW-HsiaoChenNeural"
AUDIO_RATE = "+22%"
AUDIO_PITCH = "+18Hz"
# Site is served by GitHub Pages from the repo root (see CNAME -> quantalpha.space).
# _ssh_push.py fetches everything under AUDIO_DIR back into <repo>/audio/ so it
# becomes reachable at https://quantalpha.space/audio/<file>.mp3 once pushed.
AUDIO_PUBLIC_PREFIX = "/audio"
AUDIO_EXECUTOR = cf.ThreadPoolExecutor(max_workers=2)
AUDIO_INFLIGHT = set()
AUDIO_INFLIGHT_LOCK = threading.Lock()

WELCOME_TEXTS = [
    "哥哥，歡迎來到實時作戰室～策略和信號都幫你盯好囉，今天也要精準踩點，跟著我一起吃大波段喔～",
    "哈囉～歡迎進入量化作戰室！算力矩陣已經就位囉，帶好停損，剩下的拐點信號就交給我來抓吧～",
    "您好呀，作戰室已為您連線全球節點。行情波動很大，記得看好我的信號提醒，祝您今天交易順利、穩穩收米喔～",
]

# Idle clips kept on disk for legacy caches; the live command deck never
# plays them — voice fires only on genuine side-change events.
IDLE_TEXTS = [
    "行情還在蓄力哦，哥哥再耐心等一下下嘛～",
    "目前盤面有點無聊，但我還在幫你死死盯著呢！",
]
# Played (instead of the normal per-signal clip) when a real signal fires
# from a "focus" strategy (Donchian breakout / mean reversion family).
HIGH_CONVICTION_TEXT = "出現高確定性信號，請注意！"


def _tts_generate_sync(text, out_path):
    if edge_tts is None:
        raise RuntimeError("edge_tts not installed")
    tmp = out_path + ".tmp"

    async def _run():
        communicate = edge_tts.Communicate(text, AUDIO_VOICE, rate=AUDIO_RATE, pitch=AUDIO_PITCH)
        await communicate.save(tmp)

    asyncio.run(_run())
    os.replace(tmp, out_path)


def audio_public_url(filename):
    return "{0}/{1}".format(AUDIO_PUBLIC_PREFIX, filename)


def ensure_welcome_audio(force=False):
    """Pre-generate the 3 welcome MP3s once; skip regeneration if already
    present on disk (so a service restart doesn't re-hit the TTS API)."""
    os.makedirs(AUDIO_DIR, exist_ok=True)
    for i, text in enumerate(WELCOME_TEXTS, start=1):
        path = os.path.join(AUDIO_DIR, "welcome_{0}.mp3".format(i))
        if not force and os.path.exists(path) and os.path.getsize(path) > 1000:
            continue
        try:
            _tts_generate_sync(text, path)
            log("welcome audio generated: welcome_{0}.mp3".format(i))
        except Exception as exc:
            log("welcome audio failed ({0}): {1}".format(i, exc))


def ensure_funnel_audio(force=False):
    """Pre-generate one 'monitoring created' confirmation clip per canonical
    frontend strategy id (45 total) — lets live.html's checkbox funnel play
    a per-strategy voice line after its 500ms debounce without needing any
    on-demand TTS HTTP endpoint (this bot has no HTTP server)."""
    os.makedirs(AUDIO_DIR, exist_ok=True)
    for sid, zht, en, _fn in frontend_strategy_specs():
        path = os.path.join(AUDIO_DIR, "funnel_{0}.mp3".format(sid))
        if not force and os.path.exists(path) and os.path.getsize(path) > 500:
            continue
        text = "策略（{0}）監控已生成，請注意語音播報喔～".format(zht)
        try:
            _tts_generate_sync(text, path)
            log("funnel audio generated: funnel_{0}.mp3".format(sid))
        except Exception as exc:
            log("funnel audio failed ({0}): {1}".format(sid, exc))
    multi_path = os.path.join(AUDIO_DIR, "funnel_multi.mp3")
    if force or not (os.path.exists(multi_path) and os.path.getsize(multi_path) > 500):
        multi_text = "多選策略已生成，請注意語音播報喔～"
        try:
            _tts_generate_sync(multi_text, multi_path)
            log("funnel audio generated: funnel_multi.mp3")
        except Exception as exc:
            log("funnel multi audio failed: {0}".format(exc))


def ensure_idle_audio(force=False):
    """Pre-generate the idle-comfort clips + the high-conviction alert clip.
    Same skip-if-exists behavior as ensure_welcome_audio()."""
    os.makedirs(AUDIO_DIR, exist_ok=True)
    for i, text in enumerate(IDLE_TEXTS, start=1):
        path = os.path.join(AUDIO_DIR, "idle_{0}.mp3".format(i))
        if not force and os.path.exists(path) and os.path.getsize(path) > 1000:
            continue
        try:
            _tts_generate_sync(text, path)
            log("idle audio generated: idle_{0}.mp3".format(i))
        except Exception as exc:
            log("idle audio failed ({0}): {1}".format(i, exc))
    alert_path = os.path.join(AUDIO_DIR, "alert_high_conviction.mp3")
    if force or not (os.path.exists(alert_path) and os.path.getsize(alert_path) > 500):
        try:
            _tts_generate_sync(HIGH_CONVICTION_TEXT, alert_path)
            log("alert audio generated: alert_high_conviction.mp3")
        except Exception as exc:
            log("alert audio failed: {0}".format(exc))


def _purge_audio_glob(prefix):
    """Remove cached mp3 files matching prefix (e.g. 'sig_' or 'welcome_')."""
    if not os.path.isdir(AUDIO_DIR):
        return 0
    removed = 0
    for name in os.listdir(AUDIO_DIR):
        if name.startswith(prefix) and name.endswith(".mp3"):
            try:
                os.remove(os.path.join(AUDIO_DIR, name))
                removed += 1
            except OSError as exc:
                log("audio purge skip {0}: {1}".format(name, exc))
    return removed


def regenerate_all_audio():
    """Force-regenerate welcome + funnel clips and purge dynamic signal cache."""
    if edge_tts is None:
        raise RuntimeError("edge_tts not installed")
    os.makedirs(AUDIO_DIR, exist_ok=True)
    n_sig = _purge_audio_glob("sig_")
    n_wel = _purge_audio_glob("welcome_")
    n_fun = _purge_audio_glob("funnel_")
    n_idl = _purge_audio_glob("idle_")
    log(
        "audio purge removed welcome={0} funnel={1} signal={2} idle={3}".format(n_wel, n_fun, n_sig, n_idl)
    )
    ensure_welcome_audio(force=True)
    ensure_funnel_audio(force=True)
    ensure_idle_audio(force=True)
    log(
        "audio regen complete voice={0} rate={1} pitch={2}".format(
            AUDIO_VOICE, AUDIO_RATE, AUDIO_PITCH
        )
    )


def request_signal_audio(cache_key, text):
    """Fire-and-forget TTS generation keyed by a stable content hash. Returns
    the public URL immediately if the mp3 is already on disk; otherwise
    schedules background generation and returns None (a later cycle attaches
    the URL once the file exists)."""
    if edge_tts is None:
        return None
    filename = "sig_{0}.mp3".format(cache_key)
    path = os.path.join(AUDIO_DIR, filename)
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return audio_public_url(filename)
    with AUDIO_INFLIGHT_LOCK:
        if cache_key in AUDIO_INFLIGHT:
            return None
        AUDIO_INFLIGHT.add(cache_key)

    def _job():
        try:
            os.makedirs(AUDIO_DIR, exist_ok=True)
            _tts_generate_sync(text, path)
            log("signal audio ready: {0}".format(filename))
        except Exception as exc:
            log("signal audio failed {0}: {1}".format(filename, exc))
        finally:
            with AUDIO_INFLIGHT_LOCK:
                AUDIO_INFLIGHT.discard(cache_key)

    AUDIO_EXECUTOR.submit(_job)
    return None


def open_signal_text(zht, sym, side, price):
    coin = sym.replace("USDT", "")
    side_zh = "做多" if side == "LONG" else "做空"
    return "叮～策略【{0}】在 {1} 出現{2}訊號，參考價位 {3}，記得及時關注喔～".format(
        zht, coin, side_zh, fmt_px(price)
    )


def close_signal_text(zht, pnl_pct):
    return "哥哥～【{0}】已經獲利出場囉，本次為您鎖定獲利百分之{1:.1f}，超厲害的～".format(
        zht, pnl_pct
    )


def fetch_klines_light(sym):
    return fetch_binance_klines(sym, LIVE_FEED_TF, LIVE_FEED_KLINE_LIMIT)


def load_klines_light(sym):
    return fetch_klines_light(sym)


def refresh_live_feed_pool():
    """Fast, independent fetch: 20 symbols x 1h only, small limit, parallelized
    via a thread pool. Kept separate from refresh_pool()/KLINE_POOL so
    live_feed.json generation never waits on the heavier legacy TG pool."""
    pool = {}

    def fetch_one(sym):
        try:
            return sym, load_klines_light(sym), None
        except Exception as exc:
            return sym, None, exc

    with cf.ThreadPoolExecutor(max_workers=LIVE_FEED_WORKERS) as ex:
        for sym, data, exc in ex.map(fetch_one, SCAN_SYMBOLS):
            if data is not None:
                pool[sym] = data
            else:
                log("live_feed pool skip {0}: {1}".format(sym, exc))
    tally = {}
    for data in pool.values():
        v = (data or {}).get("venue") or (data or {}).get("src") or "?"
        tally[v] = tally.get(v, 0) + 1
    log("live_feed 1h ok={0}/{1} venues={2}".format(len(pool), len(SCAN_SYMBOLS), tally))
    return pool


def _position_key(sid, sym):
    return "{0}_{1}".format(sid, sym)


def _pnl_pct(side, entry_px, exit_px):
    if not entry_px:
        return 0.0
    if side == "LONG":
        return (exit_px - entry_px) / entry_px * 100.0
    return (entry_px - exit_px) / entry_px * 100.0


def _exec_event_key(ev):
    return "{0}|{1}|{2}|{3}|{4}".format(
        ev.get("strategy_id"),
        ev.get("symbol"),
        ev.get("event"),
        ev.get("logged_at") or ev.get("bar_ts"),
        ev.get("interval") or "",
    )


def scrub_legacy_aligned_tape(events):
    """Drop leftover rows stamped at candle-close clocks (:00/:15/:30/:45).

    New tape rows use wall-clock fired_at, which almost never equals bar_ts
    and is not forced onto a 15-minute grid.
    """
    out = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        logged = _ms_to_sec(ev.get("logged_at") or 0)
        bar = _ms_to_sec(ev.get("bar_ts") or 0)
        if not logged:
            continue
        if bar and logged == bar and logged % 900 == 0:
            continue
        out.append(ev)
    return out


def load_exec_log():
    try:
        with open(LIVE_EXEC_LOG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        rows = data if isinstance(data, list) else []
        return scrub_legacy_aligned_tape(rows)
    except Exception:
        return []


def save_exec_log(log):
    trimmed = log[:LIVE_EXEC_LOG_MAX]
    tmp = LIVE_EXEC_LOG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(trimmed, f, ensure_ascii=False, indent=2)
    os.replace(tmp, LIVE_EXEC_LOG_PATH)
    return trimmed


def merge_exec_log(existing, fresh_events):
    keys = {_exec_event_key(e) for e in existing}
    merged = list(existing)
    for ev in fresh_events:
        k = _exec_event_key(ev)
        if k in keys:
            continue
        merged.insert(0, ev)
        keys.add(k)
    return merged[:LIVE_EXEC_LOG_MAX]


def _priority_rank(sym):
    try:
        return PRIORITY_SYMBOLS.index(sym)
    except ValueError:
        return len(PRIORITY_SYMBOLS)


def cap_strategy_log_events(events, max_per_strategy=MAX_TAPE_EVENTS_PER_STRATEGY):
    """Limit burst tape rows per strategy; prefer BTC/ETH/SOL and real bar_ts."""
    by_sid = {}
    for ev in events:
        sid = ev.get("strategy_id") or "_"
        by_sid.setdefault(sid, []).append(ev)
    capped = []
    for evs in by_sid.values():
        evs.sort(key=lambda e: (_priority_rank(e.get("symbol")), -(e.get("bar_ts") or 0)))
        capped.extend(evs[:max_per_strategy])
    capped.sort(key=lambda e: e.get("logged_at") or e.get("bar_ts") or 0, reverse=True)
    return capped


def load_position_state():
    global LIVE_POSITION_STATE, _POSITION_STATE_HYDRATING
    try:
        with open(LIVE_POSITION_STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data:
            LIVE_POSITION_STATE = data
            _POSITION_STATE_HYDRATING = False
            return
    except Exception:
        pass
    LIVE_POSITION_STATE = {}
    _POSITION_STATE_HYDRATING = True


def ensure_position_state_loaded():
    global _POSITION_STATE_LOADED
    if _POSITION_STATE_LOADED:
        return
    load_position_state()
    _POSITION_STATE_LOADED = True


def save_position_state():
    global _POSITION_STATE_HYDRATING
    with LIVE_POSITION_LOCK:
        snap = dict(LIVE_POSITION_STATE)
    tmp = LIVE_POSITION_STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    os.replace(tmp, LIVE_POSITION_STATE_PATH)
    _POSITION_STATE_HYDRATING = False


def _tape_side_norm(side):
    s = str(side or "")
    if "SHORT" in s:
        return "SHORT"
    return "LONG"


def _price_bucket(ev):
    px = ev.get("exit_price") if ev.get("event") == "close" else ev.get("price")
    try:
        return "{0:.8g}".format(float(px))
    except (TypeError, ValueError):
        return "na"


def _ms_to_sec(ts):
    try:
        n = int(float(ts))
    except (TypeError, ValueError):
        return 0
    if n > 10_000_000_000:
        return int(n / 1000)
    return n


def events_to_tape_rows(events, now_sec):
    """Map TG scan_events() hits onto the live exec tape at wall-clock fire time."""
    rows = []
    fired = int(now_sec)
    for ev in events:
        bar_sec = _ms_to_sec(ev.get("close_ms") or ev.get("bar_ts") or 0)
        try:
            fired = int(float(ev.get("fired_at") or now_sec))
        except (TypeError, ValueError):
            fired = int(now_sec)
        prev_side = ev.get("prev_side")
        close_pnl = ev.get("close_pnl")
        if prev_side and prev_side != ev.get("side"):
            rows.append(
                {
                    "strategy_id": ev.get("strat_id"),
                    "name_zh": ev.get("strat_name"),
                    "name_en": ev.get("strat_name"),
                    "symbol": ev.get("sym"),
                    "interval": ev.get("tf") or "1h",
                    "event": "close",
                    "side": prev_side,
                    "prev_side": prev_side,
                    "price": round(float(ev.get("px") or 0), 8),
                    "pnl_pct": close_pnl,
                    "bar_ts": bar_sec,
                    "logged_at": fired,
                }
            )
        rows.append(
            {
                "strategy_id": ev.get("strat_id"),
                "name_zh": ev.get("strat_name"),
                "name_en": ev.get("strat_name"),
                "symbol": ev.get("sym"),
                "interval": ev.get("tf") or "1h",
                "event": "open",
                "side": ev.get("side"),
                "prev_side": prev_side,
                "price": round(float(ev.get("px") or 0), 8),
                "sl_pct": ev.get("sl_pct"),
                "tp_pct": ev.get("tp_pct"),
                "bar_ts": bar_sec,
                "logged_at": fired,
            }
        )
    return smooth_tape_storm(rows, int(now_sec))


def smooth_tape_storm(rows, base_sec=None):
    """Buffer before signals.json: dedupe, resonance merge, and jitter identical stamps.

    Hour boundaries fire 15m+1h(+5m heartbeat) together; without this step every
    row shares the same logged_at and the frontend sees a signal storm.
    """
    if not rows:
        return []
    base = int(base_sec or time.time())
    seen = set()
    uniq = []
    for ev in rows:
        k = _exec_event_key(ev)
        if not k or k in seen:
            continue
        seen.add(k)
        uniq.append(dict(ev))

    # Prefer majors when one strategy fans out across many coins
    uniq = cap_strategy_log_events(uniq, max_per_strategy=MAX_TAPE_EVENTS_PER_STRATEGY)

    # Same-second same-direction opens -> multi-strategy resonance batches
    resonance = {}
    kept = []
    storm = len(uniq) >= 8
    for ev in uniq:
        side = _tape_side_norm(ev.get("side"))
        kind = ev.get("event") or "open"
        try:
            bucket = int(ev.get("logged_at") or base) // 5
        except (TypeError, ValueError):
            bucket = base // 5
        if kind != "open":
            kept.append(ev)
            continue
        key = (bucket, side, "open")
        resonance.setdefault(key, []).append(ev)

    for key, group in resonance.items():
        strats = {
            (g.get("name_zh") or g.get("strategy_id") or "")
            for g in group
            if (g.get("name_zh") or g.get("strategy_id"))
        }
        if len(group) >= 4 and len(strats) >= 2:
            # Collapse into one resonance tape row (batch-ready)
            syms = []
            seen_sym = set()
            for g in sorted(group, key=lambda e: _priority_rank(e.get("symbol"))):
                sym = g.get("symbol")
                if not sym or sym in seen_sym:
                    continue
                seen_sym.add(sym)
                syms.append(g)
                if len(syms) >= 5:
                    break
            head = syms[0]
            kept.append(
                {
                    "strategy_id": "resonance_" + str(key[0]),
                    "name_zh": "多策略共振",
                    "name_en": "Multi-strategy confluence",
                    "symbol": head.get("symbol"),
                    "interval": head.get("interval") or "1h",
                    "event": "open",
                    "side": key[1],
                    "price": head.get("price"),
                    "bar_ts": head.get("bar_ts") or 0,
                    "logged_at": int(head.get("logged_at") or base),
                    "storm": True,
                    "resonance": True,
                    "resonance_n": len(group),
                    "resonance_symbols": [s.get("symbol") for s in syms],
                }
            )
            # Keep a few individual rows for panel detail (jittered below)
            for g in syms[1:3]:
                g = dict(g)
                g["storm"] = True
                kept.append(g)
        else:
            for g in group:
                if storm:
                    g["storm"] = True
                kept.append(g)

    # Inject 1–2s (and light stagger) so timestamps are never identical
    kept.sort(
        key=lambda e: (
            -(1 if e.get("resonance") else 0),
            _priority_rank(e.get("symbol")),
            -(e.get("bar_ts") or 0),
        )
    )
    out = []
    for i, ev in enumerate(kept):
        row = dict(ev)
        # 0,1,2,1,2,3... capped so a storm spreads over a few seconds of wall clock
        jitter = (i % 3) + (i // 3)
        row["logged_at"] = int(base) + min(int(jitter), 6)
        if len(kept) >= 8:
            row["storm"] = True
        out.append(row)
    return out


def collapse_exec_log_batches(events, limit=24):
    """Same grouping as TG: (strategy, side, timeframe, bar)."""
    if not events:
        return []
    if events and events[0].get("kind") == "batch":
        return events[:limit]
    px_by_sym = {}
    for ev in events:
        if ev.get("kind") == "batch":
            continue
        raw = ev.get("exit_price") if ev.get("event") == "close" else ev.get("price")
        if raw in (None, "", 0, 0.0):
            raw = ev.get("price") or ev.get("px") or ev.get("exit_price")
        try:
            pxn = float(raw)
        except (TypeError, ValueError):
            continue
        if ev.get("symbol") and pxn > 0:
            px_by_sym[ev.get("symbol")] = pxn
    buckets = {}
    order = []
    for ev in events:
        if ev.get("kind") == "batch":
            key = (
                ev.get("name_zh"),
                ev.get("side"),
                ev.get("interval"),
                int(ev.get("bar_ts") or 0),
            )
            if key not in buckets:
                buckets[key] = ev
                order.append(key)
            continue
        name = ev.get("name_zh") or ev.get("name_en") or ev.get("strategy_id") or "量化策略"
        side = _tape_side_norm(ev.get("side"))
        tf = str(ev.get("interval") or "1h")
        bar = int(ev.get("bar_ts") or 0)
        evkind = ev.get("event") or "open"
        key = (name, side, tf, bar, evkind)
        if key not in buckets:
            buckets[key] = {
                "kind": "batch",
                "name_zh": name,
                "interval": tf,
                "side": side,
                "action": action_label(side, ev.get("prev_side")),
                "logged_at": int(ev.get("logged_at") or 0),
                "bar_ts": bar,
                "event": ev.get("event") or "open",
                "strategy_id": ev.get("strategy_id"),
                "symbols": [],
            }
            order.append(key)
        g = buckets[key]
        if ev.get("strategy_id") and not g.get("strategy_id"):
            g["strategy_id"] = ev.get("strategy_id")
        px = ev.get("exit_price") if ev.get("event") == "close" else ev.get("price")
        if px in (None, "", 0, 0.0):
            px = ev.get("price") or ev.get("px") or ev.get("exit_price")
        try:
            pxn = float(px)
            px = pxn if pxn > 0 else None
        except (TypeError, ValueError):
            px = None
        g["symbols"].append(
            {
                "symbol": ev.get("symbol"),
                "price": px,
                "sl_pct": ev.get("sl_pct"),
                "tp_pct": ev.get("tp_pct"),
                "event": ev.get("event") or "open",
                "pnl_pct": ev.get("pnl_pct"),
            }
        )
        try:
            logged = int(ev.get("logged_at") or 0)
            if logged and logged > int(g.get("logged_at") or 0):
                g["logged_at"] = logged
        except (TypeError, ValueError):
            pass
        if ev.get("prev_side") and ev.get("prev_side") != side:
            g["action"] = action_label(side, ev.get("prev_side"))
        # Expand resonance helper symbols into the batch card
        for extra in ev.get("resonance_symbols") or []:
            if not extra or extra == ev.get("symbol"):
                continue
            g["symbols"].append(
                {
                    "symbol": extra,
                    "price": px_by_sym.get(extra),
                    "sl_pct": None,
                    "tp_pct": None,
                    "event": "open",
                    "pnl_pct": None,
                }
            )
    out = []
    for key in order:
        g = buckets[key]
        if g.get("kind") == "batch" and not g.get("symbols") and g.get("strategy_count"):
            out.append(g)
            continue
        seen = set()
        uniq = []
        for s in g.get("symbols") or []:
            k = "{0}|{1}".format(s.get("symbol"), s.get("event") or "open")
            if not s.get("symbol") or k in seen:
                continue
            seen.add(k)
            uniq.append(s)
        g["symbols"] = uniq
        g["strategy_count"] = len(uniq)
        if uniq:
            out.append(g)
        if len(out) >= limit:
            break
    return out


def collapse_exec_log_display(events, limit=24):
    return collapse_exec_log_batches(events, limit=limit)


def attach_exec_tape(feed):
    """Stamp the TG event tape onto a live_feed payload (never dump hourly holds)."""
    if feed is None:
        feed = {}
    raw = load_exec_log()
    feed["exec_log"] = collapse_exec_log_batches(raw)
    feed["exec_log_raw_count"] = len(raw)
    feed["exec_mode"] = "event-driven"
    feed["scan_tf"] = "15m+1h"
    return feed


def append_tape_from_events(events):
    now_sec = int(time.time())
    fresh = events_to_tape_rows(events, now_sec)
    return save_exec_log(merge_exec_log(load_exec_log(), fresh))


def _signal_cache_key(sid, sym, side, bar_ts_i):
    return hashlib.md5(
        "{0}|{1}|{2}|{3}".format(sid, sym, side, bar_ts_i).encode("utf-8")
    ).hexdigest()[:20]


def _cached_signal_audio(sid, sym, side, bar_ts_i):
    cache_key = _signal_cache_key(sid, sym, side, bar_ts_i)
    path = os.path.join(AUDIO_DIR, "sig_{0}.mp3".format(cache_key))
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return audio_public_url("sig_{0}.mp3".format(cache_key))
    return None


def _open_row(sid, zht, en, sym, side, price, bar_ts_i, audio_url):
    return {
        "strategy_id": sid,
        "name_zh": zht,
        "name_en": en,
        "symbol": sym,
        "interval": LIVE_FEED_TF,
        "event": "open",
        "side": side,
        "price": round(price, 8),
        "bar_ts": bar_ts_i,
        "audio_url": audio_url,
    }


def _close_row(sid, zht, en, sym, prev, exit_px, bar_ts_i, audio_url):
    pnl_pct = _pnl_pct(prev["side"], prev["price"], exit_px)
    return {
        "strategy_id": sid,
        "name_zh": zht,
        "name_en": en,
        "symbol": sym,
        "interval": LIVE_FEED_TF,
        "event": "close",
        "side": "CLOSE_" + prev["side"],
        "entry_price": round(prev["price"], 8),
        "exit_price": round(exit_px, 8),
        "pnl_pct": round(pnl_pct, 2),
        "bar_ts": bar_ts_i,
        "audio_url": audio_url if pnl_pct > 0 else None,
    }


def scan_one(spec, pool, now_sec):
    """20-symbol scan for one strategy. LIVE_POSITION_STATE is the fill book:
    tape rows are written only on a real open / close / flip. Same-side holds
    stay on the active-signal board but are not execution events."""
    sid, zht, en, fn = spec
    hits = []
    closes = []
    log_events = []
    hydrating = _POSITION_STATE_HYDRATING
    for sym in SCAN_SYMBOLS:
        data = pool.get(sym)
        if not data or len(data["c"]) < 30:
            continue
        key = _position_key(sid, sym)
        hit = _scan_recent_signal(fn, data, now_sec, LIVE_FEED_TF)
        if not hit:
            if hydrating:
                continue
            with LIVE_POSITION_LOCK:
                prev = LIVE_POSITION_STATE.pop(key, None)
            if not prev:
                continue
            exit_px = data["c"][-1]
            # Prefer last closed bar close-time
            open_i = -2 if len(data.get("t") or []) >= 2 else -1
            bar_ts_i = bar_close_ts(data["t"][open_i], LIVE_FEED_TF)
            close_audio_url = None
            pnl_pct = _pnl_pct(prev["side"], prev["price"], exit_px)
            if pnl_pct > 0:
                close_cache_key = hashlib.md5(
                    "close|{0}|{1}|{2}".format(sid, sym, bar_ts_i).encode("utf-8")
                ).hexdigest()[:20]
                close_audio_url = request_signal_audio(
                    close_cache_key, close_signal_text(zht, pnl_pct)
                )
            close_row = _close_row(
                sid, zht, en, sym, prev, exit_px, bar_ts_i, close_audio_url
            )
            closes.append(close_row)
            log_events.append(dict(close_row, logged_at=int(now_sec)))
            continue

        bar_ts_i = int(hit["bar_ts"])
        price = hit["price"]
        side = hit["side"]

        with LIVE_POSITION_LOCK:
            prev = LIVE_POSITION_STATE.get(key)
            if prev and prev.get("side") == side:
                LIVE_POSITION_STATE[key] = {
                    "side": side,
                    "price": prev.get("price") or price,
                    "bar_ts": bar_ts_i,
                }
                action = "hold"
                flipped_from = None
            elif hydrating and not prev:
                LIVE_POSITION_STATE[key] = {
                    "side": side,
                    "price": price,
                    "bar_ts": bar_ts_i,
                }
                action = "hold"
                flipped_from = None
            else:
                flipped_from = dict(prev) if prev else None
                LIVE_POSITION_STATE[key] = {
                    "side": side,
                    "price": price,
                    "bar_ts": bar_ts_i,
                }
                action = "open"

        if action == "hold":
            hits.append(
                _open_row(
                    sid,
                    zht,
                    en,
                    sym,
                    side,
                    price,
                    bar_ts_i,
                    _cached_signal_audio(sid, sym, side, bar_ts_i),
                )
            )
            continue

        audio_url = request_signal_audio(
            _signal_cache_key(sid, sym, side, bar_ts_i),
            open_signal_text(zht, sym, side, price),
        )
        open_row = _open_row(sid, zht, en, sym, side, price, bar_ts_i, audio_url)
        hits.append(open_row)
        log_events.append(dict(open_row, logged_at=int(now_sec)))

        if flipped_from is not None:
            pnl_pct = _pnl_pct(flipped_from["side"], flipped_from["price"], price)
            close_audio_url = None
            if pnl_pct > 0:
                close_cache_key = hashlib.md5(
                    "close|{0}|{1}|{2}".format(sid, sym, bar_ts_i).encode("utf-8")
                ).hexdigest()[:20]
                close_audio_url = request_signal_audio(
                    close_cache_key, close_signal_text(zht, pnl_pct)
                )
            close_row = _close_row(
                sid, zht, en, sym, flipped_from, price, bar_ts_i, close_audio_url
            )
            closes.append(close_row)
            log_events.append(dict(close_row, logged_at=int(now_sec)))
    return hits, closes, log_events


def build_live_feed_matrix():
    """20 symbols x 45 canonical strategies, multi-threaded. Uses its own
    lightweight kline fetch (see refresh_live_feed_pool) — no dependency on
    the heavier full pool refresh, so this step alone stays fast (a few
    seconds) regardless of what else is happening in the poll cycle."""
    now_sec = time.time()
    ensure_position_state_loaded()
    specs = frontend_strategy_specs()
    pool = refresh_live_feed_pool()

    signals = []
    closed = []
    log_tape = []
    with cf.ThreadPoolExecutor(max_workers=LIVE_FEED_WORKERS) as ex:
        futs = [ex.submit(scan_one, spec, pool, now_sec) for spec in specs]
        for fut in futs:
            hits, closes, log_events = fut.result()
            signals.extend(hits)
            closed.extend(closes)
            log_tape.extend(log_events)
    signals.sort(key=lambda x: x["bar_ts"], reverse=True)
    closed.sort(key=lambda x: x["bar_ts"], reverse=True)
    if log_tape:
        save_exec_log(merge_exec_log(load_exec_log(), log_tape))
    save_position_state()

    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period_hours": 3,
        "poll_sec": FEED_PUBLISH_SEC,
        "scan_tf": "15m+1h",
        "exec_mode": "event-driven",
        "symbols": SYMBOLS,
        "strategy_count": len(specs),
        "signal_count": len(signals),
        "active_signals_3h": signals,
        "closed_signals_3h": closed[:60],
        "exec_log": [],
    }
    return attach_exec_tape(payload)


def atomic_write_json(path, raw):
    directory = os.path.dirname(path) or "."
    if directory and not os.path.isdir(directory):
        os.makedirs(directory, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(raw)
    os.replace(tmp, path)


def publish_live_feed_to_webroot():
    """Copy engine feed into the HTTPS static root (same-origin for the site)."""
    if not WEB_FEED_PATH or WEB_FEED_PATH == LIVE_FEED_PATH:
        return
    if not os.path.isfile(LIVE_FEED_PATH):
        return
    directory = os.path.dirname(WEB_FEED_PATH) or "."
    if directory and not os.path.isdir(directory):
        os.makedirs(directory, exist_ok=True)
    tmp = WEB_FEED_PATH + ".tmp"
    with open(LIVE_FEED_PATH, "rb") as src, open(tmp, "wb") as dst:
        dst.write(src.read())
    os.replace(tmp, WEB_FEED_PATH)


def write_signals_json(payload):
    """Persist the war-room tape for /data/signals.json (CORS static)."""
    body = {
        "updated_at": payload.get("updated_at"),
        "venue": (rails_last_meta() or {}).get("venue"),
        "poll_sec": payload.get("poll_sec") or FEED_PUBLISH_SEC,
        "exec_log": payload.get("exec_log") or [],
        "exec_log_raw_count": payload.get("exec_log_raw_count"),
        "signal_count": payload.get("signal_count"),
        "symbols": payload.get("symbols") or LIVE_ROOM_SYMBOLS,
    }
    raw = json.dumps(body, ensure_ascii=False, indent=2)
    atomic_write_json(WEB_SIGNALS_PATH, raw)
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "signals.json")
    if os.path.abspath(local) != os.path.abspath(WEB_SIGNALS_PATH):
        atomic_write_json(local, raw)


_LAST_PAGES_PUSH = 0.0
_LAST_TAPE_HASH = ""


def maybe_sync_pages(payload):
    """Throttle GitHub Pages tape sync so the 60s cycle never blocks on git."""
    global _LAST_PAGES_PUSH, _LAST_TAPE_HASH
    blob = json.dumps(payload.get("exec_log") or [], ensure_ascii=False, sort_keys=True)
    digest = hashlib.md5(blob.encode("utf-8")).hexdigest()
    now = time.time()
    if digest == _LAST_TAPE_HASH and now - _LAST_PAGES_PUSH < 180:
        return
    if now - _LAST_PAGES_PUSH < 90:
        return
    _LAST_TAPE_HASH = digest
    _LAST_PAGES_PUSH = now

    def _job():
        try:
            from utils.git_sync import sync_to_github

            stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            # Tape first — never let optional registry kill Pages freshness.
            status = sync_to_github(
                ["live_feed.json", "data/signals.json"],
                commit_msg="Auto: live tape [{0}]".format(stamp),
            )
            log("pages sync {0}".format(status))
            try:
                sync_to_github(
                    ["plaza_live_registry.json"],
                    commit_msg="Auto: plaza live registry [{0}]".format(stamp),
                )
            except Exception as reg_exc:
                log("plaza registry pages sync skip: {0}".format(reg_exc))
        except Exception as exc:
            log("pages sync skip: {0}".format(exc))

    threading.Thread(target=_job, name="pages-sync", daemon=True).start()


def write_live_feed(payload):
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    atomic_write_json(LIVE_FEED_PATH, raw)
    try:
        publish_live_feed_to_webroot()
    except Exception as exc:
        log("webroot live_feed publish error: {0}".format(exc))
    try:
        write_signals_json(payload)
    except Exception as exc:
        log("signals.json write error: {0}".format(exc))
    try:
        maybe_sync_pages(payload)
    except Exception as exc:
        log("pages sync error: {0}".format(exc))


def feed_publish_loop():
    """Overwrite /var/www/html/live_feed.json every FEED_PUBLISH_SEC seconds."""
    while True:
        try:
            publish_live_feed_to_webroot()
        except Exception as exc:
            log("feed publish loop error: {0}".format(exc))
        time.sleep(FEED_PUBLISH_SEC)


def fmt_px(px):
    if px >= 1000:
        return "{0:.2f}".format(px)
    if px >= 1:
        return "{0:.4f}".format(px)
    return "{0:.6f}".format(px)


def state_key(sid, sym, tf):
    return "{0}_{1}_{2}".format(sid, sym, tf)


def tg_send(text, parse_mode="HTML"):
    if not BOT_TOKEN:
        raise RuntimeError("TG_BOT_TOKEN missing")
    if not text or not str(text).strip():
        return None
    url = "https://api.telegram.org/bot{0}/sendMessage".format(BOT_TOKEN)
    payload = {
        "chat_id": CHANNEL,
        "text": text,
        "disable_web_page_preview": "true",
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    body = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as resp:
        out = json.loads(resp.read().decode("utf-8", "replace"))
    if not out.get("ok"):
        raise RuntimeError(out)
    return out


def fmt_tw_time_ms(ms):
    """Exact wall clock in UTC+8, including seconds — never hour/quarter rounding."""
    if not ms:
        tw = datetime.now(timezone(timedelta(hours=8)))
    else:
        tw = datetime.fromtimestamp(ms / 1000.0, tz=timezone(timedelta(hours=8)))
    return tw.strftime("%Y-%m-%d %H:%M:%S")


def sl_tp_display_pcts(side, px, sl, tp):
    if px <= 0:
        return 0.0, 0.0
    if side == "LONG":
        sl_pct = -abs((px - sl) / px * 100.0)
        tp_pct = abs((tp - px) / px * 100.0)
    else:
        sl_pct = -abs((sl - px) / px * 100.0)
        tp_pct = abs((px - tp) / px * 100.0)
    return sl_pct, tp_pct


def side_banner(side):
    if side == "LONG":
        return "🟢 【看多 · 做多 LONG】"
    return "🔴 【看空 · 做空 SHORT】"


def action_label(side, prev_side=None):
    if prev_side and prev_side != side:
        return "空頭平倉翻多 (BUY)" if side == "LONG" else "多頭平倉翻空 (SELL)"
    if side == "LONG":
        return "多頭開倉 (BUY)"
    return "空頭開倉 (SELL)"


def action_emoji(side):
    return "🟢" if side == "LONG" else "🔴"


def _esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def format_symbol_row(ev):
    coin = ev["sym"].replace("USDT", "")
    return "• {0} <code>{1}</code>  SL {2:.1f}%  TP {3:+.1f}%".format(
        _esc(coin), _esc(fmt_px(ev["px"])), ev["sl_pct"], ev["tp_pct"]
    )


def format_batch_message(group_events):
    """Compact card: one (timeframe, side) batch, several coins, few strategy names."""
    if not group_events:
        return ""
    head = group_events[0]
    names = []
    seen = set()
    for e in group_events:
        n = e.get("strat_name") or "策略"
        if n in seen:
            continue
        seen.add(n)
        names.append(n)
    shown = names[:3]
    extra = len(names) - len(shown)
    name_bit = " / ".join(_esc(n) for n in shown)
    if extra:
        name_bit += " +{0}".format(extra)
    tf_label = str(head.get("tf") or "1h").upper()
    side = head["side"]
    flips = [e for e in group_events if e.get("prev_side") and e.get("prev_side") != e["side"]]
    act = action_label(side, flips[0].get("prev_side") if len(flips) == len(group_events) and flips else None)
    tw = fmt_tw_time_ms(int(time.time() * 1000))
    rows = "\n".join(format_symbol_row(e) for e in group_events[:8])
    return (
        "{0} <b>{1} · {2}</b>\n"
        "{3}\n"
        "<code>{4}</code>\n"
        "{5}\n"
        "<i>研究信號，非投資建議</i>"
    ).format(action_emoji(side), _esc(tf_label), _esc(act), name_bit, _esc(tw), rows)


def send_tg_signal(strat, sym, side, px, sl, tp, bar_ts, src, prev_side=None):
    """Legacy single-card builder kept for callers; prefer format_batch_message."""
    sl_pct, tp_pct = sl_tp_display_pcts(side, px, sl, tp)
    ev = {
        "strat_name": strat.get("zht") or strat.get("en") or strat.get("id") or "量化策略",
        "tf": strat.get("tf") or "1h",
        "side": side,
        "sym": sym,
        "px": px,
        "sl_pct": sl_pct,
        "tp_pct": tp_pct,
        "prev_side": prev_side,
        "close_ms": bar_ts,
    }
    return format_batch_message([ev])


def format_alert(strat, sym, side, px, sl, tp, bar_ts, src, prev_side=None):
    return send_tg_signal(strat, sym, side, px, sl, tp, bar_ts, src, prev_side=prev_side)


def format_hour_brief(events, hour_label):
    """One institutional 1h note for BTC/ETH/SOL. Live-room tape stays dense elsewhere."""
    book = {}
    names_by_sym = {}
    for ev in events:
        sym = ev.get("sym")
        if sym not in TG_BRIEF_SYMBOLS:
            continue
        book[sym] = ev
        names_by_sym.setdefault(sym, [])
        n = ev.get("strat_name") or ""
        if n and n not in names_by_sym[sym]:
            names_by_sym[sym].append(n)
    lines = [
        "<b>QUANT.ALPHA · 1H 機構簡報</b>",
        "<code>{0}</code>".format(_esc(hour_label)),
    ]
    for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT"):
        coin = sym.replace("USDT", "")
        ev = book.get(sym)
        if not ev:
            lines.append("· <b>{0}</b> 本小時無 1H 開倉".format(coin))
            continue
        models = names_by_sym.get(sym) or []
        shown = " / ".join(_esc(x) for x in models[:2])
        extra = len(models) - min(2, len(models))
        if extra > 0:
            shown += " +{0}".format(extra)
        side = ev.get("side") or ""
        act = action_label(side, ev.get("prev_side"))
        lines.append(
            "· {0} <b>{1}</b> {2}  <code>{3}</code>  SL {4:.1f}%  TP {5:+.1f}%".format(
                action_emoji(side),
                coin,
                _esc(act),
                _esc(fmt_px(ev.get("px") or 0)),
                float(ev.get("sl_pct") or 0),
                float(ev.get("tp_pct") or 0),
            )
        )
        if shown:
            lines.append("  {0}".format(shown))
    lines.append("<i>頻道僅 BTC/ETH/SOL 整點摘要。全市場明細見直播作戰室。研究樣本，非投資建議。</i>")
    return "\n".join(lines)


def buffer_channel_events(events):
    for ev in events or []:
        if str(ev.get("tf") or "") != TG_CHANNEL_TF:
            continue
        if ev.get("heartbeat"):
            continue
        if ev.get("sym") not in TG_BRIEF_SYMBOLS:
            continue
        TG_DIGEST_BUF.append(ev)


def maybe_flush_hour_brief():
    """Fire once when UTC+8 hour rolls. First hour after process start is silent."""
    global TG_DIGEST_HOUR
    tw = datetime.now(timezone(timedelta(hours=8)))
    key = (tw.strftime("%Y-%m-%d"), tw.hour)
    if TG_DIGEST_HOUR is None:
        TG_DIGEST_HOUR = key
        TG_DIGEST_BUF[:] = []
        return 0
    if key == TG_DIGEST_HOUR:
        return 0
    prev_day, prev_hour = TG_DIGEST_HOUR
    label = "{0} {1:02d}:00–{2:02d}:00 UTC+8".format(prev_day, prev_hour, (prev_hour + 1) % 24)
    buf = list(TG_DIGEST_BUF)
    TG_DIGEST_BUF[:] = []
    TG_DIGEST_HOUR = key
    if not buf:
        log("hour brief empty {0}".format(label))
        return 0
    msg = format_hour_brief(buf, label)
    if not msg.strip():
        return 0
    tg_send(msg)
    log("hour brief pushed {0} events={1}".format(label, len(buf)))
    return 1


def events_for_telegram(events):
    """Channel queue: 1h BTC/ETH/SOL only. 15m and alts stay on the live tape."""
    out = []
    for ev in events or []:
        if str(ev.get("tf") or "") != TG_CHANNEL_TF:
            continue
        if ev.get("heartbeat"):
            continue
        if ev.get("sym") not in TG_BRIEF_SYMBOLS:
            continue
        out.append(ev)
    return out


def aggregate_events(events):
    """Group by (side, timeframe); one card per direction."""
    buckets = {}
    order = []
    for ev in events:
        key = (ev["side"], ev["tf"])
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(ev)
    messages = []
    for key in order:
        group = buckets[key]
        best = {}
        for ev in group:
            sym = ev.get("sym")
            if sym not in best:
                best[sym] = ev
        collapsed = list(best.values())
        msg = format_batch_message(collapsed)
        if msg:
            messages.append(msg)
        if len(messages) >= TG_MAX_MESSAGES:
            break
    return messages


ENGINE_WARM = False


def refresh_heartbeat_pool():
    """8 live-room symbols x 5m via Coinbase -> Binance.US -> Kraken."""
    global HEARTBEAT_POOL
    pool = {}

    def fetch_one(sym):
        try:
            return sym, fetch_binance_klines(sym, "5m", 80), None
        except Exception as exc:
            return sym, None, exc

    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for sym, data, exc in ex.map(fetch_one, LIVE_ROOM_SYMBOLS):
            if data is not None:
                pool[sym] = data
            else:
                log("heartbeat pool skip {0}: {1}".format(sym, exc))
    HEARTBEAT_POOL = pool
    tally = {}
    for data in pool.values():
        v = (data or {}).get("venue") or (data or {}).get("src") or "?"
        tally[v] = tally.get(v, 0) + 1
    log("heartbeat 5m ok={0}/{1} venues={2}".format(len(pool), len(LIVE_ROOM_SYMBOLS), tally))
    return pool


def _micro_event(sid, name, tf, side, sym, px, bar_ts, prev_side, now_sec):
    h = l = c = None
    data = HEARTBEAT_POOL.get(sym) or KLINE_POOL.get((sym, "1h"))
    sl_pct, tp_pct = -0.4, 0.8
    if data:
        h, l, c = data["h"], data["l"], data["c"]
        try:
            risk = atr(h, l, c, 14)[-1]
            if risk <= 0:
                risk = px * 0.003
            sl, tp = levels(px, side, risk)
            sl_pct, tp_pct = sl_tp_display_pcts(side, px, sl, tp)
        except Exception:
            pass
    return {
        "strat_id": sid,
        "strat_name": name,
        "tf": tf,
        "side": side,
        "sym": sym,
        "px": px,
        "sl_pct": sl_pct,
        "tp_pct": tp_pct,
        "bar_ts": bar_ts,
        "close_ms": bar_ts,
        "src": "heartbeat",
        "prev_side": prev_side,
        "close_pnl": None,
        "fired_at": now_sec,
        "heartbeat": True,
    }


def scan_micro_events():
    """5m ROC / bollinger micro-breaks for the 8 war-room coins."""
    events = []
    pool = refresh_heartbeat_pool()
    now_sec = time.time()
    specs = (
        ("hb-roc5", "5m動能微破", lambda d: eval_roc(d, 5, 0.045)),
        ("hb-bb5", "布林微破", eval_bb_micro),
    )
    for sid, name, fn in specs:
        for sym in LIVE_ROOM_SYMBOLS:
            data = pool.get(sym)
            if not data or len(data["c"]) < 30:
                continue
            try:
                side = fn(data)
            except Exception:
                continue
            if side not in ("LONG", "SHORT"):
                continue
            key = "hb_{0}_{1}".format(sid, sym)
            prev = HEARTBEAT_STATE.get(key)
            px = float(data["c"][-1])
            # data_provider._clean() already drops unclosed bars;
            # [-1] is the last CLOSED 5m candle.
            bar_ts = bar_close_ts(data["t"][-1], "5m")
            if prev and prev.get("side") == side:
                continue
            prev_side = prev.get("side") if prev else None
            HEARTBEAT_STATE[key] = {"side": side, "bar_ts": bar_ts, "px": px}
            events.append(
                _micro_event(sid, name, "5m", side, sym, px, bar_ts, prev_side, now_sec)
            )
    return events


def last_tape_age_sec():
    last = 0
    for ev in load_exec_log():
        ts = _ms_to_sec(ev.get("logged_at") or 0)
        if ts > last:
            last = ts
    if not last:
        return 10**9
    return time.time() - last


def stale_pulse_events():
    """Guarantee at least one tape row every HEARTBEAT_SEC using live 5m direction."""
    if last_tape_age_sec() < HEARTBEAT_SEC:
        return []
    now = int(time.time())
    idx = (now // HEARTBEAT_SEC) % max(len(LIVE_ROOM_SYMBOLS), 1)
    out = []
    names = ("5m動能微破", "布林微破")
    sids = ("hb-roc5", "hb-bb5")
    for offset in (0, 1):
        sym = LIVE_ROOM_SYMBOLS[(idx + offset) % len(LIVE_ROOM_SYMBOLS)]
        data = HEARTBEAT_POOL.get(sym) or KLINE_POOL.get((sym, "1h"))
        if not data or not data.get("c"):
            continue
        px = float(data["c"][-1])
        if px <= 0:
            continue
        roc = 0.0
        if len(data["c"]) > 2 and data["c"][-2]:
            roc = (data["c"][-1] / data["c"][-2] - 1.0) * 100.0
        side = "LONG" if roc >= 0 else "SHORT"
        # data_provider._clean() already drops unclosed bars;
        # [-1] is the last CLOSED candle.
        raw_t = data["t"][-1] if data.get("t") else now * 1000
        bar_ts = bar_close_ts(raw_t, "5m")
        out.append(
            _micro_event(sids[offset], names[offset], "5m", side, sym, px, bar_ts, None, now)
        )
    return out


def scan_events():
    """Collect genuine side-change events this tick (no Telegram send yet)."""
    global ENGINE_WARM
    events = []
    for strat in STRATEGY_MATRIX:
        tf = strat["tf"]
        for sym in SYMBOLS:
            data = KLINE_POOL.get((sym, tf))
            if not data or len(data["c"]) < 30:
                continue
            try:
                side = strat["eval"](data)
            except Exception as exc:
                log("eval {0} {1} {2}: {3}".format(strat["id"], sym, tf, exc))
                continue
            if side not in ("LONG", "SHORT"):
                continue
            # data_provider._clean() already drops unclosed bars;
            # [-1] is the last CLOSED candle — stamp at its close time.
            raw_t = data["t"][-1]
            bar_ts = bar_close_ts(raw_t, tf)
            key = state_key(strat["id"], sym, tf)
            prev = SIGNAL_STATE.get(key)
            c = data["c"]
            px = c[-1]
            if not ENGINE_WARM:
                SIGNAL_STATE[key] = {"side": side, "bar_ts": bar_ts, "px": px}
                continue
            if prev and prev.get("side") == side:
                continue
            prev_side = prev.get("side") if prev else None
            prev_px = float(prev.get("px") or 0) if prev else 0.0
            close_pnl = None
            if prev_side and prev_px > 0:
                if prev_side == "LONG":
                    close_pnl = (px - prev_px) / prev_px * 100.0
                else:
                    close_pnl = (prev_px - px) / prev_px * 100.0
            SIGNAL_STATE[key] = {"side": side, "bar_ts": bar_ts, "px": px}
            h, l = data["h"], data["l"]
            risk = atr(h, l, c, 14)[-1]
            if risk <= 0:
                risk = px * 0.004
            sl, tp = levels(px, side, risk)
            sl_pct, tp_pct = sl_tp_display_pcts(side, px, sl, tp)
            events.append(
                {
                    "strat_id": strat["id"],
                    "strat_name": strat.get("zht") or strat.get("en") or strat["id"],
                    "tf": tf,
                    "side": side,
                    "sym": sym,
                    "px": px,
                    "sl": sl,
                    "tp": tp,
                    "sl_pct": sl_pct,
                    "tp_pct": tp_pct,
                    "bar_ts": bar_ts,
                    "close_ms": bar_ts,
                    "src": data.get("src"),
                    "prev_side": prev_side,
                    "close_pnl": close_pnl,
                    "fired_at": time.time(),
                }
            )
            log("signal {0} {1} {2} {3} bar={4}".format(strat["id"], sym, tf, side, bar_ts))
    return events


def cycle():
    # Plaza 3h book first (fast dedicated 1h fetch). Exec tape is NOT this
    # hourly dump — it is written later from the same scan_events() as TG.
    # Refresh matrix each tick so a newly appended plaza strategy enters live.
    refresh_strategy_matrix()
    try:
        write_plaza_live_registry()
    except Exception as exc:
        log("plaza_live_registry error: {0}".format(exc))
    t0 = time.time()
    feed = None
    try:
        feed = build_live_feed_matrix()
        write_live_feed(feed)
        log(
            "live_feed.json written signals={0} symbols={1} strategies={2} tape={3} took={4:.1f}s".format(
                feed["signal_count"],
                len(SYMBOLS),
                feed["strategy_count"],
                len(feed.get("exec_log") or []),
                time.time() - t0,
            )
        )
    except Exception as exc:
        log("live_feed build/write error: {0}".format(exc))
        traceback.print_exc()

    refresh_pool()
    ok = sum(1 for s in SYMBOLS for t in TIMEFRAMES if (s, t) in KLINE_POOL)
    tally = {}
    for data in KLINE_POOL.values():
        v = (data or {}).get("venue") or (data or {}).get("src") or "?"
        tally[v] = tally.get(v, 0) + 1
    log("pool refreshed {0}/{1} series venues={2}".format(ok, len(SYMBOLS) * len(TIMEFRAMES), tally))

    global ENGINE_WARM
    events = scan_events()
    if not ENGINE_WARM:
        ENGINE_WARM = True
        log("warmup complete — silent TG until a real open/close; tape heartbeat armed")
        events = []

    micro = []
    pulse = []
    try:
        micro = scan_micro_events()
    except Exception as exc:
        log("micro scan error: {0}".format(exc))
        traceback.print_exc()
    try:
        pulse = stale_pulse_events()
    except Exception as exc:
        log("heartbeat pulse error: {0}".format(exc))
        traceback.print_exc()

    # Hour-boundary storm breaker: when 15m+1h already flooded the tape,
    # choke 5m micro / stale pulse so we do not stack another dozen rows.
    if len(events) >= 8:
        micro = micro[:1]
        pulse = []
    elif len(events) >= 4:
        micro = micro[:2]
        pulse = pulse[:1]

    tape_events = list(events) + list(micro) + list(pulse)
    if tape_events:
        raw = append_tape_from_events(tape_events)
        if feed is not None:
            feed["exec_log"] = collapse_exec_log_batches(raw)
            feed["exec_log_raw_count"] = len(raw)
            feed["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                write_live_feed(feed)
            except Exception as exc:
                log("live_feed tape patch error: {0}".format(exc))
        log(
            "tape appended real={0} micro={1} pulse={2} display={3}".format(
                len(events), len(micro), len(pulse), len(feed.get("exec_log") or []) if feed else 0
            )
        )

    tg_events = events_for_telegram(events)
    buffer_channel_events(tg_events)
    sent = maybe_flush_hour_brief()
    if sent:
        log("pushed hour brief to {0}".format(CHANNEL))
    elif tg_events:
        log("queued {0} 1h majors for hour brief (tape already written)".format(len(tg_events)))
    elif not events:
        log("no new scan events this tick")
    return sent


def demo_batch_message():
    """Simulated multi-symbol batch for channel QA."""
    now_ms = int(time.time() * 1000)
    samples = [
        ("BTCUSDT", 80000.0, -1.2, 2.4),
        ("ETHUSDT", 2500.0, -1.5, 3.0),
        ("SOLUSDT", 100.0, -2.0, 4.0),
    ]
    events = []
    for sym, px, sl_pct, tp_pct in samples:
        events.append(
            {
                "strat_name": "樞軸點突破",
                "tf": "1h",
                "side": "LONG",
                "sym": sym,
                "px": px,
                "sl_pct": sl_pct,
                "tp_pct": tp_pct,
                "prev_side": None,
                "close_ms": now_ms,
            }
        )
    return format_hour_brief(events, datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:00 UTC+8"))


def main():
    refresh_strategy_matrix()
    try:
        write_plaza_live_registry()
    except Exception as exc:
        log("plaza_live_registry boot error: {0}".format(exc))
    log(
        "event_engine start channel={0} poll={1}s publish={2}s web={3} strategies={4} plaza={5} symbols={6}".format(
            CHANNEL,
            POLL_SEC,
            FEED_PUBLISH_SEC,
            WEB_FEED_PATH,
            len(STRATEGY_MATRIX),
            len(plaza_strategy_ids()),
            len(SYMBOLS),
        )
    )
    if not BOT_TOKEN:
        log("FATAL: set TG_BOT_TOKEN", logging.ERROR)
        raise SystemExit(1)
    if edge_tts is None:
        log("WARN: edge_tts not installed — sweet-voice audio disabled (pip install edge-tts)", logging.WARNING)
    else:
        AUDIO_EXECUTOR.submit(ensure_welcome_audio)
        AUDIO_EXECUTOR.submit(ensure_funnel_audio)
    threading.Thread(target=feed_publish_loop, name="feed-publish", daemon=True).start()
    while True:
        try:
            cycle()
            try:
                gc.collect()
            except Exception:
                pass
        except Exception as exc:
            log("cycle error: {0}".format(exc), logging.ERROR)
            try:
                traceback.print_exc()
            except Exception:
                pass
            time.sleep(max(5, int(POLL_SEC // 2) or 5))
            continue
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--regen-audio",
        action="store_true",
        help="Purge and regenerate welcome/funnel MP3s with current TTS voice; "
        "purge sig_*.mp3 so new signals use the new voice.",
    )
    ap.add_argument(
        "--test-batch",
        action="store_true",
        help="Send one simulated aggregated multi-symbol signal to the channel, then exit.",
    )
    args = ap.parse_args()
    try:
        if args.regen_audio:
            regenerate_all_audio()
            raise SystemExit(0)
        if args.test_batch:
            if not BOT_TOKEN:
                raise SystemExit("TG_BOT_TOKEN missing")
            msg = demo_batch_message()
            log(msg)
            tg_send(msg)
            log("test-batch pushed to {0}".format(CHANNEL))
            raise SystemExit(0)
        main()
    except SystemExit:
        raise
    except Exception as exc:
        log("fatal engine exit: {0}".format(exc), logging.ERROR)
        try:
            traceback.print_exc()
        except Exception:
            pass
        time.sleep(5)
        raise SystemExit(1)
