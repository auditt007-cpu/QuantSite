# -*- coding: utf-8 -*-
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from hub.settings import SQLITE_PATH

_LOCK = threading.Lock()


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def normalize_token(raw: str) -> str:
    s = (raw or "").strip().upper()
    s = s.replace("—", "-").replace("–", "-")
    if s.startswith("/START"):
        s = s.split(None, 1)[-1] if " " in s else ""
    s = s.replace("HTTPS://T.ME/", "").split("?", 1)[0]
    s = "".join(ch for ch in s if ch.isalnum())
    if s.startswith("VIP"):
        tail = "".join(ch for ch in s[3:] if ch.isalnum())
        if len(tail) >= 4:
            return "VIP{0}".format(tail[:4].upper())
    return ""


def start_payload(token: str) -> str:
    return normalize_token(token)


def connect() -> sqlite3.Connection:
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SQLITE_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_columns(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(leads)").fetchall()}
    if "client_ip" not in cols:
        conn.execute("ALTER TABLE leads ADD COLUMN client_ip TEXT")
    if "user_agent" not in cols:
        conn.execute("ALTER TABLE leads ADD COLUMN user_agent TEXT")


def init_db() -> None:
    with _LOCK:
        conn = connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS leads (
                    token TEXT PRIMARY KEY,
                    fbclid TEXT,
                    tg_uid TEXT,
                    tg_username TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    converted_at TEXT,
                    client_ip TEXT,
                    user_agent TEXT
                )
                """
            )
            _ensure_columns(conn)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_fbclid ON leads(fbclid)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_tg_uid ON leads(tg_uid)")
            conn.commit()
        finally:
            conn.close()


def upsert_lead(
    token: str,
    fbclid: str = "",
    *,
    client_ip: str = "",
    user_agent: str = "",
) -> dict[str, Any]:
    token = normalize_token(token)
    if not token:
        raise ValueError("empty token")
    now = _utc()
    ip = (client_ip or "").strip()[:64]
    ua = (user_agent or "").strip()[:512]
    with _LOCK:
        conn = connect()
        try:
            _ensure_columns(conn)
            row = conn.execute("SELECT * FROM leads WHERE token = ?", (token,)).fetchone()
            if row:
                sets = []
                args: list[Any] = []
                if fbclid and not (row["fbclid"] or "").strip():
                    sets.append("fbclid = ?")
                    args.append(fbclid)
                if ip and not (row["client_ip"] or "").strip():
                    sets.append("client_ip = ?")
                    args.append(ip)
                elif ip:
                    sets.append("client_ip = ?")
                    args.append(ip)
                if ua and not (row["user_agent"] or "").strip():
                    sets.append("user_agent = ?")
                    args.append(ua)
                elif ua:
                    sets.append("user_agent = ?")
                    args.append(ua)
                if sets:
                    args.append(token)
                    conn.execute("UPDATE leads SET {0} WHERE token = ?".format(", ".join(sets)), args)
                    conn.commit()
                return dict(conn.execute("SELECT * FROM leads WHERE token = ?", (token,)).fetchone())
            conn.execute(
                "INSERT INTO leads (token, fbclid, tg_uid, tg_username, status, created_at, converted_at, client_ip, user_agent) "
                "VALUES (?, ?, NULL, NULL, 'pending', ?, NULL, ?, ?)",
                (token, (fbclid or "").strip(), now, ip, ua),
            )
            conn.commit()
            return dict(conn.execute("SELECT * FROM leads WHERE token = ?", (token,)).fetchone())
        finally:
            conn.close()


def bind_telegram(token: str, tg_uid: str, tg_username: str) -> Optional[dict[str, Any]]:
    token = normalize_token(token)
    if not token:
        return None
    now = _utc()
    with _LOCK:
        conn = connect()
        try:
            _ensure_columns(conn)
            row = conn.execute("SELECT * FROM leads WHERE token = ?", (token,)).fetchone()
            if not row:
                conn.execute(
                    "INSERT INTO leads (token, fbclid, tg_uid, tg_username, status, created_at, converted_at, client_ip, user_agent) "
                    "VALUES (?, '', ?, ?, 'active', ?, NULL, '', '')",
                    (token, str(tg_uid), (tg_username or "").lstrip("@"), now),
                )
            else:
                status = row["status"] if row["status"] == "paid" else "active"
                conn.execute(
                    "UPDATE leads SET tg_uid = ?, tg_username = ?, status = ? WHERE token = ?",
                    (str(tg_uid), (tg_username or "").lstrip("@"), status, token),
                )
            conn.commit()
            return dict(conn.execute("SELECT * FROM leads WHERE token = ?", (token,)).fetchone())
        finally:
            conn.close()


def get_by_token(token: str) -> Optional[dict[str, Any]]:
    token = normalize_token(token)
    with _LOCK:
        conn = connect()
        try:
            _ensure_columns(conn)
            row = conn.execute("SELECT * FROM leads WHERE token = ?", (token,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


def find_lead(*, token: str = "", fbclid: str = "", tg_uid: str = "") -> Optional[dict[str, Any]]:
    token = normalize_token(token) if token else ""
    with _LOCK:
        conn = connect()
        try:
            _ensure_columns(conn)
            if token:
                row = conn.execute("SELECT * FROM leads WHERE token = ?", (token,)).fetchone()
                if row:
                    return dict(row)
            if tg_uid:
                row = conn.execute(
                    "SELECT * FROM leads WHERE tg_uid = ? ORDER BY created_at DESC LIMIT 1",
                    (str(tg_uid),),
                ).fetchone()
                if row:
                    return dict(row)
            if fbclid:
                row = conn.execute(
                    "SELECT * FROM leads WHERE fbclid = ? ORDER BY created_at DESC LIMIT 1",
                    (fbclid,),
                ).fetchone()
                if row:
                    return dict(row)
            return None
        finally:
            conn.close()


def mark_paid(token: str) -> Optional[dict[str, Any]]:
    token = normalize_token(token)
    now = _utc()
    with _LOCK:
        conn = connect()
        try:
            _ensure_columns(conn)
            conn.execute(
                "UPDATE leads SET status = 'paid', converted_at = ? WHERE token = ?",
                (now, token),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM leads WHERE token = ?", (token,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
