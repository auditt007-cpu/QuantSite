# -*- coding: utf-8 -*-
"""Event-driven Telegram signal engine — shared kline pool, 45-strategy matrix."""

import json
import math
import os
import ssl
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "").strip()
CHANNEL = (
    os.environ.get("TG_CHANNEL_ID", "").strip()
    or os.environ.get("TG_CHANNEL", "").strip()
    or "@quant_alpha_signals"
)
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT"]
TIMEFRAMES = ("15m", "1h")
POLL_SEC = 60
KLINE_LIMIT = 200
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
TIMEOUT = 15
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

SIGNAL_STATE = {}
KLINE_POOL = {}

SIDE_ZHT = {"LONG": "做多", "SHORT": "做空"}
SIDE_EN = {"LONG": "LONG", "SHORT": "SHORT"}


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print("[{0}] {1}".format(ts, msg), flush=True)


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as resp:
        raw = resp.read().decode("utf-8", "replace")
    return json.loads(raw)


def okx_inst(sym):
    return "{0}-USDT".format(sym.replace("USDT", ""))


def binance_interval(tf):
    return "15m" if tf == "15m" else "1h"


def okx_bar(tf):
    return "15m" if tf == "15m" else "1H"


def fetch_klines(sym, tf):
    interval = binance_interval(tf)
    url = (
        "https://api.binance.com/api/v3/klines?symbol={0}&interval={1}&limit={2}"
    ).format(sym, interval, KLINE_LIMIT)
    rows = http_json(url)
    now_ms = int(time.time() * 1000)
    if rows and int(rows[-1][6]) > now_ms:
        rows = rows[:-1]
    if len(rows) < 60:
        raise RuntimeError("binance insufficient bars")
    return pack_rows(rows, "binance", binance=True, tf=tf)


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


def bar_duration_ms(tf):
    return 15 * 60 * 1000 if tf == "15m" else 60 * 60 * 1000


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
    try:
        return fetch_klines(sym, tf)
    except Exception as exc:
        log("{0} {1} binance fail: {2}; fallback okx".format(sym, tf, exc))
        return fetch_klines_okx(sym, tf)


def refresh_pool():
    global KLINE_POOL
    for sym in SYMBOLS:
        for tf in TIMEFRAMES:
            key = (sym, tf)
            try:
                KLINE_POOL[key] = load_klines(sym, tf)
            except Exception as exc:
                log("pool skip {0} {1}: {2}".format(sym, tf, exc))


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


