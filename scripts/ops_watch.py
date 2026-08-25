# -*- coding: utf-8 -*-
"""VPS health alerts + daily ops digest to ADMIN_CHAT_ID.

Intended cron: `0 * * * *` (once per hour). Thresholds below still apply
at that cadence (e.g. live_feed older than 3 minutes when the hourly job runs).
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path("/root/quantsite") if Path("/root/quantsite").is_dir() else Path(__file__).resolve().parent.parent
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except Exception:
    pass

TW = timezone(timedelta(hours=8))
STATE_PATH = ROOT / "data" / "ops_watch_state.json"
BOT = (os.environ.get("TG_BOT_TOKEN") or "").strip()
ADMIN = (os.environ.get("ADMIN_CHAT_ID") or "").strip()
HUB_HEALTH = (os.environ.get("PUBLIC_BASE_URL") or "https://api.quantalpha.space").rstrip("/") + "/health"
SITE = "https://quantalpha.space"
ALERT_COOLDOWN = 25 * 60
FEED_STALE_SEC = 180
LB_STALE_SEC = 36 * 3600


def _now():
    return datetime.now(TW)


def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(st: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")


def tg(text: str) -> None:
    if not BOT or not ADMIN or not text:
        print("ops_watch skip tg")
        return
    url = "https://api.telegram.org/bot{0}/sendMessage".format(BOT)
    body = json.dumps(
        {"chat_id": ADMIN, "text": text, "disable_web_page_preview": True},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        resp.read()


def unit_active(name: str) -> bool:
    try:
        out = subprocess.check_output(["systemctl", "is-active", name], stderr=subprocess.DEVNULL, timeout=8)
        return out.decode("ascii", "replace").strip() == "active"
    except Exception:
        return False


def file_age(path: Path) -> float:
    try:
        return time.time() - path.stat().st_mtime
    except OSError:
        return 1e12


def http_ok(url: str) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "QuantOpsWatch/1"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            return 200 <= resp.status < 400
    except Exception:
        return False


def json_updated(path: Path) -> str:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return str(data.get("updated_at") or data.get("hygiene_at") or "")[:19]
    except Exception:
        return ""


def collect_issues() -> list[str]:
    issues = []
    if Path("/root/quantsite").is_dir():
        if not unit_active("tg-bot") and not unit_active("tg-bot.service"):
            issues.append("tg-bot.service 未運行")
        if not unit_active("quant-hub") and not unit_active("quant-hub.service"):
            issues.append("quant-hub.service 未運行")
    feed = Path("/var/www/html/live_feed.json")
    if not feed.is_file():
        feed = ROOT / "live_feed.json"
    age = file_age(feed)
    if age > FEED_STALE_SEC:
        issues.append("live_feed.json 已 {0:.0f} 秒未更新".format(age))
    if not http_ok(HUB_HEALTH):
        issues.append("Hub /health 無響應 ({0})".format(HUB_HEALTH))
    if not http_ok(SITE + "/"):
        issues.append("官網 https://quantalpha.space/ 無法訪問")
    lb = Path("/var/www/html/leaderboard.json")
    if not lb.is_file():
        lb = ROOT / "leaderboard.json"
    if file_age(lb) > LB_STALE_SEC:
        issues.append("leaderboard.json 超過 36 小時未刷新")
    return issues


def daily_text() -> str:
    feed = Path("/var/www/html/live_feed.json")
    if not feed.is_file():
        feed = ROOT / "live_feed.json"
    lb = Path("/var/www/html/leaderboard.json")
    if not lb.is_file():
        lb = ROOT / "leaderboard.json"
    stj = Path("/var/www/html/strategies.json")
    if not stj.is_file():
        stj = ROOT / "strategies.json"
    n_strat = 0
    try:
        n_strat = len(json.loads(stj.read_text(encoding="utf-8")).get("strategies") or [])
    except Exception:
        pass
    n_tape = 0
    try:
        n_tape = len(json.loads(feed.read_text(encoding="utf-8")).get("exec_log") or [])
    except Exception:
        pass
    now = _now().strftime("%Y-%m-%d %H:%M")
    return (
        "📊 QUANT.ALPHA 日報 {0} (UTC+8)\n"
        "· 官網 {1}\n"
        "· Hub {2}\n"
        "· tg-bot {3} · hub {4}\n"
        "· live_feed 延遲 {5:.0f}s · 成交帶 {6} 條\n"
        "· 廣場策略 {7} 條 · 更新 {8}\n"
        "· 排行榜年齡 {9:.1f}h · 更新 {10}\n"
        "· 歷史回測：每日 00:00 `calc_rankings --days 60 --full --hero-scan`（多周期择优）\n"
        "· AI 挖礦：02/08/14/20 點 pipeline"
    ).format(
        now,
        "OK" if http_ok(SITE + "/") else "FAIL",
        "OK" if http_ok(HUB_HEALTH) else "FAIL",
        "active" if unit_active("tg-bot") or unit_active("tg-bot.service") else "down",
        "active" if unit_active("quant-hub") or unit_active("quant-hub.service") else "down",
        file_age(feed),
        n_tape,
        n_strat,
        json_updated(stj) or "n/a",
        file_age(lb) / 3600.0,
        json_updated(lb) or "n/a",
    )


def main() -> int:
    st = load_state()
    now = time.time()
    issues = collect_issues()
    last_alert = float(st.get("last_alert_at") or 0)
    last_key = st.get("last_alert_key") or ""
    key = "|".join(issues)
    if issues and (key != last_key or now - last_alert > ALERT_COOLDOWN):
        tg("⚠️ VPS 告警\n" + "\n".join("· " + x for x in issues))
        st["last_alert_at"] = now
        st["last_alert_key"] = key
        print("alerted", key)
    elif not issues and last_key:
        tg("✅ VPS 已恢復正常")
        st["last_alert_key"] = ""
        st["last_alert_at"] = now
        print("recovered")
    local = _now()
    day = local.strftime("%Y-%m-%d")
    if local.hour == 8 and local.minute < 8 and st.get("daily_day") != day:
        tg(daily_text())
        st["daily_day"] = day
        print("daily sent", day)
    save_state(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
