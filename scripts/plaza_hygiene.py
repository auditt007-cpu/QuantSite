# -*- coding: utf-8 -*-
"""Daily plaza cleanup: charts, titles, drop same-logic multi-coin clones."""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path("/root/quantsite") if Path("/root/quantsite").is_dir() else Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
JSON_CANDIDATES = [ROOT / "strategies.json"]
if os.name != "nt":
    JSON_CANDIDATES.insert(0, Path("/var/www/html/strategies.json"))
CHART_DIRS = [ROOT / "static" / "charts"]
if os.name != "nt":
    CHART_DIRS.insert(0, Path("/var/www/html/static/charts"))

# One card per method — alts with the same subtype are not distinct strategies.
METHOD_TITLES = {
    "DYNAMIC_ATR_GRID": "ATR 動態間距網格",
    "BASIS_FUNDING_GRID": "基差 / 資金費率對沖網格",
    "BOLLINGER_SQUEEZE_GRID": "布林擠壓高頻網格",
    "FIBO_DCA_GRID": "斐波那契 DCA 網格",
    "PAIRS_COINT_GRID": "協整配對套利網格",
}

TITLE_RULES = (
    (re.compile(r"grid|網格|atr_grid|fibo|basis|squeeze|pairs|coint", re.I), "AI 高頻網格研究"),
)

DEAD_BASES = frozenset({"FET"})


def _chart_exists(rel: str) -> bool:
    name = Path(str(rel or "")).name
    if not name:
        return False
    for d in CHART_DIRS:
        if (d / name).is_file():
            return True
    return False


def symbol_base(row: dict) -> str:
    raw = ""
    if isinstance(row.get("symbols"), list) and row["symbols"]:
        raw = str(row["symbols"][0])
    elif row.get("symbol"):
        raw = str(row["symbol"])
    else:
        title = str(row.get("title") or row.get("name") or "")
        m = re.match(r"^([A-Za-z0-9]+)\s*[·・.]", title)
        if m:
            raw = m.group(1)
    return re.sub(r"[^A-Za-z0-9]", "", raw).upper().replace("USDT", "") or ""


def method_key(row: dict) -> str:
    st = str(row.get("subtype") or "").upper().strip()
    if st in METHOD_TITLES:
        return st
    blob = " ".join(
        [
            str(row.get("strategy_type") or ""),
            st,
            str(row.get("id") or ""),
            str(row.get("engine") or ""),
            str(row.get("title") or row.get("name") or ""),
        ]
    ).upper()
    if "ATR" in blob and "GRID" in blob:
        return "DYNAMIC_ATR_GRID"
    if "BASIS" in blob or "FUNDING" in blob:
        return "BASIS_FUNDING_GRID"
    if "BOLL" in blob or "SQUEEZE" in blob or "擠壓" in blob or "挤压" in blob:
        return "BOLLINGER_SQUEEZE_GRID"
    if "FIBO" in blob or "DCA" in blob or "幾何" in blob or "几何" in blob:
        return "FIBO_DCA_GRID"
    if "PAIR" in blob or "COINT" in blob or "協整" in blob or "协整" in blob:
        return "PAIRS_COINT_GRID"
    if "GRID" in blob or "網格" in str(row.get("title") or "") or "网格" in str(row.get("title") or ""):
        return "GRID:" + re.sub(r"\s+", "", str(row.get("id") or row.get("engine") or "x")).lower()
    return "ID:" + str(row.get("id") or row.get("engine") or "")


def return_score(row: dict) -> float:
    m = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
    for key in ("return_pct",):
        try:
            v = float(row.get(key) if row.get(key) is not None else m.get(key))
            if abs(v) > 1.5:
                v = v / 100.0
            return v
        except (TypeError, ValueError):
            continue
    try:
        return float(m.get("backtest_apy_pct") or 0) / 1000.0
    except (TypeError, ValueError):
        return -999.0


def is_btc(row: dict) -> bool:
    return symbol_base(row) == "BTC"


def pick_winner(members: list[dict]) -> dict:
    """Prefer BTC book; else highest window return. Same method ≠ N coins."""
    btc = [r for r in members if is_btc(r)]
    pool = btc or members
    pool = sorted(pool, key=return_score, reverse=True)
    return pool[0]


