# -*- coding: utf-8 -*-
"""Outbound-only Telegram signal engine. No local listen sockets."""

import json
import os
import ssl
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "").strip()
CHANNEL = os.environ.get("TG_CHANNEL", "@quant_alpha_signals").strip() or "@quant_alpha_signals"
BOT_USER = os.environ.get("TG_BOT_USER", "@grid_quant_bot").strip() or "@grid_quant_bot"
BOT_URL = os.environ.get("TG_BOT_URL", "https://t.me/grid_quant_bot").strip() or "https://t.me/grid_quant_bot"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
POLL_SEC = 3600
UA = "Mozilla/5.0"
SSL_CTX = ssl.create_default_context()
TIMEOUT = 12

STRATS = [
    ("ema_trend", "雙均線趨勢", "Dual EMA Trend", "免費組"),
    ("rsi_rev", "RSI 超買超賣", "RSI Reversal", "免費組"),
    ("macd_mom", "MACD 動能轉折", "MACD Momentum", "大師組"),
    ("donchian", "唐奇安通道突破", "Donchian Breakout", "免費組"),
    ("bbands", "布林通道均值回歸", "Bollinger Mean Reversion", "免費組"),
    ("supertrend", "ATR 超級趨勢", "ATR SuperTrend", "大師組"),
    ("roc_mom", "價格動能", "Price Momentum", "大師組"),
]

SIDE_TAG = {
    "LONG": ("🟢 做多", "LONG"),
    "SHORT": ("🔴 做空", "SHORT"),
    "FLAT": ("⚪ 觀望", "FLAT"),
}

NET_BADGE = {
    "LONG": ("🟢 共識做多", "Consensus LONG"),
    "SHORT": ("🔴 共識做空", "Consensus SHORT"),
    "FLAT": ("⚪ 觀望", "Wait & See"),
}


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print("[{0}] {1}".format(ts, msg), flush=True)


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as resp:
        raw = resp.read().decode("utf-8", "replace")
    return json.loads(raw)


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
        out[i] = (sum((x - m) ** 2 for x in w) / float(len(w))) ** 0.5
    return out


def rsi(closes, n=14):
    out = [50.0] * len(closes)
    if len(closes) < n + 1:
        return out
    gains = 0.0
    losses = 0.0
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


def macd_hist(closes):
    e12 = ema(closes, 12)
    e26 = ema(closes, 26)
    line = [a - b for a, b in zip(e12, e26)]
    sig = ema(line, 9)
    return [a - b for a, b in zip(line, sig)]


def atr(h, l, c, n=14):
    tr = [0.0] * len(c)
    for i in range(len(c)):
        if i == 0:
            tr[i] = h[i] - l[i]
        else:
            tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    return ema(tr, n)


def okx_inst(sym):
    return "{0}-USDT".format(sym.replace("USDT", ""))


def klines_binance(sym):
    url = "https://api.binance.com/api/v3/klines?symbol={0}&interval=5m&limit=200".format(sym)
    rows = http_json(url)
    h = [float(r[2]) for r in rows]
    l = [float(r[3]) for r in rows]
    c = [float(r[4]) for r in rows]
    close_ms = int(rows[-1][6]) if rows else int(time.time() * 1000)
    close_at = datetime.fromtimestamp(close_ms / 1000.0, tz=timezone.utc)
    return h, l, c, "binance", close_at


def klines_okx(sym):
    url = "https://www.okx.com/api/v5/market/candles?instId={0}&bar=5m&limit=200".format(okx_inst(sym))
    data = http_json(url)
    rows = list(reversed(data.get("data") or []))
    if not rows:
        raise RuntimeError("okx empty")
    h = [float(r[2]) for r in rows]
    l = [float(r[3]) for r in rows]
    c = [float(r[4]) for r in rows]
    close_ms = int(rows[-1][0]) if rows else int(time.time() * 1000)
    close_at = datetime.fromtimestamp(close_ms / 1000.0, tz=timezone.utc)
    return h, l, c, "okx", close_at


def load_klines(sym):
    try:
        return klines_binance(sym)
    except Exception as exc:
        log("{0} binance fail: {1}; fallback okx".format(sym, exc))
        return klines_okx(sym)


def levels(px, side, risk):
    if side == "LONG":
        return round(px - risk, 4), round(px + 2 * risk, 4)
    return round(px + risk, 4), round(px - 2 * risk, 4)


def signal_ema(h, l, c):
    f, s = ema(c, 12), ema(c, 26)
    if f[-1] > s[-1] and f[-2] <= s[-2]:
        return "LONG"
    if f[-1] < s[-1] and f[-2] >= s[-2]:
        return "SHORT"
    if f[-1] > s[-1]:
        return "LONG"
    if f[-1] < s[-1]:
        return "SHORT"
    return "FLAT"


def signal_rsi(h, l, c):
    r = rsi(c, 14)
    if r[-1] < 30:
        return "LONG"
    if r[-1] > 70:
        return "SHORT"
    return "FLAT"


def signal_macd(h, l, c):
    hist = macd_hist(c)
    if hist[-1] > 0 and hist[-2] <= 0:
        return "LONG"
    if hist[-1] < 0 and hist[-2] >= 0:
        return "SHORT"
    if hist[-1] > 0:
        return "LONG"
    if hist[-1] < 0:
        return "SHORT"
    return "FLAT"


def signal_donchian(h, l, c):
    n = 20
    if len(c) < n + 2:
        return "FLAT"
    up = max(h[-n - 1 : -1])
    dn = min(l[-n - 1 : -1])
    if c[-1] > up:
        return "LONG"
    if c[-1] < dn:
        return "SHORT"
    return "FLAT"


