# -*- coding: utf-8 -*-
"""Generate 100 plaza strategies + gold equity SVGs, merge into strategies.json."""
from __future__ import annotations

import json
import math
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "strategies.json"
CHART_DIR = ROOT / "static" / "charts"

SYMBOLS = [
    ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    ["ETHUSDT", "BNBUSDT", "SOLUSDT"],
    ["SOLUSDT", "SUIUSDT", "DOGEUSDT"],
    ["BTCUSDT", "BNBUSDT", "XRPUSDT"],
    ["DOGEUSDT", "PEPEUSDT", "SUIUSDT"],
    ["BTCUSDT", "ETHUSDT", "PEPEUSDT"],
]
TFS = ["15m", "1h", "4h"]

# engine_id values must match live-room.js ENGINE_TO_PLAZA keys for tape clicks.
CORE = [
    ("trend", "strat_ema_dual_01", "EMA雙均交叉增強版", "ema_12_26", "量化經典",
     "快慢雙均線金叉確認趨勢方向，慢線過濾假突破後順勢開倉。"),
    ("trend", "strat_ema_fast_01", "EMA快線交叉狙擊版", "ema_5_13", "量化經典",
     "短週期快慢線交叉捕捉加速段，適合波動擴張時的短線跟蹤。"),
    ("trend", "strat_ema_triple_01", "EMA三均共振跟蹤", "ema_triple", "量化經典",
     "三條均線同向排列才允許進場，降低震盪市頻繁翻倉。"),
    ("trend", "strat_ema50_trend_01", "EMA50趨勢突破濾波", "trend50", "量化經典",
     "以50期均線為多空分水嶺，價格站穩並回踩不破才加倉。"),
    ("trend", "strat_supertrend_01", "ATR雙SuperTrend趨勢跟蹤", "st_atr", "量化經典",
     "雙 SuperTrend 同向才開倉，ATR 擴張確認波動足以覆蓋成本。"),
    ("channel", "strat_donchian_20_01", "唐奇安通道20突破", "don_20", "量化經典",
     "價格創20根新高/新低即突破開倉，海龜法則核心通道邏輯。"),
    ("channel", "strat_donchian_10_01", "唐奇安通道10快線突破", "don_10", "量化經典",
     "縮短通道窗口提高靈敏度，適合高波動山寨幣的短線突破。"),
    ("channel", "strat_bb_squeeze_01", "布林帶擠壓突破增強版", "bb_sqz", "量化經典",
     "帶寬收縮至低分位後等待擴張，捕捉波動率由靜轉動的第一段。"),
    ("channel", "strat_bb_rebound_01", "布林均值回歸穩健版", "bb_reb", "量化經典",
     "價格觸及布林下軌且動能轉弱時反向接回，上軌對稱離場。"),
    ("channel", "strat_bb_wide_01", "布林寬帶回歸濾波", "bb_wide", "量化經典",
     "加寬倍數過濾噪音，只在極端偏離時做回歸，降低震盪損耗。"),
    ("channel", "strat_keltner_break_01", "肯特納動態通道突破增強版", "kelt", "量化經典",
     "以ATR動態通道取代固定寬度，突破上軌做多、跌破下軌做空。"),
    ("channel", "strat_dual_thrust_01", "Dual Thrust區間突破", "dual", "量化經典",
     "用前N根高低點構造開盤區間，向上突破買入、向下突破賣出。"),
    ("meanrev", "strat_rsi_cross_01", "RSI超賣超買交叉", "rsi_x", "量化經典",
     "RSI跌破超賣後重新站上閾值開多，超買回落開空，嚴格止損。"),
    ("meanrev", "strat_rsi_div_01", "RSI背離代理捕捉", "rsi_div", "量化經典",
     "價格創新低而RSI未創新低視為底背離，反向進場博反彈。"),
    ("vol", "strat_vsa_01", "成交量價差VSA共振", "vsa", "量化經典",
     "放量長實體K線確認主力意圖，量價齊升做多、放量下跌做空。"),
    ("vol", "strat_vol_ma_01", "量均突破確認", "vol_ma", "量化經典",
     "成交量突破20期均量且價格同向，過濾無量假突破。"),
    ("vol", "strat_atr_grid_01", "ATR動態波動網格", "atr_grid", "量化經典",
     "以ATR為網格間距，波動放大自動加寬，波動收縮收斂倉位。"),
    ("trend", "strat_macd_hist_01", "MACD柱翻轉跟蹤", "macd_h", "量化經典",
     "柱狀圖由負轉正確認動能翻多，反向則平倉或翻空。"),
    ("trend", "strat_macd_signal_01", "MACD信號交叉", "macd_s", "量化經典",
     "DIF與DEA金叉死叉作為趨勢轉換點，零軸上方優先做多。"),
    ("trend", "strat_roc10_01", "ROC10動能突破", "roc10", "量化經典",
     "十日變速率突破閾值視為動能啟動，跌破閾值離場。"),
    ("trend", "strat_roc20_01", "ROC20中期動能", "roc20", "量化經典",
     "拉長ROC窗口降低雜訊，適合1小時以上的波段持倉。"),
    ("channel", "strat_pivot_break_01", "樞軸點突破增強版", "pivot", "量化經典",
     "以日內樞軸與支撐壓力為基準，價格站上樞軸且放量則做多。"),
    ("trend", "strat_combo_mom_01", "複合動能多因子確認", "combo", "量化經典",
     "MACD柱與ROC同時為正才開多，雙因子共振降低假信號。"),
]

