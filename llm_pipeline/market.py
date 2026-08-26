# -*- coding: utf-8 -*-
import json
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List

import pandas as pd

# Primary mining book is BTC only — multi-coin clones of the same subtype are noise.
SYMBOLS = ("BTC/USDT",)
# ETH kept solely for PAIRS_COINT_GRID (ETH/BTC spread); not a second plaza book.
PAIR_EXTRA = ("ETH/USDT",)
PRIMARY_TIMEFRAME = "15m"
UA = "QuantSitePipeline/2.0"


def _to_df(rows) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    df = df.set_index("ts").astype(float)
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df


def _http_json(url: str) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_ohlcv_ccxt(exchange_id: str, symbol: str, timeframe: str, since_ms: int) -> pd.DataFrame:
    import ccxt

    klass = getattr(ccxt, exchange_id)
    ex = klass({"enableRateLimit": True, "options": {"defaultType": "spot"}})
    out: List = []
    since = since_ms
    while True:
        batch = ex.fetch_ohlcv(symbol, timeframe=timeframe, since=since, limit=1000)
        if not batch:
            break
        out.extend(batch)
        since = batch[-1][0] + 1
        if len(batch) < 300:
            break
        if len(out) > 9000:
            break
    if not out:
        raise RuntimeError("{0} empty {1}".format(exchange_id, symbol))
    return _to_df(out)


def fetch_ohlcv_okx_http(inst: str, bar: str = "1H", since_ms: int = 0) -> pd.DataFrame:
    rows: List = []
    after = ""
    while True:
        url = "https://www.okx.com/api/v5/market/history-candles?instId={0}&bar={1}&limit=100".format(inst, bar)
        if after:
            url += "&after={0}".format(after)
        data = _http_json(url)
        batch = data.get("data") or []
        if not batch:
            break
        packed = []
        for r in batch:
            ts = int(r[0])
            packed.append([ts, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])])
        rows.extend(packed)
        oldest = min(int(r[0]) for r in batch)
        if oldest <= since_ms:
            break
        after = str(oldest)
        if len(rows) > 9000:
            break
        time.sleep(0.12)
    if not rows:
        raise RuntimeError("okx empty {0}".format(inst))
    return _to_df(rows)


def fetch_ohlcv_bybit_http(symbol: str, since_ms: int) -> pd.DataFrame:
    rows: List = []
    end = int(time.time() * 1000)
    while True:
        url = (
            "https://api.bybit.com/v5/market/kline?category=spot&symbol={0}&interval=60&limit=1000&end={1}"
        ).format(symbol, end)
        data = _http_json(url)
        batch = ((data.get("result") or {}).get("list") or [])
        if not batch:
            break
        packed = []
        for r in batch:
            packed.append([int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])])
        rows.extend(packed)
        oldest = min(int(r[0]) for r in batch)
        if oldest <= since_ms:
            break
        end = oldest - 1
        if len(rows) > 9000:
            break
        time.sleep(0.12)
    if not rows:
        raise RuntimeError("bybit empty {0}".format(symbol))
    return _to_df(rows)


def load_universe(days: int = 180, include_pair_extra: bool = True) -> Dict[str, pd.DataFrame]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    since_ms = int(since.timestamp() * 1000)
    out: Dict[str, pd.DataFrame] = {}
    pairs = list(SYMBOLS) + (list(PAIR_EXTRA) if include_pair_extra else [])
    for pair in pairs:
        key = pair.replace("/", "")
        inst = pair.replace("/", "-")
        last_err = None
        df = None
        sources: List[tuple[str, Callable[[], pd.DataFrame]]] = [
            ("ccxt-okx", lambda p=pair: fetch_ohlcv_ccxt("okx", p, "1h", since_ms)),
            ("okx-http", lambda i=inst: fetch_ohlcv_okx_http(i, "1H", since_ms)),
            ("ccxt-bybit", lambda p=pair: fetch_ohlcv_ccxt("bybit", p, "1h", since_ms)),
            ("bybit-http", lambda k=key: fetch_ohlcv_bybit_http(k, since_ms)),
            ("ccxt-binance", lambda p=pair: fetch_ohlcv_ccxt("binance", p, "1h", since_ms)),
        ]
        for name, fn in sources:
            try:
                df = fn()
                print("[pipeline] kline {0} via {1} bars={2}".format(key, name, len(df)), flush=True)
                break
            except Exception as exc:
                last_err = exc
                print("[pipeline] kline {0} {1} failed: {2}".format(key, name, str(exc)[:180]), flush=True)
        if df is None:
            raise RuntimeError("no kline source for {0}: {1}".format(key, last_err))
        df = df[df.index >= pd.Timestamp(since)]
        if len(df) < 200:
            raise RuntimeError("{0} too few bars: {1}".format(key, len(df)))
        out[key] = df
    return out