def method_title(row: dict) -> str:
    key = method_key(row)
    if key in METHOD_TITLES:
        return METHOD_TITLES[key]
    title = str(row.get("title") or row.get("name") or "").strip()
    title = re.sub(r"^[A-Za-z0-9]+[\/_-]?USDT?\s*[·・.\-–—]\s*", "", title)
    title = re.sub(r"\s*V\d+(?:\.\d+)?\s*$", "", title).strip()
    if title and not re.match(r"^AI\s+ai_\d+$", title, re.I) and not re.match(r"^\d+$", title):
        return title
    return "AI 高頻網格研究"


def infer_title(row: dict) -> str:
    if str(row.get("status") or "").upper() == "INITIALIZING":
        title = str(row.get("title") or row.get("name") or "").strip()
        if title:
            return title
    titled = method_title(row)
    if titled:
        return titled
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


def retitle_to_btc(row: dict) -> None:
    """Method title; lock book to BTC. Drop alt price bands when forcing BTC."""
    key = method_key(row)
    title = METHOD_TITLES.get(key) or method_title(row)
    was_btc = is_btc(row)
    row["title"] = title
    row["name"] = title
    if key == "PAIRS_COINT_GRID":
        row["symbol"] = "ETH/BTC"
        row["symbols"] = ["ETHUSDT", "BTCUSDT"]
    else:
        row["symbol"] = "BTC/USDT"
        row["symbols"] = ["BTCUSDT"]
        if not was_btc:
            gp = row.get("grid_params")
            if isinstance(gp, dict):
                gp.pop("lower_price", None)
                gp.pop("upper_price", None)
    copy = str(row.get("copy") or "")
    copy = re.sub(r"^[A-Za-z0-9]+[\/_-]?USDT?\s*[·・]\s*", "", copy)
    if not copy or len(copy) < 12:
        copy = "{0} · BTCUSDT 方法樣本 · 同邏輯不跨幣種重複上架".format(title)
    row["copy"] = copy


def dedupe_methods(rows: list[dict]) -> tuple[list[dict], int]:
    buckets: dict[str, list[dict]] = {}
    order: list[str] = []
    for row in rows:
        key = method_key(row)
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(row)
    kept: list[dict] = []
    dropped = 0
    for key in order:
        members = buckets[key]
        win = pick_winner(members)
        dropped += len(members) - 1
        if key in METHOD_TITLES or key.startswith("GRID:"):
            retitle_to_btc(win)
        else:
            title = infer_title(win)
            win["title"] = title
            win["name"] = title
        kept.append(win)
    return kept, dropped


def main() -> int:
    payload, src = load_payload()
    kept: list[dict] = []
    dropped_bad = 0
    renamed = 0
    for row in payload.get("strategies") or []:
        if not isinstance(row, dict):
            continue
        base = symbol_base(row)
        if base in DEAD_BASES:
            dropped_bad += 1
            continue
        if row.get("listed") is False or row.get("listed") == "false":
            dropped_bad += 1
            continue
        st = str(row.get("status") or "").upper()
        if re.search(r"DELIST|OFFLINE|ARCHIVED|DISABLED|RETIRED|UNLIST", st):
            dropped_bad += 1
            continue
        rel = chart_rel(row)
        exists = _chart_exists(rel)
        sid = str(row.get("id") or "")
        is_ai = sid.startswith("ai_") or str(row.get("category") or "").upper().find("AI") >= 0
        if is_ai and not exists:
            dropped_bad += 1
            continue
        if rel and exists:
            row["chart"] = rel
            row["chart_url"] = rel
        elif is_ai:
            dropped_bad += 1
            continue
        copy = str(row.get("copy") or row.get("description") or "").strip()
        if is_ai and len(copy) < 40:
            dropped_bad += 1
            continue
        row["listed"] = True
        kept.append(row)

    kept, dropped_dup = dedupe_methods(kept)
    for row in kept:
        title = infer_title(row)
        if title != (row.get("title") or row.get("name")):
            renamed += 1
        row["title"] = title
        row["name"] = title

    payload["strategies"] = kept
    payload["hygiene_at"] = datetime.now(timezone.utc).isoformat()
    payload["hygiene_note"] = "one card per method; BTC book; multi-coin clones dropped"
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    written = []
    for p in JSON_CANDIDATES:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
            written.append(str(p))
        except OSError:
            continue
    print(
        "plaza_hygiene src={0} kept={1} dropped_bad={2} dropped_dup={3} renamed={4} wrote={5}".format(
            src, len(kept), dropped_bad, dropped_dup, renamed, written
        )
    )
    try:
        from utils import git_sync

        git_sync.sync_to_github(files_to_push=["strategies.json"], commit_msg="Auto: plaza hygiene")
    except Exception as exc:
        print("plaza_hygiene pages skip", exc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
