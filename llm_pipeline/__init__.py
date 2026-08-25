# -*- coding: utf-8 -*-
import json
from typing import Any, Optional

import httpx

from hub.settings import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

SYSTEM_CODE = (
    "You are a quantitative researcher. Reply with ONLY Python, no markdown fences. "
    "pd, np, and pta are already in scope. Do NOT write import/from statements. "
    "Define PARAMS as a dict of 2 or 3 tunable knobs, each "
    '{"low": number, "high": number, "step": number, "kind": "period"|"threshold"}. '
    "Example period grid: low 10, high 50, step 5. "
    "Then define def generate_signals(df, fast=12, slow=26, thresh=30): ... "
    "Parameter names MUST match PARAMS keys. "
    "df columns: open, high, low, close, volume. "
    "Return a pandas Series aligned to df.index with values in {-1, 0, 1}. "
    "Use only pandas/numpy rolling, ewm, clip. No file I/O, no network."
)

SYSTEM_COPY = (
    "You write Traditional Chinese marketing copy for a high-frequency crypto GRID bot "
    "monetized via trading-fee rebates (volume turnover + LTV). "
    "Exactly ~200 Chinese characters. Plain spoken language, no markdown, no hashtags. "
    "Emphasize: adaptive grid spacing, high daily fill count, controlled drawdown, "
    "not guaranteed profits. Mention subtype and symbol when provided."
)

SYSTEM_FIX = (
    "You fix Python strategy code. Reply with ONLY the full PARAMS dict plus "
    "generate_signals function, no markdown. Keep 2-3 PARAMS keys and matching kwargs. "
    "pd/np/pta are in scope; no imports."
)


async def chat(messages: list[dict[str, str]], temperature: float = 0.3) -> str:
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY missing")
    url = DEEPSEEK_BASE_URL.rstrip("/") + "/chat/completions"
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    headers = {
        "Authorization": "Bearer {0}".format(DEEPSEEK_API_KEY),
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        print("[pipeline] LLM POST {0} model={1}".format(url, DEEPSEEK_MODEL), flush=True)
        resp = await client.post(url, headers=headers, json=payload)
        body = resp.json() if resp.content else {}
        if resp.status_code >= 400:
            raise RuntimeError("LLM {0}: {1}".format(resp.status_code, body))
        text = (((body.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        print("[pipeline] LLM HTTP {0} chars={1}".format(resp.status_code, len(text)), flush=True)
        return text


def strip_fences(code: str) -> str:
    s = (code or "").strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[-1]
        if s.endswith("```"):
            s = s[: -3]
        s = s.strip()
        if s.lower().startswith("python"):
            s = s.split("\n", 1)[-1]
    return s.strip()


async def generate_strategy_code(hint: str = "") -> str:
    families = [
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
    user = (
        "Write PARAMS + generate_signals for a 1H BTC/ETH/SOL {0}. {1} "
        "Keep the logic simple and vectorized."
    ).format(families[hash(hint) % len(families)] if hint else families[0], hint)
    raw = await chat(
        [{"role": "system", "content": SYSTEM_CODE}, {"role": "user", "content": user}],
        temperature=0.55,
    )
    return strip_fences(raw)


async def repair_strategy_code(code: str, error: str) -> str:
    raw = await chat(
        [
            {"role": "system", "content": SYSTEM_FIX},
            {
                "role": "user",
                "content": "Current code:\n{0}\n\nException:\n{1}".format(code, error[:2500]),
            },
        ],
        temperature=0.2,
    )
    return strip_fences(raw)


async def write_copy(metrics: dict[str, Any]) -> str:
    user = json.dumps(metrics, ensure_ascii=False)
    text = await chat(
        [{"role": "system", "content": SYSTEM_COPY}, {"role": "user", "content": user}],
        temperature=0.7,
    )
    return text.replace("\n", "").strip()