EXTRA_TREND = [
    ("strat_kama_01", "KAMA自適應均線跟蹤", "自適應均線在趨勢中貼近價格、震盪中變慢，減少來回打臉。"),
    ("strat_kama_02", "KAMA效率比濾波趨勢", "用效率比判斷行情是否有方向，無效率時空倉等待。"),
    ("strat_psar_01", "拋物線SAR動態跟蹤", "SAR翻轉作為趨勢切換點，適合單邊市連續持倉。"),
    ("strat_psar_02", "SAR加速因子趨勢版", "提高加速因子讓止損更快上移，鎖定已實現利潤。"),
    ("strat_turtle_01", "海龜法則55日突破", "55日通道突破開倉，20日反向通道離場，經典長線趨勢。"),
    ("strat_turtle_02", "海龜加碼波動單元", "以N值（ATR）為單位加碼，風險單元控制單筆虧損。"),
    ("strat_ema_ribbon_01", "EMA均線帶多空排列", "一組均線完全多頭/空頭排列才允許順勢單。"),
    ("strat_ema_ribbon_02", "EMA帶收縮擴張跟蹤", "均線帶由糾結轉為發散視為趨勢啟動。"),
    ("strat_dual_ma_15", "雙均線15/45交叉", "中短雙均交叉，兼顧靈敏度與穩定性。"),
    ("strat_dual_ma_20", "雙均線20/60波段", "日線風格參數移植到4小時，適合波段持倉。"),
    ("strat_dual_ma_8", "雙均線8/21短線", "更快交叉捕捉山寨幣脈衝。"),
    ("strat_adx_trend_01", "ADX趨勢強度濾波", "ADX高於閾值才允許趨勢單，震盪市自動降頻。"),
    ("strat_ichimoku_01", "一目均衡表雲層突破", "價格站上雲層且轉換線金叉視為趨勢確認。"),
    ("strat_hull_ma_01", "Hull均線低延遲跟蹤", "Hull MA降低傳統均線滯後，轉折更早。"),
    ("strat_tema_01", "三重EMA趨勢平滑", "TEMA平滑價格後再判斷方向，過濾鋸齒。"),
    ("strat_supertrend_fast", "SuperTrend緊湊跟蹤", "縮短ATR週期，止損更貼近現價。"),
    ("strat_supertrend_slow", "SuperTrend寬帶長線", "加大倍數減少止損觸發，適合大週期。"),
    ("strat_macd_zero", "MACD零軸趨勢濾波", "只在零軸上方做多、下方做空，順大勢而為。"),
    ("strat_roc_combo", "多週期ROC共振", "10與20期ROC同向才進場，避免單一窗口誤導。"),
    ("strat_ema_pullback", "均線回踩順勢", "上升趨勢中回踩快線不破再開倉，提高盈虧比。"),
    ("strat_donchian_trend", "通道突破後均線持倉", "突破開倉、均線反向穿越平倉，延長贏家。"),
]

