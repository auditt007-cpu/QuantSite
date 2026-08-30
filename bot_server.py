# -*- coding: utf-8 -*-
"""FastAPI + python-telegram-bot: TG bot hub (login assist + payment flow)."""
from __future__ import annotations

import asyncio
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _ensure_deps() -> None:
    try:
        import dotenv  # noqa: F401
        import fastapi  # noqa: F401
        import telegram  # noqa: F401
        import httpx  # noqa: F401
    except ImportError:
        req = ROOT / "requirements.txt"
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req)])


_ensure_deps()

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, MessageHandler, filters

from hub.handlers import handle_bind, handle_callback, handle_start, handle_text
from hub.settings import HUB_HOST, HUB_PORT, PUBLIC_BASE_URL, TG_BOT_TOKEN
from hub.tts import normalize_lang, synthesize_mp3_ex

tg_app: Optional[Application] = None

CORS_ORIGINS = [
    "https://quantalpha.space",
    "https://www.quantalpha.space",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "null",  # some in-app webviews
]


class TtsBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=480)
    lang: str = "zh-Hant"
    voice: str = ""
    rate: str = ""
    pitch: str = ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    global tg_app
    if not TG_BOT_TOKEN:
        raise RuntimeError("TG_BOT_TOKEN missing in .env")
    tg_app = Application.builder().token(TG_BOT_TOKEN).build()
    tg_app.add_handler(CommandHandler("start", handle_start))
    tg_app.add_handler(CommandHandler("bind", handle_bind))
    tg_app.add_handler(CallbackQueryHandler(handle_callback))
    tg_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    await tg_app.initialize()
    await tg_app.start()
    if PUBLIC_BASE_URL:
        hook = PUBLIC_BASE_URL.rstrip("/") + "/tg/webhook"
        await tg_app.bot.set_webhook(url=hook, drop_pending_updates=False)
    else:
        await tg_app.bot.delete_webhook(drop_pending_updates=False)
        await tg_app.updater.start_polling(drop_pending_updates=False)
    try:
        yield
    finally:
        updater = getattr(tg_app, "updater", None)
        if updater is not None and getattr(updater, "running", False):
            await updater.stop()
        await tg_app.stop()
        await tg_app.shutdown()


app = FastAPI(title="QuantSite Telegram Hub", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"ok": "1"}


@app.options("/api/{full_path:path}")
async def api_options(full_path: str) -> Response:
    return Response(status_code=204)


@app.post("/api/tts/speak")
async def tts_speak(body: TtsBody) -> Response:
    """TTS MP3 POST: Edge primary → Edge alts → Google TTS backup."""
    return await _tts_response(body.text, body.lang, body.voice, body.rate, body.pitch)


@app.get("/api/tts/speak")
async def tts_speak_get(
    text: str = "",
    lang: str = "zh-Hant",
    voice: str = "",
    rate: str = "",
    pitch: str = "",
) -> Response:
    """TTS MP3 GET — for <audio src=\"...\"> (keeps autoplay unlock on media element)."""
    return await _tts_response(text, lang, voice, rate, pitch)


async def _tts_response(text: str, lang: str, voice: str, rate: str, pitch: str) -> Response:
    clean = (text or "").strip()
    if not clean:
        raise HTTPException(400, "empty text")
    if len(clean) > 480:
        clean = clean[:480]
    key = normalize_lang(lang)
    try:
        mp3, voice_used, source = await synthesize_mp3_ex(clean, key, voice, rate, pitch)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, "tts failed") from exc
    return Response(
        content=mp3,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=120",
            "X-TTS-Voice": voice_used,
            "X-TTS-Lang": key,
            "X-TTS-Source": source,
            "Access-Control-Expose-Headers": "X-TTS-Voice, X-TTS-Lang, X-TTS-Source",
        },
    )


@app.post("/tg/webhook")
async def telegram_webhook(request: Request) -> dict[str, str]:
    if tg_app is None:
        raise HTTPException(503, "bot not ready")
    data = await request.json()
    from telegram import Update

    update = Update.de_json(data, tg_app.bot)
    await tg_app.process_update(update)
    return {"ok": "1"}


def main() -> None:
    import uvicorn

    uvicorn.run("bot_server:app", host=HUB_HOST, port=HUB_PORT, reload=False)


if __name__ == "__main__":
    main()
