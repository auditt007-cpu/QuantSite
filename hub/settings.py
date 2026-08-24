# -*- coding: utf-8 -*-
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _s(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def _i(key: str, default: int) -> int:
    raw = _s(key)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


TG_BOT_TOKEN = _s("TG_BOT_TOKEN")
ADMIN_CHAT_ID = _s("ADMIN_CHAT_ID")
META_CAPI_TOKEN = _s("META_CAPI_TOKEN")
META_PIXEL_ID = _s("META_PIXEL_ID")
DEEPSEEK_API_KEY = _s("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = _s("DEEPSEEK_BASE_URL") or (
    "https://openrouter.ai/api/v1" if DEEPSEEK_API_KEY.startswith("sk-or-") else "https://api.deepseek.com"
)
DEEPSEEK_MODEL = _s("DEEPSEEK_MODEL") or (
    "deepseek/deepseek-chat" if "openrouter.ai" in DEEPSEEK_BASE_URL else "deepseek-chat"
)
HUB_HOST = _s("HUB_HOST") or "0.0.0.0"
HUB_PORT = _i("HUB_PORT", 8088)
PUBLIC_BASE_URL = _s("PUBLIC_BASE_URL").rstrip("/")
WEBHOOK_SECRET = _s("WEBHOOK_SECRET")
USDT_WALLET = _s("USDT_WALLET")
TG_BOT_USER = _s("TG_BOT_USER") or "@grid_quant_bot"


def _path(raw: str, local: Path) -> Path:
    raw = (raw or "").strip()
    if os.name == "nt":
        unixish = raw.replace("\\", "/")
        if not raw or unixish.startswith("/"):
            return local
        p = Path(raw)
        return p if p.is_absolute() else ROOT / p
    p = Path(raw) if raw else local
    return p if p.is_absolute() else ROOT / p


SQLITE_PATH = _path(_s("SQLITE_PATH"), ROOT / "data" / "leads.db")
CHARTS_DIR = _path(_s("CHARTS_DIR"), ROOT / "static" / "charts")
STRATEGIES_JSON = _path(_s("STRATEGIES_JSON"), ROOT / "strategies.json")
