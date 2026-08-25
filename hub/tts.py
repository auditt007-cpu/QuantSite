# -*- coding: utf-8 -*-
"""Edge-TTS helpers for live-room speech (persona male / HsiaoChen TW)."""
from __future__ import annotations

import io
from typing import Tuple

try:
    import edge_tts
except ImportError:  # pragma: no cover
    edge_tts = None

VOICE_BY_LANG: dict[str, Tuple[str, str, str]] = {
    # zh-CN: Yunjian ≈ 京味男声（郭德纲人设文案，非克隆）
    "zh-CN": ("zh-CN-YunjianNeural", "+5%", "-5Hz"),
    # en: Guy ≈ 低沉男声（Trump 演说风文案，非克隆）
    "en": ("en-US-GuyNeural", "+8%", "+0Hz"),
    "zh-Hant": ("zh-TW-HsiaoChenNeural", "+8%", "+0Hz"),
}


def normalize_lang(raw: str) -> str:
    s = (raw or "").strip()
    if s in ("zh-Hans", "zh-CN", "zh"):
        return "zh-CN"
    if s in ("en", "en-US", "en-GB"):
        return "en"
    if s in ("zh-Hant", "zh-TW", "zh-HK"):
        return "zh-Hant"
    return "zh-Hant"


async def synthesize_mp3(
    text: str,
    lang: str = "zh-Hant",
    voice: str = "",
    rate: str = "",
    pitch: str = "",
) -> bytes:
    if edge_tts is None:
        raise RuntimeError("edge_tts not installed")
    clean = (text or "").strip()
    if not clean:
        raise ValueError("empty text")
    if len(clean) > 480:
        clean = clean[:480]

    key = normalize_lang(lang)
    v, r, p = VOICE_BY_LANG.get(key, VOICE_BY_LANG["zh-Hant"])
    if voice:
        v = voice.strip()
    if rate:
        r = rate.strip()
    if pitch:
        p = pitch.strip()

    communicate = edge_tts.Communicate(clean, v, rate=r, pitch=p)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    data = buf.getvalue()
    if len(data) < 128:
        raise RuntimeError("empty tts output")
    return data
