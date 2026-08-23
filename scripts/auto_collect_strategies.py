#!/usr/bin/env python3
"""Merge open-source / local strategy packs into js/strategies_data.json."""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    requests = None

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "js" / "strategies_data.json"
LOCAL_FEEDS = [
    ROOT / "gemini-code-1787470320177.json",
    ROOT / "js" / "strategies_data.json",
]
REQUIRED = ("id", "name", "source_code")


def load_json(path: Path):
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"skip {path}: {exc}", file=sys.stderr)
        return []
    return data if isinstance(data, list) else []


def pct_num(raw) -> float | None:
    if raw is None:
        return None
    m = re.search(r"[-+]?\d+(?:\.\d+)?", str(raw))
    return float(m.group(0)) if m else None


def normalize(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    sid = str(row.get("id") or "").strip()
    name = str(row.get("name") or "").strip()
    code = str(row.get("source_code") or row.get("code") or "").strip()
    if not sid or not name or not code:
        return None
    metrics = dict(row.get("metrics") or {})
    opt = metrics.get("optimal_return") or metrics.get("best_return") or row.get("optimal_return")
    if opt and not metrics.get("week_return"):
        n = pct_num(opt)
        if n is not None:
            sign = "+" if n >= 0 else ""
            metrics["week_return"] = f"{sign}{n:.1f}%"
    if opt and not metrics.get("optimal_return"):
        metrics["optimal_return"] = str(opt)
    out = {
        "id": sid,
        "name": name,
        "category": row.get("category") or "trend",
        "is_vip": bool(row.get("is_vip")),
        "release_date": row.get("release_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "metrics": metrics,
        "description": row.get("description") or row.get("principle") or "",
        "source_code": code,
        "principle": row.get("principle") or "",
    }
    return out


def fetch_remote() -> list:
    url = os.environ.get("STRATEGY_FEED_URL", "").strip()
    if not url or requests is None:
        return []
    try:
        res = requests.get(url, timeout=30)
        res.raise_for_status()
        data = res.json()
        return data if isinstance(data, list) else []
    except Exception as exc:
        print(f"remote feed skipped: {exc}", file=sys.stderr)
        return []


def merge(rows: list[dict]) -> list[dict]:
    by_id: dict[str, dict] = {}
    for row in rows:
        item = normalize(row)
        if not item:
            continue
        prev = by_id.get(item["id"])
        if prev and len(str(prev.get("source_code") or "")) >= len(item["source_code"]):
            if item.get("metrics") and not prev.get("metrics"):
                prev["metrics"] = item["metrics"]
            continue
        by_id[item["id"]] = item
    return sorted(by_id.values(), key=lambda r: r["id"])


def main() -> int:
    bucket: list[dict] = []
    for path in LOCAL_FEEDS:
        bucket.extend(load_json(path))
    bucket.extend(fetch_remote())
    merged = merge(bucket)
    if not merged:
        print("no strategies collected", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(merged, ensure_ascii=False, indent=2) + "\n"
    prev = OUT.read_text(encoding="utf-8") if OUT.is_file() else ""
    if prev == text:
        print(f"unchanged ({len(merged)} strategies)")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT} ({len(merged)} strategies)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