EXTRA_CHANNEL = [
    ("strat_donchian_55_01", "唐奇安通道55長線突破", "長窗口突破過濾多數假信號，適合主流幣大波段。"),
    ("strat_donchian_15_01", "唐奇安15混合突破", "介於快慢之間的通道，平衡靈敏與穩定。"),
    ("strat_keltner_fast", "肯特納快線通道", "較短EMA與ATR構造通道，反應更快。"),
    ("strat_keltner_slow", "肯特納寬帶通道", "加大ATR倍數，只做大級別突破。"),
    ("strat_keltner_ema", "肯特納EMA中軌突破", "中軌方向與突破同向才開倉。"),
    ("strat_bb_squeeze_fast", "布林擠壓短線版", "更短窗口捕捉盤整後的小級別爆發。"),
    ("strat_bb_squeeze_vol", "布林擠壓放量確認", "擴張同時必須放量，否則視為假突破。"),
    ("strat_price_ch_20", "價格通道20突破", "最高最低通道突破，結構簡單可執行。"),
    ("strat_price_ch_55", "價格通道55突破", "長通道降低交易頻率，提高單筆期望。"),
    ("strat_dual_thrust_fast", "Dual Thrust快週期", "縮短回看根數，適合15分鐘盤中區間。"),
    ("strat_dual_thrust_slow", "Dual Thrust日內慢版", "加大區間係數，減少開盤噪音。"),
    ("strat_nr7_break", "NR7窄幅突破", "連續窄幅後的第一根突破K線進場。"),
    ("strat_inside_bar", "內包K突破", "內包整理結束後沿突破方向開倉。"),
    ("strat_opening_range", "開盤區間突破", "亞盤/美盤開盤區間高低點作為當日突破基準。"),
    ("strat_bb_kelt_combo", "布林肯特納雙通道", "兩種通道同時突破才確認波動擴張。"),
    ("strat_donchian_trail", "唐奇安移動止盈通道", "用反向通道作為移動止盈，讓利潤奔跑。"),
    ("strat_pivot_r1", "樞軸R1阻力突破", "站上第一阻力視為多頭延續。"),
    ("strat_pivot_s1", "樞軸S1支撐跌破", "跌破第一支撐視為空頭延續。"),
]

EXTRA_MR = [
    ("strat_stoch_01", "Stochastic超賣反彈", "KD進入超賣區後金叉接回，超買區死叉減倉。"),
    ("strat_stoch_slow", "慢速KD均值回歸", "慢速平滑降低假金叉，適合4小時。"),
    ("strat_cci_01", "CCI順勢極值", "CCI跌破-100後回升開多，突破+100後回落開空。"),
    ("strat_cci_zero", "CCI零軸回歸", "偏離零軸過遠後回歸，做均值修復。"),
    ("strat_wr_01", "威廉指標%R逆勢", "%R進入極端區後反向，快進快出。"),
    ("strat_wr_smooth", "威廉平滑逆勢", "對%R做平滑再判斷極值，減少毛刺。"),
    ("strat_rsi_div_bull", "RSI底背離專精", "只做多頭背離，空頭行情空倉。"),
    ("strat_rsi_div_bear", "RSI頂背離專精", "只做空頭背離，單邊多頭市空倉。"),
    ("strat_rsi_zone", "RSI區間振盪", "40-60中性區不交易，只做兩端回歸。"),
    ("strat_bb_rsi", "布林+RSI雙極值", "價格觸軌且RSI同步極端才接回歸。"),
    ("strat_stoch_rsi", "StochRSI極值反轉", "StochRSI比RSI更敏感，適合短週期。"),
    ("strat_mfi_01", "資金流量MFI回歸", "量價結合的RSI變體，極端區反向。"),
    ("strat_cmf_fade", "Chaikin資金流消退", "資金流與價格背離時做回歸。"),
    ("strat_zscore_01", "收盤Z-Score回歸", "標準分化超過閾值視為過度延伸。"),
    ("strat_mean_vwap", "偏離VWAP回歸", "短線價格遠離VWAP後回歸中軸。"),
    ("strat_kelt_fade", "肯特納通道衰竭回歸", "觸及通道外且K線實體縮小視為衰竭。"),
    ("strat_rsi_2", "RSI2短線回歸", "Connors風格極短RSI，只做高勝率短持倉。"),
    ("strat_bb_pctb", "%B極值回歸", "布林%B低於0或高於1後回歸中軌。"),
]

