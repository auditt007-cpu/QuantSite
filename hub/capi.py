# -*- coding: utf-8 -*-
import hashlib
import time
import uuid
from typing import Any, Optional

import httpx

from hub.settings import META_CAPI_TOKEN, META_PIXEL_ID


def fbc_from_fbclid(fbclid: str, created_at_unix: Optional[int] = None) -> str:
    ts = int(created_at_unix or time.time())
    return "fb.1.{0}.{1}".format(ts, fbclid)


async def send_purchase(
    *,
    fbclid: str,
    value: float,
    currency: str = "USD",
    event_id: str = "",
    event_source_url: str = "",
    client_ip_address: str = "",
    client_user_agent: str = "",
) -> dict[str, Any]:
    if not META_PIXEL_ID or not META_CAPI_TOKEN:
        raise RuntimeError("META_PIXEL_ID / META_CAPI_TOKEN missing")
    if not fbclid:
        raise RuntimeError("fbclid missing; cannot attribute Purchase")
    eid = event_id or str(uuid.uuid4())
    user_data: dict[str, Any] = {
        "fbc": fbc_from_fbclid(fbclid),
        "external_id": hashlib.sha256(fbclid.encode("utf-8")).hexdigest(),
    }
    ip = (client_ip_address or "").strip()
    ua = (client_user_agent or "").strip()
    if ip:
        user_data["client_ip_address"] = ip
    if ua:
        user_data["client_user_agent"] = ua
    payload = {
        "data": [
            {
                "event_name": "Purchase",
                "event_time": int(time.time()),
                "event_id": eid,
                "action_source": "website",
                "event_source_url": event_source_url or "https://quantalpha.space/",
                "user_data": user_data,
                "custom_data": {
                    "currency": (currency or "USD").upper(),
                    "value": float(value),
                    "content_type": "product",
                },
            }
        ]
    }
    url = "https://graph.facebook.com/v21.0/{0}/events".format(META_PIXEL_ID)
    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.post(url, params={"access_token": META_CAPI_TOKEN}, json=payload)
        body = resp.json() if resp.content else {}
        if resp.status_code >= 400:
            raise RuntimeError("CAPI {0}: {1}".format(resp.status_code, body))
        return {"event_id": eid, "graph": body, "emq_fields": {"ip": bool(ip), "ua": bool(ua)}}


async def send_event(
    *,
    event_name: str,
    fbclid: str = "",
    event_id: str = "",
    event_source_url: str = "",
    client_ip_address: str = "",
    client_user_agent: str = "",
    custom_data: Optional[dict] = None,
) -> dict[str, Any]:
    """PageView / ViewContent / Lead only — never Purchase on page load."""
    name = (event_name or "").strip()
    if name not in ("PageView", "ViewContent", "Lead"):
        raise RuntimeError("unsupported event_name")
    if not META_PIXEL_ID or not META_CAPI_TOKEN:
        return {"skipped": True, "reason": "pixel_or_token_missing"}
    eid = event_id or str(uuid.uuid4())
    user_data: dict[str, Any] = {}
    if fbclid:
        user_data["fbc"] = fbc_from_fbclid(fbclid)
        user_data["external_id"] = hashlib.sha256(fbclid.encode("utf-8")).hexdigest()
    ip = (client_ip_address or "").strip()
    ua = (client_user_agent or "").strip()
    if ip:
        user_data["client_ip_address"] = ip
    if ua:
        user_data["client_user_agent"] = ua
    payload = {
        "data": [
            {
                "event_name": name,
                "event_time": int(time.time()),
                "event_id": eid,
                "action_source": "website",
                "event_source_url": event_source_url or "https://quantalpha.space/",
                "user_data": user_data,
                "custom_data": custom_data or {},
            }
        ]
    }
    url = "https://graph.facebook.com/v21.0/{0}/events".format(META_PIXEL_ID)
    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.post(url, params={"access_token": META_CAPI_TOKEN}, json=payload)
        body = resp.json() if resp.content else {}
        if resp.status_code >= 400:
            raise RuntimeError("CAPI {0}: {1}".format(resp.status_code, body))
        return {"event_id": eid, "graph": body}
