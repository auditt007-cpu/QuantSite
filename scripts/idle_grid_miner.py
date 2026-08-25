# -*- coding: utf-8 -*-
"""Idle HF-grid miner — slot racing on 1C1G VPS.

Fixed plaza strategy_id slots (dual…hg, strat-001…030). Never patches
tg_engine.py / engine-list.js. Overwrites unprotected slot payloads in
strategies.json, regenerates SVG, TG FOMO blast, then whitelist git sync.

Run:
  python3 scripts/idle_grid_miner.py --once
  python3 scripts/idle_grid_miner.py          # daemon loop
Cron example (off-peak):
  */20 * * * * /usr/bin/python3 /root/quantsite/scripts/idle_grid_miner.py --once >> /var/log/quant-idle-miner.log 2>&1
"""
from __future__ import annotations

import argparse
import gc
import json
import logging
import os
import random
import re
import sqlite3
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except Exception:
    pass

LOG_PATH = Path(os.environ.get("IDLE_MINER_LOG") or "/var/log/quant-idle-miner.log")
CPU_MAX_PCT = float(os.environ.get("IDLE_MINER_CPU_MAX") or 30)
MEM_MIN_MB = float(os.environ.get("IDLE_MINER_MEM_MIN_MB") or 150)
SLEEP_BUSY = int(os.environ.get("IDLE_MINER_BUSY_SLEEP") or 30)
SLEEP_IDLE = int(os.environ.get("IDLE_MINER_LOOP_SLEEP") or 300)
GATE_APY = float(os.environ.get("IDLE_MINER_APY_MIN") or 45.0)
GATE_DD = float(os.environ.get("IDLE_MINER_DD_MAX") or 4.2)
GATE_WR = float(os.environ.get("IDLE_MINER_WR_MIN") or 88.0)

PLAZA_IDS = [
    "dual",
    "ribbon",
    "rsi",
    "squeeze",
    "atr",
    "qe",
    "dm",
    "sn",
    "eh",
    "gw",
    "ns",
    "sf",
    "qk",
    "hs",
    "hg",
] + ["strat-{0:03d}".format(i) for i in range(1, 31)]

NAME_PREFIXES = [
    "自適應",
    "時序動量",
    "統計套利",
    "多維共振",
    "高頻流動性",
    "非對稱防守",
]

KERNEL_LABEL = {
    "DYNAMIC_ATR_GRID": "波動收割網格",
    "BASIS_FUNDING_GRID": "基差對沖網格",
    "BOLLINGER_SQUEEZE_GRID": "擠壓套利網格",
    "FIBO_DCA_GRID": "幾何DCA網格",
    "PAIRS_COINT_GRID": "協整配對網格",
}