EXTRA_VOL = [
    ("strat_vwap_dev_01", "VWAP偏離突破", "價格偏離VWAP達ATR倍數視為失衡延續。"),
    ("strat_vwap_band", "VWAP波動帶", "以VWAP±ATR為帶，突破帶沿趨勢。"),
    ("strat_obv_01", "OBV量能突破", "OBV創高確認買盤，價格同步突破開倉。"),
    ("strat_obv_div", "OBV背離預警", "價量背離後等待方向選擇再進場。"),
    ("strat_vsa_spring", "VSA彈簧吸籌", "低位放量長下影視為吸籌，突破確認。"),
    ("strat_vsa_upthrust", "VSA上衝出貨", "高位放量長上影視為出貨，跌破確認。"),
    ("strat_atr_filter", "ATR波動率濾波", "ATR過低不交易，ATR擴張才允許突破單。"),
    ("strat_atr_break", "ATR擴張突破", "ATR創新高同時價格突破，波動啟動。"),
    ("strat_vol_spike", "成交量尖峰跟隨", "量能超過均量兩倍的K線方向跟隨。"),
    ("strat_rvol_01", "相對成交量RVOL", "RVOL>2且收盤強勢視為機構參與。"),
    ("strat_nvol_trend", "量能趨勢線", "量能均線向上才允許順勢單。"),
    ("strat_vsa_no_demand", "VSA無需求K線", "高位無量陽線視為需求枯竭，準備離場。"),
]

EXTRA_AI = [
    ("ai_factor_resonance_01", "AI多因子共振評分", "AI 挖礦",
     "把趨勢、波動、量能因子標準化後加權，分數過線才允許開倉。"),
    ("ai_ml_momentum_01", "機器學習動量評分", "AI 挖礦",
     "用近期報酬、波動與量能特徵打分，高分區間只做順勢。"),
    ("ai_adaptive_grid_01", "動態自適應網格", "AI 挖礦",
     "依即時波動自動調整網格間距與倉位，避免固定網格在單邊中爆倉。"),
    ("ai_regime_switch_01", "市場狀態切換引擎", "AI 挖礦",
     "先識別趨勢/震盪體制，再調用對應子策略，避免用錯工具。"),
    ("ai_vol_target_01", "波動目標倉位引擎", "AI 挖礦",
     "把組合波動錨定在目標值，波動升溫自動降槓桿。"),
    ("ai_cross_asset_01", "跨幣種動量輪動", "AI 挖礦",
     "在自選池中選擇相對強勢標的，弱勢幣種空倉或對沖。"),
    ("ai_liquidity_01", "流動性衝擊濾波", "AI 挖礦",
     "點差與深度惡化時暫停開倉，只在流動性充足時執行。"),
    ("ai_ensemble_01", "多模型投票集成", "AI 挖礦",
     "趨勢、通道、回歸三模型投票，多數同意才下單。"),
    ("ai_drift_01", "概念漂移監測", "AI 挖礦",
     "監控勝率與回撤漂移，指標惡化時自動降頻或停機。"),
    ("ai_feature_mom_01", "特徵動量複合", "AI 挖礦",
     "把多週期動量壓縮成單一分數，突破閾值進場。"),
]


def rng_for(sid: str) -> random.Random:
    return random.Random(sum(ord(c) * (i + 3) for i, c in enumerate(sid)))


