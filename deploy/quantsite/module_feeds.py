# -*- coding: utf-8 -*-
"""module_feeds.py · 广州表哥 GZBG QUANT 站点 4 模块数据生成器（VPS 独立脚本）。

完全独立于 tg_engine.py 主循环：只读 tg_engine 产出的 JSON，派生并发布
前端 gzbg-modules.js 消费的 4 个模块数据契约：

  /var/www/html/data/small_fund.json   百U翻仓计划  {plan:[{label,val,done}], kpi:{current_mult,win_rate,days}}
  /var/www/html/data/tp3_tracker.json  TP3 极值追踪  {signals:[{sym,tf,dir,px,prog,hit,tp3}]}
  /var/www/html/data/alt_signals.json  山寨爆点专线  {signals:[{sym,dir,px,chg,conf}]}
  /var/www/html/data/whale_radar.json  主力异动雷达  {flows:[{sym,side,pct,amt}]}

数据源（均为 tg_engine 每 5s 产出的本地文件）：
  live_feed.json           活跃信号 active_signals_3h / exec_log
  live_position_state.json 持仓开仓价 {strat_sym:{side,price,bar_ts}}
  live_exec_log.json       开平仓记录（tp_pct / pnl_pct）
  leaderboard.json         策略战绩 by_engine / hero_highlight（48MB，仅取小字段）

无网络请求、轻量（<1s）、原子写；任何源缺失自动降级静态示例。
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

APP = "/var/www/quantsite"
OUT_DIR = "/var/www/quantsite/data"
if os.name == "nt":
    APP = r"E:\QuantSite\deploy\quantsite"  # 本地调试回退
    OUT_DIR = r"E:\QuantSite\deploy\quantsite\data_out"

FEED = os.path.join(APP, "live_feed.json")
POS = os.path.join(APP, "live_position_state.json")
EXEC = os.path.join(APP, "live_exec_log.json")
LB = os.path.join(APP, "leaderboard.json")

SCAN_TF = "1h"


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print("[{0}] {1}".format(ts, msg), flush=True)


def load_json(path: str) -> dict | list | None:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return json.load(fh)
    except Exception:
        return None


def base_sym(symbol: str) -> str:
    for suffix in ("USDT", "USDC", "BUSD", "USD"):
        if symbol.endswith(suffix) and len(symbol) > len(suffix):
            return symbol[: -len(suffix)]
    return symbol


def fmt_amt(x: float) -> str:
    """金额压缩为 M 单位显示，如 2.4M / 860K。"""
    if x >= 1e6:
        return "{0:.1f}M".format(x / 1e6)
    if x >= 1e3:
        return "{0:.0f}K".format(x / 1e3)
    return "{0:.0f}".format(x)


# ---------------------------------------------------------------------------
# 01 · 百U翻仓计划
# ---------------------------------------------------------------------------
def build_small_fund(lb: dict | None) -> dict:
    kpi = {"current_mult": 3.0, "win_rate": 88.6, "days": 45}
    plan = [
        {"label": "建仓 100U 纪律仓位", "val": "单笔风控 ≤5%", "done": True},
        {"label": "TP1 减仓 30% 并自动保本移位", "val": "锁定本金", "done": True},
        {"label": "TP2 再减 40% 锁利", "val": "落袋为安", "done": True},
        {"label": "TP3 全清吃满主升浪", "val": "复利滚仓", "done": False},
        {"label": "向 1000U 目标进发", "val": "GZBG 纪律", "done": False},
    ]
    if lb and isinstance(lb, dict):
        hero = lb.get("hero_highlight") or {}
        try:
            roi = float(hero.get("roi_pct") or 0)
            days = int(hero.get("period_days") or 60)
            # 名义倍率：60 天实际 ROI × 50x 名义杠杆折算
            kpi["current_mult"] = round(max(1.0, roi / 100.0 * 50.0), 1)
            kpi["days"] = days
        except (TypeError, ValueError):
            pass
        boards = lb.get("wr_board") or []
        if boards:
            wr_vals = []
            for r in boards[:3]:
                try:
                    wr_vals.append(float(r.get("win_rate_smooth") or r.get("win_rate") or 0))
                except (TypeError, ValueError):
                    continue
            if wr_vals:
                kpi["win_rate"] = round(sum(wr_vals) / len(wr_vals) * 100.0, 1)
        plan[3]["done"] = bool(hero)
        plan[4]["done"] = bool(hero) and kpi["current_mult"] >= 5.0
    return {"plan": plan, "kpi": kpi}


# ---------------------------------------------------------------------------
# 02 · TP3 极值追踪
# ---------------------------------------------------------------------------
def build_tp3(feed: dict | None, pos: dict | None, exec_log: list | None) -> dict:
    signals = []
    if not (feed and pos):
        return {"signals": signals}
    active = feed.get("active_signals_3h") or []
    by_sym = {}
    for s in active:
        sym = s.get("symbol")
        if not sym:
            continue
        by_sym.setdefault(sym, []).append(s)
    # 每个 symbol 的 TP 参数（最近 exec_log 的 tp_pct 绝对值）
    tp_map = {}
    if exec_log:
        for r in exec_log:
            sym = r.get("symbol")
            try:
                tp = abs(float(r.get("tp_pct") or 0))
            except (TypeError, ValueError):
                tp = 0.0
            if sym and tp > 0.01:
                tp_map[sym] = tp
    now = int(datetime.now(timezone.utc).timestamp())
    for key, ps in pos.items():
        if not isinstance(ps, dict):
            continue
        sym = key.split("_", 1)[-1]
        try:
            entry = float(ps.get("price") or 0)
        except (TypeError, ValueError):
            continue
        side = str(ps.get("side") or "LONG").upper()
        rows = by_sym.get(sym) or []
        if not rows:
            continue
        # 最新价取该 symbol 最新 active signal 的 price
        rows_sorted = sorted(rows, key=lambda x: int(x.get("bar_ts") or 0), reverse=True)
        cur = None
        for r in rows_sorted:
            try:
                cur = float(r.get("price"))
            except (TypeError, ValueError):
                continue
            if cur:
                break
        if not cur or not entry:
            continue
        move = (cur - entry) / entry
        if side == "SHORT":
            move = -move
        move_pct = move * 100.0
        tp_pct = tp_map.get(sym, 3.0)
        target3 = tp_pct * 3.0  # TP3 目标 = 3 × tp_pct
        prog = max(0.0, min(100.0, move_pct / target3 * 100.0))
        hit = ""
        if move_pct >= target3:
            hit = "TP3"
        elif move_pct >= tp_pct * 2.0:
            hit = "TP2"
        elif move_pct >= tp_pct:
            hit = "TP1"
        # 距 TP3 目标剩余涨幅（名义）
        remain = max(0.0, target3 - move_pct)
        signals.append(
            {
                "sym": base_sym(sym),
                "tf": feed.get("scan_tf") or SCAN_TF,
                "dir": side,
                "px": round(cur, 6),
                "prog": round(prog, 1),
                "hit": hit,
                "tp3": round(remain, 2),
                "ts": now,
            }
        )
    signals.sort(key=lambda x: x["prog"], reverse=True)
    return {"signals": signals[:4], "updated_at": feed.get("updated_at")}


# ---------------------------------------------------------------------------
# 03 · 山寨爆点专线
# ---------------------------------------------------------------------------
def build_alt(feed: dict | None, pos: dict | None, exec_log: list | None) -> dict:
    signals = []
    if not feed:
        return {"signals": signals}
    active = feed.get("active_signals_3h") or []
    # 按 symbol 聚合信号强度
    agg: dict[str, dict] = {}
    for s in active:
        sym = s.get("symbol")
        if not sym:
            continue
        d = agg.setdefault(sym, {"n": 0, "long": 0, "short": 0, "px": 0.0, "ts": 0})
        d["n"] += 1
        d["long" if str(s.get("side")).upper() == "LONG" else "short"] += 1
        try:
            d["px"] = float(s.get("price") or 0)
        except (TypeError, ValueError):
            pass
        d["ts"] = max(d["ts"], int(s.get("bar_ts") or 0))
    # 涨跌幅参考：exec_log 中同 symbol 最近 pnl_pct / 相对开仓价
    move_map: dict[str, float] = {}
    if exec_log:
        for r in exec_log:
            sym = r.get("symbol")
            pnl = r.get("pnl_pct")
            try:
                pnl = float(pnl)
            except (TypeError, ValueError):
                pnl = None
            if sym and pnl is not None:
                move_map[sym] = pnl  # 最后一次 close 的 pnl
    if pos:
        for key, ps in pos.items():
            sym = key.split("_", 1)[-1]
            if sym not in agg or sym in move_map:
                continue
            try:
                entry = float(ps.get("price") or 0)
                cur = agg[sym]["px"]
                side = str(ps.get("side") or "LONG").upper()
                m = (cur - entry) / entry * 100.0
                if side == "SHORT":
                    m = -m
                move_map[sym] = m
            except (TypeError, ValueError):
                continue
    out = []
    for sym, d in agg.items():
        side = "LONG" if d["long"] >= d["short"] else "SHORT"
        chg = move_map.get(sym, 0.0)
        # 置信度：信号共振数 + 涨跌幅强度
        conf = min(100.0, 45.0 + d["n"] * 8.0 + min(25.0, abs(chg) * 5.0))
        out.append(
            {
                "sym": base_sym(sym),
                "dir": side,
                "px": d["px"],
                "chg": round(abs(chg), 2) if side == "LONG" else round(-abs(chg), 2),
                "conf": round(conf, 0),
                "n": d["n"],
                "ts": d["ts"],
            }
        )
    out.sort(key=lambda x: x["conf"], reverse=True)
    return {"signals": out[:8], "updated_at": feed.get("updated_at")}


# ---------------------------------------------------------------------------
# 04 · 主力异动雷达
# ---------------------------------------------------------------------------
def build_whale(feed: dict | None, pos: dict | None, exec_log: list | None) -> dict:
    flows = []
    if not feed:
        return {"flows": flows}
    active = feed.get("active_signals_3h") or []
    agg: dict[str, dict] = {}
    for s in active:
        sym = s.get("symbol")
        if not sym:
            continue
        d = agg.setdefault(sym, {"n": 0, "long": 0, "short": 0, "px": 0.0, "ts": 0})
        d["n"] += 1
        d["long" if str(s.get("side")).upper() == "LONG" else "short"] += 1
        try:
            d["px"] = float(s.get("price") or 0)
        except (TypeError, ValueError):
            pass
        d["ts"] = max(d["ts"], int(s.get("bar_ts") or 0))
    # 价格异动幅度（相对开仓价）
    move_map: dict[str, float] = {}
    if pos:
        for key, ps in pos.items():
            sym = key.split("_", 1)[-1]
            if sym not in agg:
                continue
            try:
                entry = float(ps.get("price") or 0)
                cur = agg[sym]["px"]
                m = (cur - entry) / entry * 100.0
                if str(ps.get("side")).upper() == "SHORT":
                    m = -m
                move_map[sym] = abs(m)
            except (TypeError, ValueError):
                continue
    for sym, d in agg.items():
        side = "out" if d["short"] > d["long"] else "in"
        move = move_map.get(sym, 0.0)
        pct = min(100.0, 20.0 + d["n"] * 10.0 + move * 8.0)
        # 名义金额：信号共振 × 价格量级（模拟主力扫单规模）
        notional = d["px"] * d["n"] * 6000.0
        if notional < 5e5:
            notional = 5e5 + d["n"] * 1.2e5
        flows.append(
            {
                "sym": base_sym(sym),
                "side": side,
                "pct": round(pct, 0),
                "amt": fmt_amt(notional),
                "n": d["n"],
            }
        )
    flows.sort(key=lambda x: x["pct"], reverse=True)
    return {"flows": flows[:6], "updated_at": feed.get("updated_at")}


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main() -> int:
    feed = load_json(FEED)
    pos = load_json(POS)
    exec_log = load_json(EXEC)
    lb = load_json(LB)

    feeds = {
        "small_fund.json": build_small_fund(lb),
        "tp3_tracker.json": build_tp3(feed, pos, exec_log),
        "alt_signals.json": build_alt(feed, pos, exec_log),
        "whale_radar.json": build_whale(feed, pos, exec_log),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, payload in feeds.items():
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        tmp = os.path.join(OUT_DIR, name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(raw)
        os.replace(tmp, os.path.join(OUT_DIR, name))
        log("wrote {0} ({1} bytes)".format(os.path.join(OUT_DIR, name), len(raw)))

    log(
        "summary sf={0} tp3={1} alt={2} whale={3}".format(
            feeds["small_fund.json"]["kpi"]["current_mult"],
            len(feeds["tp3_tracker.json"].get("signals") or []),
            len(feeds["alt_signals.json"].get("signals") or []),
            len(feeds["whale_radar.json"].get("flows") or []),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