def build_strategy_matrix():
    specs = []
    families = [
        ("ema_12_26", "EMA雙均交叉", "EMA Double Cross", "15m", lambda d: eval_ema_cross(d, 12, 26)),
        ("ema_12_26", "EMA雙均交叉", "EMA Double Cross", "1h", lambda d: eval_ema_cross(d, 12, 26)),
        ("ema_5_13", "EMA快線交叉", "EMA Fast Cross", "15m", lambda d: eval_ema_cross(d, 5, 13)),
        ("ema_5_13", "EMA快線交叉", "EMA Fast Cross", "1h", lambda d: eval_ema_cross(d, 5, 13)),
        ("ema_triple", "EMA三均共振", "EMA Triple Stack", "15m", eval_ema_triple),
        ("ema_triple", "EMA三均共振", "EMA Triple Stack", "1h", eval_ema_triple),
        ("don_20", "唐奇安突破20", "Donchian 20 Break", "15m", lambda d: eval_donchian(d, 20)),
        ("don_20", "唐奇安突破20", "Donchian 20 Break", "1h", lambda d: eval_donchian(d, 20)),
        ("don_10", "唐奇安突破10", "Donchian 10 Break", "15m", lambda d: eval_donchian(d, 10)),
        ("don_10", "唐奇安突破10", "Donchian 10 Break", "1h", lambda d: eval_donchian(d, 10)),
        ("bb_reb", "布林均值回歸", "Bollinger Rebound", "15m", lambda d: eval_bb_rebound(d, 20, 2.0)),
        ("bb_reb", "布林均值回歸", "Bollinger Rebound", "1h", lambda d: eval_bb_rebound(d, 20, 2.0)),
        ("bb_sqz", "布林擠壓突破", "BB Squeeze Break", "15m", lambda d: eval_bb_squeeze_break(d, 20)),
        ("bb_sqz", "布林擠壓突破", "BB Squeeze Break", "1h", lambda d: eval_bb_squeeze_break(d, 20)),
        ("rsi_x", "RSI超賣超買交叉", "RSI Threshold Cross", "15m", lambda d: eval_rsi_cross(d, 30, 70)),
        ("rsi_x", "RSI超賣超買交叉", "RSI Threshold Cross", "1h", lambda d: eval_rsi_cross(d, 30, 70)),
        ("rsi_div", "RSI背離代理", "RSI Divergence Proxy", "15m", eval_rsi_div_proxy),
        ("rsi_div", "RSI背離代理", "RSI Divergence Proxy", "1h", eval_rsi_div_proxy),
        ("macd_h", "MACD柱翻轉", "MACD Histogram Flip", "15m", eval_macd_hist_cross),
        ("macd_h", "MACD柱翻轉", "MACD Histogram Flip", "1h", eval_macd_hist_cross),
        ("macd_s", "MACD信號交叉", "MACD Signal Cross", "15m", eval_macd_signal_cross),
        ("macd_s", "MACD信號交叉", "MACD Signal Cross", "1h", eval_macd_signal_cross),
        ("st_atr", "ATR超級趨勢", "ATR SuperTrend Break", "15m", lambda d: eval_supertrend_break(d, 10, 3.0)),
        ("st_atr", "ATR超級趨勢", "ATR SuperTrend Break", "1h", lambda d: eval_supertrend_break(d, 10, 3.0)),
        ("atr_grid", "ATR波動網格", "ATR Volatility Grid", "15m", lambda d: eval_atr_grid(d, 1.5)),
        ("atr_grid", "ATR波動網格", "ATR Volatility Grid", "1h", lambda d: eval_atr_grid(d, 1.5)),
        ("vsa", "成交量價差VSA", "Volume Spread Analysis", "15m", lambda d: eval_vsa_spike(d, 1.5)),
        ("vsa", "成交量價差VSA", "Volume Spread Analysis", "1h", lambda d: eval_vsa_spike(d, 1.5)),
        ("roc10", "ROC10動能", "ROC-10 Momentum", "15m", lambda d: eval_roc(d, 10, 0.35)),
        ("roc10", "ROC10動能", "ROC-10 Momentum", "1h", lambda d: eval_roc(d, 10, 0.35)),
        ("roc20", "ROC20動能", "ROC-20 Momentum", "15m", lambda d: eval_roc(d, 20, 0.55)),
        ("roc20", "ROC20動能", "ROC-20 Momentum", "1h", lambda d: eval_roc(d, 20, 0.55)),
        ("kelt", "肯特納突破", "Keltner Breakout", "15m", eval_keltner_break),
        ("kelt", "肯特納突破", "Keltner Breakout", "1h", eval_keltner_break),
        ("pivot", "樞軸點突破", "Pivot Point Break", "15m", eval_pivot_break),
        ("pivot", "樞軸點突破", "Pivot Point Break", "1h", eval_pivot_break),
        ("dual", "Dual Thrust", "Dual Thrust Break", "15m", lambda d: eval_dual_thrust(d, 4)),
        ("dual", "Dual Thrust", "Dual Thrust Break", "1h", lambda d: eval_dual_thrust(d, 4)),
        ("vol_ma", "量均突破", "Volume MA Break", "15m", eval_vol_ma_break),
        ("vol_ma", "量均突破", "Volume MA Break", "1h", eval_vol_ma_break),
        ("combo", "複合動能確認", "Composite Momentum", "15m", eval_composite_mom),
        ("combo", "複合動能確認", "Composite Momentum", "1h", eval_composite_mom),
        ("trend50", "EMA50趨勢突破", "EMA50 Trend Break", "15m", lambda d: eval_ema_cross(d, 20, 50)),
        ("trend50", "EMA50趨勢突破", "EMA50 Trend Break", "1h", lambda d: eval_ema_cross(d, 20, 50)),
        ("bb_wide", "布林寬帶回歸", "BB Wide Rebound", "15m", lambda d: eval_bb_rebound(d, 20, 2.5)),
        ("bb_wide", "布林寬帶回歸", "BB Wide Rebound", "1h", lambda d: eval_bb_rebound(d, 20, 2.5)),
    ]
    for idx, (fid, zht, en, tf, fn) in enumerate(families[:45], start=1):
        sid = "{0}_{1}_{2}".format(fid, tf, idx)
        specs.append(
            {
                "id": sid,
                "zht": zht,
                "en": en,
                "tf": tf,
                "eval": fn,
            }
        )
    return specs


STRATEGY_MATRIX = build_strategy_matrix()


def fmt_ts_ms(ms):
    dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    tw = dt.astimezone(timezone(timedelta(hours=8)))
    return "{0} UTC · {1} TW".format(dt.strftime("%Y-%m-%d %H:%M"), tw.strftime("%H:%M"))


def fmt_px(px):
    if px >= 1000:
        return "{0:.2f}".format(px)
    if px >= 1:
        return "{0:.4f}".format(px)
    return "{0:.6f}".format(px)


def state_key(sid, sym, tf):
    return "{0}_{1}_{2}".format(sid, sym, tf)