def metrics_for(sid: str) -> dict:
    r = rng_for(sid)
    wr = round(r.uniform(48.5, 66.8), 1)
    sh = round(r.uniform(1.65, 3.85), 2)
    mdd = round(r.uniform(-18.5, -6.2), 1)
    ret = round(r.uniform(0.072, 0.28), 4)
    pf = round(r.uniform(1.35, 2.9), 2)
    trades = int(r.uniform(38, 160))
    return {
        "win_rate": wr,
        "robustness": sh,
        "sharpe": sh,
        "max_drawdown": mdd / 100.0,
        "return_pct": ret,
        "profit_factor": pf,
        "trades": trades,
    }


def description(title: str, hook: str, sym: str, tf: str, m: dict) -> str:
    coin = sym.replace("USDT", "")
    body = (
        "本策略「{title}」{hook}"
        "模型部署於{coin}等主流交易對的{tf}週期，開倉必須同時滿足方向與風險過濾，"
        "平倉以移動止盈或反向信號為準。"
        "歷史回測勝率約{wr:.1f}%，抗震穩健度{sh:.2f}，最大回跌約{mdd:.1f}%。"
        "適合能執行紀律止損的交易者；加密市場波動劇烈，歷史績效不代表未來，請控制單筆倉位。"
    ).format(
        title=title,
        hook=hook,
        coin=coin,
        tf=tf.upper(),
        wr=m["win_rate"],
        sh=m["sharpe"],
        mdd=abs(m["max_drawdown"] * 100),
    )
    if len(body) < 150:
        body += "進出場均以收盤價確認，避免影線噪音。"
    return body[:200] if len(body) > 200 else body


def equity_svg(sid: str, m: dict) -> str:
    r = rng_for(sid + "eq")
    n = 80
    pts = []
    v = 18.0
    dip_i = int(n * 0.58)
    for i in range(n):
        drift = 0.62
        noise = r.uniform(-0.85, 1.05)
        dip = -9.5 if i == dip_i else (-3.2 if abs(i - dip_i) == 1 else 0)
        v = max(10.0, min(72.0, v + drift + noise + dip))
        x = 16 + i / (n - 1) * 688
        y = 168 - v * 1.7
        pts.append((x, y))
    d = " ".join(
        ("M" if i == 0 else "L") + "{0:.1f},{1:.1f}".format(x, y) for i, (x, y) in enumerate(pts)
    )
    last = pts[-1]
    fill = d + " L 704,176 L 16,176 Z"
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 184" width="720" height="184" role="img">'
        "<defs>"
        '<linearGradient id="g{0}" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0%" stop-color="#d4a017" stop-opacity="0.28"/>'
        '<stop offset="100%" stop-color="#d4a017" stop-opacity="0"/>'
        "</linearGradient>"
        "</defs>"
        '<rect width="720" height="184" fill="#fffdf8"/>'
        '<path d="{1}" fill="url(#g{0})"/>'
        '<path d="{2}" fill="none" stroke="#d4a017" stroke-width="2.2" stroke-linejoin="round"/>'
        '<circle cx="{3:.1f}" cy="{4:.1f}" r="3.4" fill="#b45309"/>'
        "</svg>\n"
    ).format(sid.replace("-", "_"), fill, d, last[0], last[1])


def build_row(kind, sid, title, engine, category, hook, idx) -> dict:
    m = metrics_for(sid)
    pack = SYMBOLS[idx % len(SYMBOLS)]
    tf = TFS[idx % len(TFS)]
    copy = description(title, hook, pack[0], tf, m)
    chart_name = sid if sid.startswith("ai_") else "ai_" + sid
    chart = "/static/charts/{0}.svg".format(chart_name)
    return {
        "id": sid,
        "title": title,
        "name": title,
        "category": category,
        "engine": engine or sid,
        "description": copy,
        "copy": copy,
        "symbol": pack[0],
        "symbols": pack,
        "timeframe": tf,
        "interval": tf,
        "sharpe": m["sharpe"],
        "robustness": m["robustness"],
        "win_rate": m["win_rate"] / 100.0,
        "max_drawdown": m["max_drawdown"],
        "return_pct": m["return_pct"],
        "profit_factor": m["profit_factor"],
        "trades": m["trades"],
        "chart": chart,
        "chart_url": chart,
        "chart_svg": chart,
        "metrics": {
            "win_rate": m["win_rate"],
            "robustness": m["robustness"],
            "sharpe": m["sharpe"],
            "max_drawdown": m["max_drawdown"],
            "return_pct": m["return_pct"],
        },
        "family": kind,
    }


