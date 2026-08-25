# -*- coding: utf-8 -*-
"""FastAPI + python-telegram-bot: lead bind, TG bot, Meta CAPI purchase webhook."""
from __future__ import annotations

import asyncio
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

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

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, MessageHandler, filters

from hub import capi, db
from hub.handlers import handle_bind, handle_callback, handle_start, handle_text
from hub.notify import notify_admin
from hub.settings import HUB_HOST, HUB_PORT, PUBLIC_BASE_URL, TG_BOT_TOKEN, WEBHOOK_SECRET
from hub.tts import normalize_lang, synthesize_mp3

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


class BindBody(BaseModel):
    token: str = Field(..., min_length=4, max_length=32)
    fbclid: str = ""
    user_agent: str = ""


class PurchaseBody(BaseModel):
    token: str = ""
    fbclid: str = ""
    tg_uid: str = ""
    amount: float = Field(..., gt=0)
    currency: str = "USD"
    event_source_url: str = ""


def client_ip(request: Request) -> str:
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if xff:
        return xff
    real = (request.headers.get("x-real-ip") or "").strip()
    if real:
        return real
    if request.client and request.client.host:
        return request.client.host
    return ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    global tg_app
    db.init_db()
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


app = FastAPI(title="QuantSite Attribution Hub", lifespan=lifespan)
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


@app.post("/api/leads/bind")
async def bind_lead(body: BindBody, request: Request) -> dict[str, Any]:
    token = db.normalize_token(body.token)
    if not (token.startswith("VIP") and len(token) == 7):
        raise HTTPException(400, "token must look like VIP8921")
    ua = (body.user_agent or request.headers.get("user-agent") or "").strip()
    ip = client_ip(request)
    lead = db.upsert_lead(token, body.fbclid or "", client_ip=ip, user_agent=ua)
    return {
        "ok": True,
        "token": lead["token"],
        "start": db.start_payload(lead["token"]),
        "fingerprint": {"ip": bool(lead.get("client_ip")), "ua": bool(lead.get("user_agent"))},
    }


class CapiEventBody(BaseModel):
    event_name: str
    fbclid: str = ""
    event_source_url: str = ""
    user_agent: str = ""
    content_name: str = ""
    content_category: str = ""


class TtsBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=480)
    lang: str = "zh-Hant"
    voice: str = ""
    rate: str = ""
    pitch: str = ""


@app.post("/api/tts/speak")
async def tts_speak(body: TtsBody) -> Response:
    """Edge-TTS MP3 for live-room persona voices (zh-CN male / en male / zh-TW)."""
    lang = normalize_lang(body.lang)
    try:
        mp3 = await synthesize_mp3(body.text, lang, body.voice, body.rate, body.pitch)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, "tts failed") from exc
    return Response(content=mp3, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=3600"})


@app.post("/api/capi/event")
async def capi_event(body: CapiEventBody, request: Request) -> dict[str, Any]:
    """Organic events only. Lead must come from explicit subscribe CTA (client enforces)."""
    name = (body.event_name or "").strip()
    if name not in ("PageView", "ViewContent", "Lead"):
        raise HTTPException(400, "unsupported event")
    ua = (body.user_agent or request.headers.get("user-agent") or "").strip()
    ip = client_ip(request)
    custom = {}
    if body.content_name:
        custom["content_name"] = body.content_name
    if body.content_category:
        custom["content_category"] = body.content_category
    try:
        graph = await capi.send_event(
            event_name=name,
            fbclid=(body.fbclid or "").strip(),
            event_source_url=body.event_source_url or "https://quantalpha.space/",
            client_ip_address=ip,
            client_user_agent=ua,
            custom_data=custom or None,
        )
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"ok": True, "capi": graph}


@app.post("/api/webhook/purchase")
async def purchase_webhook(
    body: PurchaseBody,
    request: Request,
    x_webhook_secret: str = Header(default=""),
) -> JSONResponse:
    if WEBHOOK_SECRET and x_webhook_secret != WEBHOOK_SECRET:
        raise HTTPException(401, "bad webhook secret")
    lead = db.find_lead(token=body.token, fbclid=body.fbclid, tg_uid=body.tg_uid)
    if not lead:
        raise HTTPException(404, "lead not found")
    fbclid = (lead.get("fbclid") or body.fbclid or "").strip()
    if not fbclid:
        raise HTTPException(409, "lead has no fbclid")
    ip = (lead.get("client_ip") or client_ip(request) or "").strip()
    ua = (lead.get("user_agent") or request.headers.get("user-agent") or "").strip()
    capi_task = asyncio.create_task(
        capi.send_purchase(
            fbclid=fbclid,
            value=float(body.amount),
            currency=body.currency,
            event_source_url=body.event_source_url or "https://quantalpha.space/",
            client_ip_address=ip,
            client_user_agent=ua,
        )
    )
    paid = db.mark_paid(lead["token"])
    graph = await capi_task
    amount_txt = "{0:.2f}".format(float(body.amount))
    await notify_admin("🔥 [成交上报] 成功通过 CAPI 回传 Purchase！金额: ${0}".format(amount_txt))
    return JSONResponse({"ok": True, "lead": paid, "capi": graph})


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
