# -*- coding: utf-8 -*-
"""US-region neutral OHLCV rails: Coinbase -> Binance.US -> Kraken.

Gate.io and api.binance.com are intentionally unused. Every public fetch is
bounded to 2.5s and fails over silently to the next venue.
"""
from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

TIMEOUT_SEC = 2.5
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 QuantAlpha/ohlcv"
)
SSL_CTX = ssl.create_default_context()

GRAN_SEC = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
COINBASE_GRAN = {60, 300, 900, 3600, 21600, 86400}
BINANCE_US_USDT = {
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "NEARUSDT",
    "BNBUSDT", "XRPUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT",
    "APTUSDT", "ARBUSDT", "OPUSDT", "AAVEUSDT", "SHIBUSDT",
}
BINANCE_US_USD = {"SUIUSDT": "SUIUSD", "ONDOUSDT": "ONDOUSD"}
BINANCE_US_SPECIAL = {"PEPEUSDT": ("1000PEPEUSDT", 0.001)}
KRAKEN_PAIR = {
    "BTCUSDT": "XXBTZUSD",
    "ETHUSDT": "XETHZUSD",
    "DOGEUSDT": "XDGUSD",
}

LAST_META: Dict[str, Any] = {"venue": None, "symbol": None, "tf": None, "n": 0, "ms": 0, "error": None}


def _base(sym: str) -> str:
    s = str(sym or "").upper().replace("/", "").replace("-", "")
    if s.endswith("USDT"):
        return s[:-4]
    if s.endswith("USD"):
        return s[:-3]
    return s


def _norm_sym(sym: str) -> str:
    s = str(sym or "").upper().replace("/", "").replace("-", "")
    if s.endswith("USD") and not s.endswith("USDT"):
        return s[:-3] + "USDT"
    return s if s.endswith("USDT") else s + "USDT"


def _candle(ts_sec: int, o: float, h: float, l: float, c: float, v: float) -> Dict[str, float]:
    return {
        "timestamp": int(ts_sec),
        "open": float(o),
        "high": float(h),
        "low": float(l),
        "close": float(c),
        "volume": float(v),
    }


def _clean(rows: List[Dict[str, float]], gran: int) -> List[Dict[str, float]]:
    now = int(time.time())
    out: List[Dict[str, float]] = []
    seen = set()
    for r in rows:
        ts = int(r["timestamp"])
        if ts in seen:
            continue
        if ts <= 0 or r["close"] <= 0:
            continue
        if ts + gran > now + 2:
            continue
        seen.add(ts)
        out.append(r)
    out.sort(key=lambda x: x["timestamp"])
    return out


def _http_json(url: str) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC, context=SSL_CTX) as resp:
        status = getattr(resp, "status", 200) or 200
        if int(status) != 200:
            raise RuntimeError("http {0}".format(status))
        raw = resp.read().decode("utf-8", "replace")
    return json.loads(raw)


def _coinbase_product(sym: str) -> str:
    return "{0}-USD".format(_base(sym))


