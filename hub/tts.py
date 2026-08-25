# -*- coding: utf-8 -*-
"""Live-room TTS: Edge primary + alternate Edge voices + Google TTS backup."""
from __future__ import annotations

import io
import logging
from typing import List, Tuple
from urllib.parse import quote

try:
    import edge_tts
except ImportError:  # pragma: no cover
    edge_tts = None

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

log = logging.getLogger("hub.tts")

# voice, rate, pitch — zh-CN/EN ~1.2× prior; zh-Hant 1.2× then −10% speed (+30%→+17%)
VOICE_BY_LANG: dict[str, Tuple[str, str, str]] = {
    "zh-CN": ("zh-CN-YunyangNeural", "+14%", "-8Hz"),
    "en": ("en-US-ChristopherNeural", "+16%", "-5Hz"),
    "zh-Hant": ("zh-TW-HsiaoChenNeural", "+17%", "+0Hz"),
}

# Same-lang Edge alternates when primary voice fails (male/female OK)
EDGE_ALTS: dict[str, List[Tuple[str, str, str]]] = {
    "zh-CN": [
        ("zh-CN-YunjianNeural", "+15%", "-5Hz"),
        ("zh-CN-YunxiNeural", "+18%", "+0Hz"),
        ("zh-CN-XiaoxiaoNeural", "+20%", "+0Hz"),
    ],
    "en": [
        ("en-US-GuyNeural", "+18%", "+0Hz"),
        ("en-US-EricNeural", "+16%", "-3Hz"),
        ("en-US-JennyNeural", "+20%", "+0Hz"),
    ],
    "zh-Hant": [
        ("zh-TW-YunJheNeural", "+14%", "+0Hz"),
        ("zh-TW-HsiaoYuNeural", "+17%", "+0Hz"),
    ],
}

GTTS_TL = {"zh-CN": "zh-CN", "en": "en", "zh-Hant": "zh-TW"}


def normalize_lang(raw: str) -> str:
    s = (raw or "").strip()
    if s in ("zh-Hans", "zh-CN", "zh"):
        return "zh-CN"
    if s in ("en", "en-US", "en-GB"):
        return "en"
    if s in ("zh-Hant", "zh-TW", "zh-HK"):
        return "zh-Hant"
    return "zh-Hant"


async def _edge_mp3(text: str, voice: str, rate: str, pitch: str) -> bytes:
    if edge_tts is None:
        raise RuntimeError("edge_tts not installed")
    communicate = edge_tts.Communicate(text, voice, rate=rate or "+0%", pitch=pitch or "+0Hz")
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    data = buf.getvalue()
    if len(data) < 128:
        raise RuntimeError("empty tts output")
    return data


def _gtts_chunks(text: str, limit: int = 160) -> List[str]:
    clean = text.strip()
    if len(clean) <= limit:
        return [clean]
    out: List[str] = []
    buf = ""
    for ch in clean:
        buf += ch
        if len(buf) >= limit and ch in "，。！？,.!?;；、 ":
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return out or [clean[:limit]]


async def _google_tts_mp3(text: str, lang: str) -> bytes:
    """Server-side Google Translate TTS (no API key). Backup when Edge is down."""
    if httpx is None:
        raise RuntimeError("httpx not installed")
    key = normalize_lang(lang)
    tl = GTTS_TL.get(key, "zh-CN")
    parts: List[bytes] = []
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Referer": "https://translate.google.com/",
    }
    async with httpx.AsyncClient(timeout=18.0, headers=headers, follow_redirects=True) as client:
        for i, chunk in enumerate(_gtts_chunks(text)):
            url = (
                "https://translate.google.com/translate_tts"
                f"?ie=UTF-8&client=tw-ob&tl={quote(tl)}&q={quote(chunk)}"
            )
            resp = await client.get(url)
            if resp.status_code != 200 or len(resp.content) < 128:
                raise RuntimeError(f"gtts_http_{resp.status_code}")
            parts.append(resp.content)
    data = b"".join(parts)
    if len(data) < 128:
        raise RuntimeError("empty gtts output")
    return data


async def synthesize_mp3(
    text: str,
    lang: str = "zh-Hant",
    voice: str = "",
    rate: str = "",
    pitch: str = "",
) -> bytes:
    """Back-compat: returns MP3 bytes only."""
    mp3, _, _ = await synthesize_mp3_ex(text, lang, voice, rate, pitch)
    return mp3


async def synthesize_mp3_ex(
    text: str,
    lang: str = "zh-Hant",
    voice: str = "",
    rate: str = "",
    pitch: str = "",
) -> Tuple[bytes, str, str]:
    """
    Returns (mp3_bytes, voice_or_source_id, source_tag).
    Cascade: primary Edge → alternate Edge → Google TTS.
    """
    clean = (text or "").strip()
    if not clean:
        raise ValueError("empty text")
    if len(clean) > 480:
        clean = clean[:480]

    key = normalize_lang(lang)
    v0, r0, p0 = VOICE_BY_LANG.get(key, VOICE_BY_LANG["zh-Hant"])
    primary = (voice.strip() or v0, (rate.strip() or r0), (pitch.strip() or p0))

    attempts: List[Tuple[str, str, str, str]] = [
        (primary[0], primary[1], primary[2], "edge"),
    ]
    for v, r, p in EDGE_ALTS.get(key, []):
        if v == primary[0]:
            continue
        attempts.append((v, r, p, "edge-alt"))

    last_err: Exception | None = None
    for v, r, p, src in attempts:
        try:
            data = await _edge_mp3(clean, v, r, p)
            return data, v, src
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            log.warning("edge tts failed voice=%s: %s", v, exc)

    try:
        data = await _google_tts_mp3(clean, key)
        return data, f"gtts:{GTTS_TL.get(key, 'zh-CN')}", "gtts"
    except Exception as exc:  # noqa: BLE001
        last_err = exc
        log.warning("gtts backup failed: %s", exc)

    if edge_tts is None and httpx is None:
        raise RuntimeError("no tts backend available")
    raise RuntimeError(f"tts failed: {last_err}")
