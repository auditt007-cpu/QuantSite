# -*- coding: utf-8 -*-
from typing import Optional

import httpx

from hub.settings import ADMIN_CHAT_ID, TG_BOT_TOKEN


async def send_message(chat_id: str, text: str, parse_mode: Optional[str] = None) -> None:
    if not TG_BOT_TOKEN or not chat_id:
        return
    payload = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    url = "https://api.telegram.org/bot{0}/sendMessage".format(TG_BOT_TOKEN)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, json=payload)
        if resp.status_code >= 400:
            raise RuntimeError("telegram send failed: {0} {1}".format(resp.status_code, resp.text[:400]))


async def notify_admin(text: str) -> None:
    if not ADMIN_CHAT_ID:
        return
    await send_message(ADMIN_CHAT_ID, text)


def notify_admin_sync(text: str) -> None:
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(notify_admin(text))
        return
    loop.create_task(notify_admin(text))