def fetch_coinbase(sym: str, tf: str, limit: int) -> List[Dict[str, float]]:
    gran = int(GRAN_SEC.get(tf, 60))
    if gran not in COINBASE_GRAN:
        if gran < 300:
            gran = 60
        elif gran < 900:
            gran = 300
        elif gran < 3600:
            gran = 900
        else:
            gran = 3600
    product = urllib.parse.quote(_coinbase_product(sym), safe="-")
    end = int(time.time())
    start = end - gran * max(int(limit), 1) - gran
    url = (
        "https://api.exchange.coinbase.com/products/{0}/candles"
        "?granularity={1}&start={2}&end={3}"
    ).format(product, gran, start, end)
    data = _http_json(url)
    if not isinstance(data, list) or not data:
        raise RuntimeError("coinbase empty")
    rows = []
    for item in data:
        # [time, low, high, open, close, volume]
        ts = int(float(item[0]))
        lo, hi, op, cl, vol = (float(item[1]), float(item[2]), float(item[3]), float(item[4]), float(item[5]))
        rows.append(_candle(ts, op, hi, lo, cl, vol))
    out = _clean(rows, gran)
    if len(out) < min(20, max(8, limit // 4)):
        raise RuntimeError("coinbase short {0}".format(len(out)))
    return out[-int(limit) :]


def _binance_us_pair(sym: str) -> Tuple[str, float]:
    key = _norm_sym(sym)
    if key in BINANCE_US_SPECIAL:
        return BINANCE_US_SPECIAL[key]
    if key in BINANCE_US_USD:
        return BINANCE_US_USD[key], 1.0
    if key in BINANCE_US_USDT:
        return key, 1.0
    return key, 1.0


def fetch_binance_us(sym: str, tf: str, limit: int) -> List[Dict[str, float]]:
    pair, px_scale = _binance_us_pair(sym)
    interval = tf if tf in ("1m", "5m", "15m", "1h", "4h", "1d") else "1m"
    url = (
        "https://api.binance.us/api/v3/klines?symbol={0}&interval={1}&limit={2}"
    ).format(urllib.parse.quote(pair), interval, int(limit))
    data = _http_json(url)
    if not isinstance(data, list) or not data:
        raise RuntimeError("binance.us empty")
    gran = int(GRAN_SEC.get(tf, 60))
    rows = []
    now_ms = int(time.time() * 1000)
    for item in data:
        close_ms = int(item[6]) if len(item) > 6 else int(item[0]) + gran * 1000
        if close_ms > now_ms:
            continue
        op, hi, lo, cl, vol = (float(item[1]), float(item[2]), float(item[3]), float(item[4]), float(item[5]))
        if px_scale != 1.0:
            op, hi, lo, cl = op * px_scale, hi * px_scale, lo * px_scale, cl * px_scale
            vol = vol / px_scale if px_scale else vol
        rows.append(_candle(int(int(item[0]) / 1000), op, hi, lo, cl, vol))
    out = _clean(rows, gran)
    if len(out) < min(20, max(8, limit // 4)):
        raise RuntimeError("binance.us short {0}".format(len(out)))
    return out[-int(limit) :]


def _kraken_pair(sym: str) -> str:
    key = _norm_sym(sym)
    if key in KRAKEN_PAIR:
        return KRAKEN_PAIR[key]
    return "{0}USD".format(_base(key))


def fetch_kraken(sym: str, tf: str, limit: int) -> List[Dict[str, float]]:
    gran = int(GRAN_SEC.get(tf, 60))
    interval = {60: 1, 300: 5, 900: 15, 3600: 60, 14400: 240, 86400: 1440}.get(gran, 1)
    pair = _kraken_pair(sym)
    url = "https://api.kraken.com/0/public/OHLC?pair={0}&interval={1}".format(
        urllib.parse.quote(pair), interval
    )
    data = _http_json(url)
    if not isinstance(data, dict):
        raise RuntimeError("kraken bad payload")
    if data.get("error"):
        raise RuntimeError("kraken {0}".format(data.get("error")))
    result = data.get("result") or {}
    series = None
    for key, val in result.items():
        if key == "last":
            continue
        if isinstance(val, list):
            series = val
            break
    if not series:
        raise RuntimeError("kraken empty")
    rows = []
    for item in series:
        # time, open, high, low, close, vwap, volume, count
        ts = int(float(item[0]))
        op, hi, lo, cl, vol = (float(item[1]), float(item[2]), float(item[3]), float(item[4]), float(item[6]))
        rows.append(_candle(ts, op, hi, lo, cl, vol))
    out = _clean(rows, gran)
    if len(out) < min(20, max(8, limit // 4)):
        raise RuntimeError("kraken short {0}".format(len(out)))
    return out[-int(limit) :]


VENUES = (
    ("coinbase", fetch_coinbase),
    ("binance_us", fetch_binance_us),
    ("kraken", fetch_kraken),
)


def fetch_ohlcv(sym: str, tf: str = "1m", limit: int = 60) -> List[Dict[str, float]]:
    """Sequential P0->P1->P2 failover. Never raises to the caller; returns []."""
    global LAST_META
    symbol = _norm_sym(sym)
    errors: List[str] = []
    for name, fn in VENUES:
        t0 = time.time()
        try:
            rows = fn(symbol, tf, int(limit) or 60)
            ms = int((time.time() - t0) * 1000)
            LAST_META = {
                "venue": name,
                "symbol": symbol,
                "tf": tf,
                "n": len(rows),
                "ms": ms,
                "error": None,
            }
            return rows
        except Exception as exc:
            ms = int((time.time() - t0) * 1000)
            errors.append("{0}:{1}:{2}ms".format(name, exc, ms))
            continue
    LAST_META = {
        "venue": None,
        "symbol": symbol,
        "tf": tf,
        "n": 0,
        "ms": 0,
        "error": " | ".join(errors)[:400],
    }
    return []


def to_engine_pack(rows: List[Dict[str, float]], src: str, tf: str) -> Optional[Dict[str, Any]]:
    if not rows:
        return None
    gran_ms = int(GRAN_SEC.get(tf, 60)) * 1000
    t, h, l, c, v = [], [], [], [], []
    for r in rows:
        t.append(int(r["timestamp"]) * 1000)
        h.append(float(r["high"]))
        l.append(float(r["low"]))
        c.append(float(r["close"]))
        v.append(float(r["volume"]))
    return {
        "h": h,
        "l": l,
        "c": c,
        "v": v,
        "t": t,
        "close_ms": t[-1] + gran_ms,
        "src": src,
        "venue": src,
    }


def fetch_engine_pack(sym: str, tf: str = "1h", limit: int = 150) -> Optional[Dict[str, Any]]:
    rows = fetch_ohlcv(sym, tf, limit)
    venue = LAST_META.get("venue") or "neutral"
    return to_engine_pack(rows, venue, tf)


def last_meta() -> Dict[str, Any]:
    return dict(LAST_META)
