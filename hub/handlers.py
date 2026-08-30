# -*- coding: utf-8 -*-
import json
import re
from pathlib import Path

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from hub.settings import ROOT, TG_BOT_USER, USDT_WALLET

WEB_OTP_RE = re.compile(r"^\d{4}$")
WEB_OTP_WORDS = frozenset({"BIND", "LOGIN", "OTP", "CODE", "WEB"})

LANE_WEB = "web_otp"
LANE_NONE = "none"


def classify_entry(text: str) -> str:
    """Exclusive bot entry lanes: web login OTP assist only."""
    raw = (text or "").strip()
    if not raw:
        return LANE_NONE
    first = raw.split(None, 1)[0]
    cmd = first.split("@")[0].upper()
    arg = raw.split(None, 1)[1].strip() if " " in raw.strip() else ""
    if cmd in ("/BIND", "BIND") or (cmd == "/START" and arg.upper() in WEB_OTP_WORDS):
        return LANE_WEB
    if cmd in ("/START", "/STARTBIND"):
        return classify_entry(arg) if arg else LANE_NONE
    if WEB_OTP_RE.match(raw) or raw.upper() in WEB_OTP_WORDS:
        return LANE_WEB
    return LANE_NONE


def menu_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("💳 升級解鎖高級權限", callback_data="buy_pro")],
            [InlineKeyboardButton("📈 獲取最新量化策略", callback_data="latest_ai")],
        ]
    )


def welcome_text() -> str:
    return (
        "歡迎來到 QUANT ALPHA 量化研究台。\n"
        "網站登入：官網右上角登入，或傳送 /bind 索取 4 位驗證碼，填回網站。\n"
        "4 位數字是網站登入碼。"
    )


def web_otp_text() -> str:
    return (
        "這是網站登入通道（4 位驗證碼）。\n"
        "請打開 https://quantalpha.space/ 點右上角登入，把 4 位碼填回網站。\n"
        "傳送 /bind 可向登入服務換發新碼。"
    )


async def reply(update: Update, text: str) -> None:
    if update.message:
        await update.message.reply_text(text, reply_markup=menu_markup())
    elif update.callback_query and update.callback_query.message:
        await update.callback_query.message.reply_text(text, reply_markup=menu_markup())


async def handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    payload = " ".join(context.args or []).strip()
    lane = classify_entry("/start " + payload if payload else "/start")
    if lane == LANE_WEB:
        await reply(update, web_otp_text())
        return
    await reply(update, welcome_text())


async def handle_bind(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    await reply(update, web_otp_text())


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return
    if update.message.text.startswith("/"):
        return
    lane = classify_entry(update.message.text)
    if lane == LANE_WEB:
        await reply(update, web_otp_text())
        return
    await reply(update, "無法識別。網站登入請傳 /bind 或把 4 位碼填回官網。")


def _latest_ai_text() -> str:
    paths = [Path("/var/www/html/strategies.json"), ROOT / "strategies.json"]
    for p in paths:
        if not p.is_file():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        rows = data.get("strategies") or []
        if not rows:
            continue
        s = rows[0]
        name = s.get("title") or s.get("name") or s.get("id") or "AI 策略"
        copy = s.get("copy") or s.get("description") or ""
        sh = s.get("sharpe") or (s.get("metrics") or {}).get("sharpe")
        ret = s.get("return_pct") or (s.get("metrics") or {}).get("return_pct")
        lines = ["📈 最新上架策略：{0}".format(name)]
        if sh is not None:
            lines.append("夏普：{0}".format(sh))
        if ret is not None:
            try:
                lines.append("收益率：{0:.1f}%".format(float(ret) * 100 if abs(float(ret)) <= 5 else float(ret)))
            except (TypeError, ValueError):
                pass
        if copy:
            lines.append(copy[:220])
        lines.append("官網策略廣場：https://quantalpha.space/strategies.html")
        return "\n".join(lines)
    return "目前還沒有新的 AI 策略上架，請稍後再試。"


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    if not q:
        return
    await q.answer()
    if q.data == "latest_ai":
        await q.message.reply_text(_latest_ai_text(), reply_markup=menu_markup())
        return
    if q.data == "buy_pro":
        wallet = USDT_WALLET or "（尚未設定 USDT_WALLET）"
        bot = TG_BOT_USER
        await q.message.reply_text(
            "💳 升級解鎖高級權限\n"
            "請使用 TRC20 USDT 轉帳至：\n`{0}`\n"
            "完成後把 TxHash 傳給 {1}，系統會回傳成交事件。".format(wallet, bot),
            parse_mode="Markdown",
            reply_markup=menu_markup(),
        )