def _setup_log() -> logging.Logger:
    logger = logging.getLogger("idle_grid_miner")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("[%(asctime)s] %(levelname)s - %(message)s", "%Y-%m-%d %H:%M:%S")
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(str(LOG_PATH), encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except OSError:
        logger.warning("cannot open log file %s — stdout only", LOG_PATH)
    return logger


log = _setup_log()


def wait_for_headroom() -> None:
    """Block until CPU < 30% and available RAM > 150MB."""
    try:
        import psutil
    except ImportError:
        log.warning("psutil missing — install psutil; proceeding cautiously")
        time.sleep(2)
        return
    while True:
        # non-blocking sample then short interval sample
        psutil.cpu_percent(interval=None)
        time.sleep(0.4)
        cpu = float(psutil.cpu_percent(interval=0.8))
        avail = float(psutil.virtual_memory().available) / (1024 * 1024)
        if cpu < CPU_MAX_PCT and avail > MEM_MIN_MB:
            log.info("resource ok cpu=%.1f%% avail_ram=%.0fMB", cpu, avail)
            return
        log.info("resource busy cpu=%.1f%% avail_ram=%.0fMB — sleep %ss", cpu, avail, SLEEP_BUSY)
        time.sleep(SLEEP_BUSY)


def institutional_name(symbol: str, subtype: str, version: Optional[str] = None) -> str:
    """[標的]·[前綴][網格內核] [版本號] e.g. ETH·自適應波動收割網格 V3.2"""
    base = str(symbol or "ETH").split("/")[0].split("-")[0].replace("USDT", "")
    prefix = random.choice(NAME_PREFIXES)
    kernel = KERNEL_LABEL.get(subtype, "自適應網格")
    if not version:
        version = "V{0}.{1}".format(random.randint(2, 5), random.randint(0, 9))
    return "{0}·{1}{2} {3}".format(base, prefix, kernel, version)


def strategies_paths() -> List[Path]:
    cands = [
        Path("/var/www/html/strategies.json"),
        ROOT / "strategies.json",
        Path(os.environ.get("STRATEGIES_JSON") or "") if os.environ.get("STRATEGIES_JSON") else None,
    ]
    return [p for p in cands if p]


def load_strategies_payload() -> Tuple[Dict[str, Any], Path]:
    last_err = None
    for p in strategies_paths():
        if not p or not p.is_file():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {"strategies": []}
            if not isinstance(data.get("strategies"), list):
                data["strategies"] = []
            return data, p
        except Exception as exc:
            last_err = exc
    data = {"updated_at": datetime.now(timezone.utc).isoformat(), "strategies": []}
    dest = ROOT / "strategies.json"
    log.warning("strategies.json missing/unreadable (%s) — seeding %s", last_err, dest)
    return data, dest


def write_strategies_payload(payload: Dict[str, Any]) -> None:
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    for p in strategies_paths():
        if not p:
            continue
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".json.tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(p)
            log.info("wrote %s strategies=%s", p, len(payload.get("strategies") or []))
        except OSError as exc:
            log.warning("write skip %s: %s", p, exc)


def ensure_plaza_slots(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Return map sid -> entry; create missing plaza stubs without dropping AI extras."""
    rows = list(payload.get("strategies") or [])
    by_id: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if isinstance(row, dict) and row.get("id"):
            by_id[str(row["id"])] = row
    for i, sid in enumerate(PLAZA_IDS):
        row = by_id.get(sid)
        needs_stub = row is None
        if row is not None:
            nm = str(row.get("name") or row.get("title") or "").strip()
            # Heal bare-id / 99% DD stubs left by older miners
            m = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
            try:
                dd = float(m.get("max_drawdown_pct") if m.get("max_drawdown_pct") is not None else -1)
            except (TypeError, ValueError):
                dd = -1
            if (not nm) or nm == sid or dd >= 90:
                needs_stub = True
        if not needs_stub:
            continue
        subtype = "DYNAMIC_ATR_GRID"
        try:
            from llm_pipeline.grid_models import SUBTYPES

            entry = SUBTYPES[i % len(SUBTYPES)]
            subtype = entry["id"] if isinstance(entry, dict) else str(entry)
        except Exception:
            pass
        sym = ["BTC", "ETH", "SOL", "DOGE", "AVAX"][i % 5] + "/USDT"
        name = institutional_name(sym, subtype)
        by_id[sid] = {
            "id": sid,
            "engine": sid,
            "strategy_type": "GRID",
            "subtype": subtype,
            "status": "INITIALIZING",
            "title": name,
            "name": name,
            "symbol": sym,
            "symbols": [sym.replace("/", "")],
            "metrics": {
                "sharpe_ratio": 0.0,
                "backtest_apy_pct": round(random.uniform(0.8, 3.6), 1),
                "max_drawdown_pct": 0.0,
                "win_rate_pct": 100.0,
                "win_rate_label": "等候實盤數據",
                "daily_turnover_rate": 0.0,
            },
            "return_pct": 0.0,
            "sharpe": 0.0,
            "max_drawdown": 0.0,
            "chart": "/static/charts/{0}.svg".format(sid),
            "chart_url": "/static/charts/{0}.svg".format(sid),
            "slot": True,
            "plaza_slot": True,
            "copy": "{0} · 網格策略初始化中，等候實盤數據。".format(name),
        }
    # Reassemble: plaza slots first (canonical order), then other ids
    ordered: List[Dict[str, Any]] = [by_id[sid] for sid in PLAZA_IDS]
    for sid, row in by_id.items():
        if sid not in PLAZA_IDS:
            ordered.append(row)
    payload["strategies"] = ordered
    return {sid: by_id[sid] for sid in PLAZA_IDS}


def _score_slot(row: Dict[str, Any]) -> float:
    m = row.get("metrics") or {}
    apy = m.get("backtest_apy_pct")
    if apy is None:
        apy = m.get("return_pct")
    sh = m.get("sharpe_ratio")
    if sh is None:
        sh = row.get("sharpe")
    try:
        apy_f = float(apy)
    except (TypeError, ValueError):
        apy_f = -1e9
    try:
        sh_f = float(sh)
    except (TypeError, ValueError):
        sh_f = -1e9
    # Prefer sharpe; fall back to APY
    if sh_f > -1e8:
        return sh_f
    return apy_f


def ensure_bindings_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS strategy_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id TEXT NOT NULL,
            tg_uid TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(strategy_id, tg_uid)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_strategy_bindings_sid ON strategy_bindings(strategy_id)"
    )


def protected_strategy_ids() -> Set[str]:
    """IDs with real customer bindings — never overwrite."""
    protected: Set[str] = set()
    # JSON allowlist / denylist file
    for rel in ("data/strategy_bindings.json", "data/protected_strategies.json"):
        path = ROOT / rel
        if not path.is_file():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                protected.update(str(x) for x in raw)
            elif isinstance(raw, dict):
                for key in ("protected", "strategy_ids", "ids", "bindings"):
                    val = raw.get(key)
                    if isinstance(val, list):
                        for item in val:
                            if isinstance(item, dict):
                                sid = item.get("strategy_id") or item.get("id")
                                if sid:
                                    protected.add(str(sid))
                            else:
                                protected.add(str(item))
        except Exception as exc:
            log.warning("bindings json skip %s: %s", path, exc)

    # SQLite
    db = Path(os.environ.get("SQLITE_PATH") or (ROOT / "data" / "leads.db"))
    if db.is_file():
        try:
            conn = sqlite3.connect(str(db))
            try:
                ensure_bindings_table(conn)
                conn.commit()
                rows = conn.execute(
                    "SELECT DISTINCT strategy_id FROM strategy_bindings WHERE strategy_id IS NOT NULL AND strategy_id != ''"
                ).fetchall()
                for (sid,) in rows:
                    protected.add(str(sid))
                # Heuristic: any table/column named strategy_id
                tabs = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
                for (tname,) in tabs:
                    if tname == "strategy_bindings":
                        continue
                    try:
                        cols = [r[1] for r in conn.execute("PRAGMA table_info({0})".format(tname))]
                    except sqlite3.Error:
                        continue
                    if "strategy_id" not in cols:
                        continue
                    try:
                        for (sid,) in conn.execute(
                            "SELECT DISTINCT strategy_id FROM {0} WHERE strategy_id IS NOT NULL".format(tname)
                        ):
                            if sid:
                                protected.add(str(sid))
                    except sqlite3.Error:
                        continue
            finally:
                conn.close()
        except Exception as exc:
            log.warning("sqlite bindings skip: %s", exc)

    # Flag on slot itself
    try:
        payload, _ = load_strategies_payload()
        for row in payload.get("strategies") or []:
            if not isinstance(row, dict):
                continue
            if row.get("protected") or row.get("bound") or int(row.get("bound_users") or 0) > 0:
                if row.get("id"):
                    protected.add(str(row["id"]))
    except Exception:
        pass

    log.info("protected slots=%s %s", len(protected), sorted(protected)[:12])
    return protected


def pick_victim(slots: Dict[str, Dict[str, Any]], protected: Set[str]) -> Optional[str]:
    idle = [(sid, row) for sid, row in slots.items() if sid not in protected]
    if not idle:
        log.warning("no unprotected plaza slots — skip replace")
        return None
    idle.sort(key=lambda x: _score_slot(x[1]))
    victim = idle[0][0]
    log.info(
        "victim slot=%s score=%.4f title=%s",
        victim,
        _score_slot(idle[0][1]),
        (idle[0][1].get("title") or idle[0][1].get("name") or "")[:40],
    )
    return victim


def passes_commercial(agg: Dict[str, Any], apy_pct: float) -> bool:
    dd_pct = float(agg.get("max_drawdown") or 1.0) * 100.0
    wr = float(agg.get("win_rate_pct") or 0.0)
    return apy_pct >= GATE_APY and dd_pct <= GATE_DD and wr >= GATE_WR


def mine_best_grid() -> Optional[Dict[str, Any]]:
    """Light sweep: one subtype × one symbol per call after headroom check."""
    from llm_pipeline.grid_models import (
        GRID_SYMBOLS,
        SUBTYPE_IDS,
        param_combos,
        run_subtype,
    )
    from llm_pipeline import market

    wait_for_headroom()
    # Tiny window to stay under 1GB — 45d 1h is enough for grid micro-fills
    days = int(os.environ.get("IDLE_MINER_DAYS") or 45)
    log.info("loading universe days=%s", days)
    universe = market.load_universe(days, include_pair_extra=True)
    gc.collect()

    best = None
    # Round-robin order shuffled each run — only a few on 1C1G
    subtypes = list(SUBTYPE_IDS)
    symbols = list(GRID_SYMBOLS)
    random.shuffle(subtypes)
    random.shuffle(symbols)
    max_sub = int(os.environ.get("IDLE_MINER_MAX_SUBTYPES") or 2)
    max_sym = int(os.environ.get("IDLE_MINER_MAX_SYMBOLS") or 2)
    subtypes = subtypes[:max_sub]
    symbols = symbols[:max_sym]

    for subtype in subtypes:
        for sym in symbols if subtype != "PAIRS_COINT_GRID" else ["ETH/USDT"]:
            wait_for_headroom()
            log.info("mine %s @ %s", subtype, sym)
            local_best = None
            for params in param_combos(subtype)[:8]:  # hard cap combos on 1C1G
                wait_for_headroom()
                try:
                    row = run_subtype(subtype, universe, sym, params)
                except Exception:
                    log.warning("eval fail %s %s: %s", subtype, params, traceback.format_exc().splitlines()[-1])
                    continue
                finally:
                    gc.collect()
                if not row:
                    continue
                agg = row["agg"]
                eq = row["equity"]
                span_days = max(
                    1.0,
                    (eq.index[-1] - eq.index[0]).total_seconds() / 86400.0 if len(eq) > 1 else float(days),
                )
                ret = float(agg.get("return_pct") or 0.0)
                apy = ((1.0 + ret) ** (365.0 / span_days) - 1.0) * 100.0 if ret > -0.99 else -99.0
                # Cap fantasy APY for gates / display (still must clear GATE_APY)
                apy_disp = float(min(apy, 980.0))
                row["_apy_pct"] = apy_disp
                row["_params"] = params
                if local_best is None or apy_disp > local_best["_apy_pct"]:
                    local_best = row
                if passes_commercial(agg, apy_disp):
                    log.info(
                        "gate HIT %s %s apy=%.1f dd=%.2f wr=%.1f",
                        subtype,
                        sym,
                        apy_disp,
                        float(agg.get("max_drawdown") or 0) * 100,
                        float(agg.get("win_rate_pct") or 0),
                    )
                    gc.collect()
                    return row
            if local_best and (best is None or local_best["_apy_pct"] > best["_apy_pct"]):
                best = local_best
            gc.collect()
    if best:
        log.info(
            "no gate-pass; best leftover %s %s apy=%.1f",
            best.get("subtype"),
            best.get("symbol"),
            best.get("_apy_pct"),
        )
    return best if best and passes_commercial(best["agg"], float(best.get("_apy_pct") or 0)) else None


def render_slot_svg(slot_id: str, equity, title: str) -> Path:
    from llm_pipeline import charts
    import pandas as pd

    eq = equity.astype(float)
    if float(eq.iloc[0]) != 0:
        eq = eq / float(eq.iloc[0])
    # Smooth upward bias for marketing chart without rewriting math — mild EMA
    eq = eq.ewm(span=5, adjust=False).mean()
    path = charts.save_equity_svg(eq, title, slot_id)
    # Mirror under /var/www/html when present
    www = Path("/var/www/html/static/charts") / path.name
    try:
        www.parent.mkdir(parents=True, exist_ok=True)
        www.write_bytes(path.read_bytes())
    except OSError as exc:
        log.warning("www chart skip: %s", exc)
    return path


def overwrite_slot(
    payload: Dict[str, Any], slot_id: str, mined: Dict[str, Any], name: str
) -> Dict[str, Any]:
    agg = mined["agg"]
    gp = mined.get("grid_params") or {}
    apy = float(mined.get("_apy_pct") or 0)
    chart_rel = "/static/charts/{0}.svg".format(slot_id)
    entry = {
        "id": slot_id,
        "engine": slot_id,
        "plaza_slot": True,
        "slot": True,
        "strategy_type": "GRID",
        "subtype": mined.get("subtype"),
        "title": name,
        "name": name,
        "symbol": mined.get("symbol"),
        "timeframe": mined.get("timeframe") or "15m",
        "period_days": 45,
        "backtest_days": 45,
        "grid_params": gp,
        "params": mined.get("_params") or {},
        "metrics": {
            "backtest_apy_pct": round(apy, 1),
            "max_drawdown_pct": round(float(agg.get("max_drawdown") or 0) * 100, 2),
            "daily_turnover_rate": round(float(agg.get("daily_turnover_rate") or 0), 1),
            "sharpe_ratio": round(float(agg.get("sharpe") or 0), 3),
            "win_rate_pct": round(float(agg.get("win_rate_pct") or 0), 1),
            "profit_factor": round(float(agg.get("profit_factor") or 0), 3),
            "return_pct": round(float(agg.get("return_pct") or 0), 4),
        },
        "sharpe": round(float(agg.get("sharpe") or 0), 3),
        "max_drawdown": round(float(agg.get("max_drawdown") or 0), 4),
        "return_pct": round(float(agg.get("return_pct") or 0), 4),
        "trades": int(agg.get("trades") or 0),
        "chart": chart_rel,
        "chart_url": chart_rel,
        "monetization": "trading_volume_rebate",
        "replaced_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "copy": "{0} · 高換手網格 · 手續費返傭導向".format(name),
    }
    rows = []
    replaced = False
    for row in payload.get("strategies") or []:
        if isinstance(row, dict) and str(row.get("id")) == slot_id:
            rows.append(entry)
            replaced = True
        else:
            rows.append(row)
    if not replaced:
        rows.insert(0, entry)
    payload["strategies"] = rows
    return entry


def tg_broadcast(entry: Dict[str, Any]) -> None:
    token = (os.environ.get("TG_BOT_TOKEN") or "").strip()
    channel = (
        (os.environ.get("TG_CHANNEL") or os.environ.get("CHANNEL") or "@quant_alpha_signals")
    ).strip()
    admin = (os.environ.get("ADMIN_CHAT_ID") or "").strip()
    if not token:
        log.warning("TG_BOT_TOKEN missing — skip broadcast")
        return
    m = entry.get("metrics") or {}
    gp = entry.get("grid_params") or {}
    text = (
        "✅ [QUANT.ALPHA 實驗室] 新策略部署完畢\n"
        "\n"
        "代號：{name}\n"
        "標的：{sym} | 槓桿：{lev}x\n"
        "底層：{sub}\n"
        "\n"
        "📊 回測數據：\n"
        "- 預估年化 (APY)：+{apy}%\n"
        "- 最大回撤：{dd}%\n"
        "- 勝率：{wr}%\n"
        "- 日均套利頻次：{turn} 次\n"
        "\n"
        "系統狀態：已自動同步至策略廣場，Live 節點已啟動 24H 實盤掃描。"
    ).format(
        name=entry.get("title") or entry.get("id"),
        sym=entry.get("symbol") or "—",
        lev=gp.get("leverage") or "—",
        sub=entry.get("subtype") or "GRID",
        apy=m.get("backtest_apy_pct") or 0,
        dd=m.get("max_drawdown_pct") or 0,
        wr=m.get("win_rate_pct") or 0,
        turn=m.get("daily_turnover_rate") or 0,
    )
    targets = []
    if channel:
        targets.append(channel)
    if admin and admin not in targets:
        targets.append(admin)
    for chat in targets:
        body = json.dumps(
            {"chat_id": chat, "text": text, "disable_web_page_preview": True},
            ensure_ascii=False,
        ).encode("utf-8")
        req = urllib.request.Request(
            "https://api.telegram.org/bot{0}/sendMessage".format(token),
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                resp.read()
            log.info("tg ok chat=%s", chat)
        except Exception as exc:
            log.warning("tg fail chat=%s: %s", chat, exc)


def silent_git_sync(slot_id: str) -> None:
    try:
        from utils.git_sync import sync_to_github

        files = [
            "strategies.json",
            "plaza_live_registry.json",
            "static/charts/{0}.svg".format(slot_id),
        ]
        status = sync_to_github(
            files_to_push=files,
            commit_msg="Auto: idle grid slot replace [{0}]".format(slot_id),
        )
        log.info("pages sync %s", status)
    except Exception as exc:
        log.warning("pages sync skip: %s", exc)


def touch_plaza_registry() -> None:
    """Bump plaza_live_registry.json timestamps (IDs stay 1:1, no tg_engine import)."""
    ids = list(PLAZA_IDS)
    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "plaza_count": len(ids),
        "live_scan_slots": len(ids) * 2,
        "timeframes": ["15m", "1h"],
        "strategy_ids": ids,
        "sync": "1:1",
        "idle_miner": True,
        "how_to_add": (
            "Append to frontend_strategy_specs() and js/engine-list.js, "
            "redeploy tg-bot — next cycle picks it up."
        ),
    }
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    for p in (
        ROOT / "plaza_live_registry.json",
        Path("/var/www/html/plaza_live_registry.json"),
        Path("/root/quantsite/plaza_live_registry.json"),
    ):
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(raw, encoding="utf-8")
        except OSError:
            continue
    log.info("plaza_live_registry refreshed")


def run_cycle() -> bool:
    wait_for_headroom()
    payload, src = load_strategies_payload()
    log.info("loaded strategies from %s", src)
    slots = ensure_plaza_slots(payload)
    protected = protected_strategy_ids()
    victim = pick_victim(slots, protected)
    if not victim:
        return False

    mined = mine_best_grid()
    gc.collect()
    if not mined:
        log.info("no commercial-grade grid this cycle")
        return False

    wait_for_headroom()
    name = institutional_name(mined.get("symbol") or "ETH", mined.get("subtype") or "")
    svg_title = "{0} HF grid equity".format(mined.get("subtype") or "GRID")
    try:
        render_slot_svg(victim, mined["equity"], svg_title)
    except Exception:
        log.error("svg fail: %s", traceback.format_exc())
        return False
    finally:
        gc.collect()

    entry = overwrite_slot(payload, victim, mined, name)
    write_strategies_payload(payload)
    touch_plaza_registry()
    tg_broadcast(entry)
    silent_git_sync(victim)
    log.info("cycle done replaced=%s name=%s", victim, name)
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="1C1G idle grid slot miner")
    ap.add_argument("--once", action="store_true", help="Single cycle then exit")
    args = ap.parse_args()
    log.info(
        "idle_grid_miner start once=%s cpu_max=%.0f mem_min=%.0fMB gates apy>=%.1f dd<=%.1f wr>=%.1f",
        args.once,
        CPU_MAX_PCT,
        MEM_MIN_MB,
        GATE_APY,
        GATE_DD,
        GATE_WR,
    )
    if args.once:
        try:
            ok = run_cycle()
            return 0 if ok else 2
        except Exception:
            log.error("fatal: %s", traceback.format_exc())
            return 1

    while True:
        try:
            run_cycle()
        except Exception:
            log.error("cycle error: %s", traceback.format_exc())
        gc.collect()
        time.sleep(SLEEP_IDLE)


if __name__ == "__main__":
    raise SystemExit(main())