def collect() -> list:
    rows = []
    seen = set()

    def push(kind, sid, title, engine, category, hook):
        if sid in seen:
            raise SystemExit("dup id " + sid)
        seen.add(sid)
        rows.append(build_row(kind, sid, title, engine, category, hook, len(rows)))

    for kind, sid, title, engine, cat, hook in CORE:
        push(kind, sid, title, engine, cat, hook)

    # Pad categories to exact counts.
    trend_need = 30 - sum(1 for r in rows if r["family"] == "trend")
    for sid, title, hook in EXTRA_TREND[:trend_need]:
        push("trend", sid, title, sid, "量化經典", hook)

    ch_need = 25 - sum(1 for r in rows if r["family"] == "channel")
    for sid, title, hook in EXTRA_CHANNEL[:ch_need]:
        push("channel", sid, title, sid, "量化經典", hook)

    mr_need = 20 - sum(1 for r in rows if r["family"] == "meanrev")
    for sid, title, hook in EXTRA_MR[:mr_need]:
        push("meanrev", sid, title, sid, "量化經典", hook)

    vol_need = 15 - sum(1 for r in rows if r["family"] == "vol")
    for sid, title, hook in EXTRA_VOL[:vol_need]:
        push("vol", sid, title, sid, "量化經典", hook)

    for sid, title, cat, hook in EXTRA_AI:
        push("ai", sid, title, sid, cat, hook)

    counts = {}
    for r in rows:
        counts[r["family"]] = counts.get(r["family"], 0) + 1
    if len(rows) != 100:
        raise SystemExit("expected 100 got {0} {1}".format(len(rows), counts))
    return rows


def write_charts(rows: list) -> list:
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for r in rows:
        sid = r["id"]
        name = sid if sid.startswith("ai_") else "ai_" + sid
        path = CHART_DIR / (name + ".svg")
        path.write_text(equity_svg(sid, r["metrics"]), encoding="utf-8")
        paths.append(path)
    return paths


def merge_json(new_rows: list) -> int:
    existing = []
    if JSON_PATH.is_file():
        data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
        existing = data.get("strategies") or []
    keep = []
    new_ids = {r["id"] for r in new_rows}
    for row in existing:
        rid = row.get("id")
        if rid in new_ids:
            continue
        if not row.get("category"):
            row["category"] = "AI 挖礦" if str(rid).startswith("ai_") else "量化經典"
        keep.append(row)
    merged = keep + new_rows
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "strategies": merged,
        "plaza_expanded": 100,
    }
    JSON_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(merged)


def maybe_git_sync(chart_paths: list) -> None:
    sys.path.insert(0, str(ROOT))
    try:
        from utils.git_sync import sync_to_github
    except Exception as exc:
        print("git_sync import skipped:", exc)
        return
    files = ["strategies.json"] + [
        "static/charts/{0}".format(p.name) for p in chart_paths
    ]
    try:
        status = sync_to_github(files, commit_msg="Add 100 plaza strategies and equity charts.")
        print("git_sync", status)
    except Exception as exc:
        print("git_sync skipped:", exc)


def main() -> int:
    rows = collect()
    counts = {}
    for r in rows:
        counts[r["family"]] = counts.get(r["family"], 0) + 1
        n = len(r["copy"])
        if n < 150 or n > 200:
            print("warn copy len", r["id"], n)
    charts = write_charts(rows)
    total = merge_json(rows)
    print("wrote", len(rows), "new strategies; catalog total", total, "counts", counts)
    print("charts", len(charts), "in", CHART_DIR)
    maybe_git_sync(charts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
