# -*- coding: utf-8 -*-
"""Daily plaza cleanup: human titles, drop fake-id names, require chart files."""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/root/quantsite") if Path("/root/quantsite").is_dir() else Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
JSON_CANDIDATES = [
    Path("/var/www/html/strategies.json"),
    ROOT / "strategies.json",
]
CHART_DIRS = [
    Path("/var/www/html/static/charts"),
    ROOT / "static" / "charts",
]

TITLE_RULES = (
    # Legacy directional titles retired — hygiene must not re-label grids as EMA/RSI.
    (re.compile(r"grid|網格|atr_grid|fibo|basis|squeeze|pairs|coint", re.I), "AI 高頻網格研究"),
)


def _chart_exists(rel: str) -> bool:
    name = Path(str(rel or "")).name
    if not name:
        return False
    for d in CHART_DIRS:
        if (d / name).is_file():
            return True
    return False


def infer_title(row: dict) -> str:
    if str(row.get("status") or "").upper() == "INITIALIZING":
        title = str(row.get("title") or row.get("name") or "").strip()
        if title:
            return title
    title = str(row.get("title") or row.get("name") or "").strip()
    if title and not re.match(r"^AI\s+ai_\d+$", title, re.I) and not re.match(r"^ai_\d+$", title, re.I):
        if not re.match(r"^\d+$", title):
            return title
    blob = " ".join(
        [
            str(row.get("copy") or ""),
            str(row.get("code") or "")[:800],
            str(row.get("engine") or ""),
            str(row.get("id") or ""),
            str(row.get("subtype") or ""),
            str(row.get("strategy_type") or ""),
        ]
    )
    for rx, name in TITLE_RULES:
        if rx.search(blob):
            return name
    sid = str(row.get("id") or "")[-6:]
    return "AI 高頻網格研究 {0}".format(sid)


def load_payload() -> tuple[dict, Path]:
    for p in JSON_CANDIDATES:
        if not p.is_file():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("strategies"), list):
                return data, p
        except (OSError, json.JSONDecodeError):
            continue
    return {"strategies": []}, JSON_CANDIDATES[-1]


def chart_rel(row: dict) -> str:
    raw = row.get("chart_url") or row.get("chart") or row.get("chart_svg") or ""
    name = Path(str(raw)).name
    sid = str(row.get("id") or "")
    if not name and sid:
        name = (sid if sid.endswith(".svg") else sid) + ("" if sid.endswith(".svg") else ".svg")
        if not name.startswith("ai_") and sid.startswith("ai_"):
            name = sid + ".svg"
    if name and not name.endswith(".svg"):
        name = name + ".svg"
    return "./static/charts/{0}".format(name) if name else ""


def main() -> int:
    payload, src = load_payload()
    kept = []
    dropped = 0
    renamed = 0
    for row in payload.get("strategies") or []:
        if not isinstance(row, dict):
            continue
        title = infer_title(row)
        if title != (row.get("title") or row.get("name")):
            renamed += 1
        row["title"] = title
        row["name"] = title
        rel = chart_rel(row)
        exists = _chart_exists(rel)
        sid = str(row.get("id") or "")
        is_ai = sid.startswith("ai_") or str(row.get("category") or "").upper().find("AI") >= 0
        if is_ai and not exists:
            dropped += 1
            continue
        if rel and exists:
            row["chart"] = rel
            row["chart_url"] = rel
        elif is_ai:
            dropped += 1
            continue
        copy = str(row.get("copy") or row.get("description") or "").strip()
        if is_ai and len(copy) < 40:
            dropped += 1
            continue
        row["listed"] = True
        kept.append(row)
    payload["strategies"] = kept
    payload["hygiene_at"] = datetime.now(timezone.utc).isoformat()
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    written = []
    for p in JSON_CANDIDATES:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
            written.append(str(p))
        except OSError:
            continue
    print("plaza_hygiene src={0} kept={1} dropped={2} renamed={3} wrote={4}".format(
        src, len(kept), dropped, renamed, written
    ))
    try:
        from utils import git_sync

        git_sync.sync_to_github(files_to_push=["strategies.json"], commit_msg="Auto: plaza hygiene")
    except Exception as exc:
        print("plaza_hygiene pages skip", exc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