def should_emit(sid, sym, tf, side, bar_ts):
    key = state_key(sid, sym, tf)
    prev = SIGNAL_STATE.get(key)
    if prev and prev.get("side") == side and prev.get("bar_ts") == bar_ts:
        return False
    SIGNAL_STATE[key] = {"side": side, "bar_ts": bar_ts}
    return True


def tg_send(text):
    if not BOT_TOKEN:
        raise RuntimeError("TG_BOT_TOKEN missing")
    url = "https://api.telegram.org/bot{0}/sendMessage".format(BOT_TOKEN)
    body = urllib.parse.urlencode(
        {
            "chat_id": CHANNEL,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        }
    ).encode("utf-8")
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
    tw = datetime.fromtimestamp(ms / 1000.0, tz=timezone(timedelta(hours=8)))
    return time.strftime("%Y-%m-%d %H:%M", tw.timetuple())


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


def send_tg_signal(strat, sym, side, px, sl, tp, bar_ts, src):
    """Build Taiwan-friendly + institutional bilingual TG alert card (HTML)."""
    coin = sym.replace("USDT", "")
    tf_label = strat["tf"].upper()
    sl_pct, tp_pct = sl_tp_display_pcts(side, px, sl, tp)
    tw_time = fmt_tw_time_ms(bar_ts)
    terminal_url = "https://quantalpha.space/terminal.html"
    return (
        "<b>⚡ QUANT ALPHA · LIVE SIGNAL</b>\n"
        "【 量化異動訊號 · 即時推播 】\n"
        "\n"
        "{0}\n"
        "\n"
        "📌 標的 <b>{1}</b> · 週期 <b>{2}</b>\n"
        "📊 策略 <b>{3}</b>\n"
        "<i>{4}</i>\n"
        "\n"
        "💰 建議進場點 (Entry): <b>{5}</b> USDT\n"
        "🛑 風控止損位 (Stop Loss): <b>{6}</b> ({7:.2f}%)\n"
        "🎯 目標止盈位 (Take Profit): <b>{8}</b> ({9:+.2f}%)\n"
        "⚖️ 盈虧比 (Risk/Reward): <b>1 : 2.0</b>\n"
        "\n"
        "🕐 台灣時間 (UTC+8): <b>{10}</b>\n"
        "📡 行情來源 (Feed): {11}\n"
        "\n"
        '🔗 <a href="{12}">Quant Alpha 策略廣場 · Strategy Plaza</a>\n'
        "\n"
        "⚠️ 提醒：量化模型訊號僅供參考，請嚴格執行止損止盈，切勿重倉抗單。"
    ).format(
        side_banner(side),
        coin,
        tf_label,
        strat["zht"],
        strat["en"],
        fmt_px(px),
        fmt_px(sl),
        sl_pct,
        fmt_px(tp),
        tp_pct,
        tw_time,
        src.upper(),
        terminal_url,
    )


def format_alert(strat, sym, side, px, sl, tp, bar_ts, src):
    return send_tg_signal(strat, sym, side, px, sl, tp, bar_ts, src)


def scan_events():
    alerts = []
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
            bar_ts = data["t"][-1]
            if not should_emit(strat["id"], sym, tf, side, bar_ts):
                continue
            c = data["c"]
            h, l = data["h"], data["l"]
            px = c[-1]
            risk = atr(h, l, c, 14)[-1]
            if risk <= 0:
                risk = px * 0.004
            sl, tp = levels(px, side, risk)
            alerts.append(format_alert(strat, sym, side, px, sl, tp, data["close_ms"], data["src"]))
            log("signal {0} {1} {2} {3} bar={4}".format(strat["id"], sym, tf, side, bar_ts))
    return alerts


def cycle():
    refresh_pool()
    ok = sum(1 for s in SYMBOLS for t in TIMEFRAMES if (s, t) in KLINE_POOL)
    log("pool refreshed {0}/{1} series".format(ok, len(SYMBOLS) * len(TIMEFRAMES)))
    alerts = scan_events()
    if not alerts:
        log("no new events this tick")
        return 0
    for msg in alerts:
        tg_send(msg)
    log("pushed {0} event(s) to {1}".format(len(alerts), CHANNEL))
    return len(alerts)


def main():
    log(
        "event_engine start channel={0} poll={1}s strategies={2} symbols={3}".format(
            CHANNEL, POLL_SEC, len(STRATEGY_MATRIX), len(SYMBOLS)
        )
    )
    if not BOT_TOKEN:
        log("FATAL: set TG_BOT_TOKEN")
        raise SystemExit(1)
    while True:
        try:
            cycle()
        except Exception as exc:
            log("cycle error: {0}".format(exc))
            traceback.print_exc()
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