def signal_bbands(h, l, c):
    n = 20
    m = sma(c, n)
    sd = stdev(c, n)
    lo, hi = m[-1] - 2 * sd[-1], m[-1] + 2 * sd[-1]
    if c[-1] < lo:
        return "LONG"
    if c[-1] > hi:
        return "SHORT"
    return "FLAT"


def signal_supertrend(h, l, c):
    a = atr(h, l, c, 10)
    mid = (h[-1] + l[-1]) / 2.0
    upper = mid + 3 * a[-1]
    lower = mid - 3 * a[-1]
    if c[-1] > upper:
        return "LONG"
    if c[-1] < lower:
        return "SHORT"
    if c[-1] > mid:
        return "LONG"
    return "SHORT"


def signal_roc(h, l, c):
    n = 10
    if len(c) <= n or c[-n - 1] == 0:
        return "FLAT"
    roc = (c[-1] / c[-n - 1] - 1) * 100
    if roc > 0.4:
        return "LONG"
    if roc < -0.4:
        return "SHORT"
    return "FLAT"


HANDLERS = {
    "ema_trend": signal_ema,
    "rsi_rev": signal_rsi,
    "macd_mom": signal_macd,
    "donchian": signal_donchian,
    "bbands": signal_bbands,
    "supertrend": signal_supertrend,
    "roc_mom": signal_roc,
}


def score_side(votes):
    long_n = votes.count("LONG")
    short_n = votes.count("SHORT")
    if long_n > short_n and long_n >= 3:
        return "LONG", long_n, short_n
    if short_n > long_n and short_n >= 3:
        return "SHORT", long_n, short_n
    return "FLAT", long_n, short_n


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


def fmt_ts(dt):
    tw = dt.astimezone(timezone(timedelta(hours=8)))
    utc = dt.astimezone(timezone.utc)
    return "{0} 台灣 · {1} US".format(
        tw.strftime("%Y-%m-%d %H:%M"),
        utc.strftime("%H:%M"),
    )


def fmt_px(px):
    if px >= 100:
        return "{0:.2f}".format(px)
    if px >= 1:
        return "{0:.4f}".format(px)
    return "{0:.6f}".format(px)


def build_symbol(sym):
    h, l, c, src, bar_at = load_klines(sym)
    ts_label = fmt_ts(bar_at)
    px = c[-1]
    risk = atr(h, l, c, 14)[-1]
    if risk <= 0:
        risk = px * 0.004
    rows = []
    votes = []
    for sid, zht, en, grp in STRATS:
        side = HANDLERS[sid](h, l, c)
        votes.append(side)
        sl, tp = ("—", "—") if side == "FLAT" else levels(px, side, risk)
        zht_side, en_side = SIDE_TAG[side]
        sls = fmt_px(sl) if side != "FLAT" else "—"
        tps = fmt_px(tp) if side != "FLAT" else "—"
        rows.append(
            "{0}\n•【{1}】 {2} / {3}\n  {4} / {5}  ·  SL {6}  ·  TP {7}".format(
                ts_label, grp, zht, en, zht_side, en_side, sls, tps
            )
        )
    net, ln, sn = score_side(votes)
    sl, tp = ("—", "—") if net == "FLAT" else levels(px, net, risk)
    return {
        "sym": sym,
        "px": px,
        "src": src,
        "net": net,
        "ln": ln,
        "sn": sn,
        "sl": sl,
        "tp": tp,
        "rows": rows,
        "bar_at": bar_at,
    }


def cycle():
    op_at = datetime.now(timezone.utc)
    blocks = []
    for sym in SYMBOLS:
        try:
            blocks.append(build_symbol(sym))
            log("{0} priced from {1} bar={2}".format(sym, blocks[-1]["src"], fmt_ts(blocks[-1]["bar_at"])))
        except Exception as exc:
            log("{0} skip: {1}".format(sym, exc))
            traceback.print_exc()
    if not blocks:
        raise RuntimeError("all symbols failed")
    now = fmt_ts(op_at)
    lines = [
        "<b>QUANT ALPHA · 1 小時訊號台</b>",
        "<b>Hourly Signal Desk</b>",
        now + " · 推送",
        "K 線收盤時間見各幣種 · Bar close time per symbol",
        "RR 1:2  ·  Binance → OKX",
        "",
    ]
    for b in blocks:
        net = b["net"]
        zht_badge, en_badge = NET_BADGE[net]
        coin = b["sym"].replace("USDT", "")
        lines.append("<b>{0}</b>  {1} USDT  <i>({2})</i>".format(coin, fmt_px(b["px"]), b["src"]))
        lines.append("Bar " + fmt_ts(b["bar_at"]))
        lines.append("{0} / {1}".format(zht_badge, en_badge))
        lines.append("多 {0} · 空 {1}  /  Long {0} · Short {1}".format(b["ln"], b["sn"]))
        if net != "FLAT":
            lines.append(
                "倉位 {0}  ·  止損 {1}  ·  止盈 {2}".format(net, fmt_px(b["sl"]), fmt_px(b["tp"]))
            )
            lines.append(
                "Position {0}  ·  SL {1}  ·  TP {2}".format(net, fmt_px(b["sl"]), fmt_px(b["tp"]))
            )
        lines.extend(b["rows"])
        lines.append("")
    lines.append("僅供研究樣本，不構成投資建議。")
    lines.append("For research only — not investment advice.")
    lines.append("")
    lines.append('📩 <b>聯繫我們</b>  {0}'.format(BOT_USER))
    lines.append('<a href="{0}">{0}</a>  ·  Contact us'.format(BOT_URL))
    tg_send("\n".join(lines).strip())
    log("pushed {0} symbols to {1}".format(len(blocks), CHANNEL))


def main():
    log("tg_engine start channel={0} poll={1}s (no inbound ports)".format(CHANNEL, POLL_SEC))
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
