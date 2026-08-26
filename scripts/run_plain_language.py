# -*- coding: utf-8 -*-
"""Site-wide jargon -> plain language (人话). Longest match first."""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(r"E:\QuantSite")
REPORT = ROOT / "plain_language_report.txt"
SKIP_DIRS = {"node_modules", "dist", "build", ".git", "js/lib"}
SCAN_EXTS = {".js", ".html", ".ts", ".vue"}
SKIP_FILES = {
    "grademark.min.js",
    "lightweight-charts.standalone.production.js",
    "_old_i18n.js",
    "plain_language_report.txt",
}
CONFIG_NAMES = {"package.json", "wrangler.toml", "package-lock.json", "tsconfig.json"}

# Traditional + Simplified pairs (OG -> LG), longest first
PAIRS: list[tuple[str, str]] = [
    # hero / KPI / boards
    ("開源量化工具，助你評估策略的時序Alpha係數與波動捕捉能力", "開源工具，幫你看懂策略賺不賺錢"),
    ("开源量化工具，助你评估策略的时序Alpha系数与波动捕捉能力", "开源工具，帮你看懂策略赚不赚钱"),
    ("近階段波動捕捉率（時序Alpha）", "近階段收益率"),
    ("近阶段波动捕捉率（时序Alpha）", "近阶段收益率"),
    ("策略Alpha排序（基於回測窗口）", "誰賺得多（收益排行）"),
    ("策略Alpha排序（基于回测窗口）", "谁赚得多（收益排行）"),
    ("極端窗口波動捕捉率排行 TOP 5（僅供回測觀察）", "這段日子誰賺得多 TOP 5（只看歷史試算）"),
    ("极端窗口波动捕捉率排行 TOP 5（仅供回测观察）", "这段日子谁赚得多 TOP 5（只看历史试算）"),
    ("區間波動捕捉率", "區間收益"),
    ("区间波动捕捉率", "区间收益"),
    ("網格策略波動捕捉率 TOP 3", "網格策略收益率 TOP 3"),
    ("网格策略波动捕捉率 TOP 3", "网格策略收益率 TOP 3"),
    ("近 {n} 天報酬率", "近{n}天收益率"),
    ("近{n}天報酬率", "近{n}天收益率"),
    ("近 {n} 天报酬率", "近{n}天收益率"),
    ("近{n}天报酬率", "近{n}天收益率"),
    ("近{n}天平均對錯比", "近{n}天平均盈虧比"),
    ("近{n}天平均对错比", "近{n}天平均盈亏比"),
    ("平均對錯比", "平均盈虧比"),
    ("平均对错比", "平均盈亏比"),
    ("對錯比 (P/L Ratio)", "盈虧比"),
    ("对错比 (P/L Ratio)", "盈亏比"),
    ("對錯比", "盈虧比"),
    ("对错比", "盈亏比"),
    ("區間報酬率", "區間收益"),
    ("区间报酬率", "区间收益"),
    ("報酬率是這段回測窗口的累積結果，沒有年化。回撤是這段時間裡從高點掉下去最深的那一截。對錯比是平均賺的比平均虧的大多少。", "收益率是這段回測窗口的累積結果，沒有年化。回撤是這段時間裡從高點掉下去最深的那一截。盈虧比是平均賺的比平均虧的大多少。"),
    ("报酬率是这段回测窗口的累积结果，没有年化。回撤是这段时间里从高点掉下去最深的那一截。对错比是平均赚的比平均亏的大多少。", "收益率是这段回测窗口的累积结果，没有年化。回撤是这段时间里从高点掉下去最深的那一截。盈亏比是平均赚的比平均亏的大多少。"),
    ("波動捕捉率是這段回測窗口的累積Alpha，未年化", "收益率是這段回測窗口的累積結果，沒有年化。回撤是這段時間裡從高點掉下去最深的那一截。盈虧比是平均賺的比平均虧的大多少。"),
    ("波动捕捉率是这段回测窗口的累积Alpha，未年化", "收益率是这段回测窗口的累积结果，没有年化。回撤是这段时间里从高点掉下去最深的那一截。盈亏比是平均赚的比平均亏的大多少。"),
    # Sharpe / stats
    ("夏普比率 (Sharpe)", "稳不稳（数字越大越好）"),
    ("夏普比率", "稳不稳"),
    ("誰更穩（夏普排行）", "誰更穩"),
    ("谁更稳（夏普排行）", "谁更稳"),
    # mkt explain
    ("指定回測窗口內的累積Alpha，未年化", "指定回測窗口內賺了多少，沒有年化"),
    ("指定回测窗口内的累积Alpha，未年化", "指定回测窗口内赚了多少，没有年化"),
    ("基於 {d} 日回測樣本的累積Alpha，未年化", "基於 {d} 日回測樣本，沒有年化"),
    ("基于 {d} 日回测样本的累积Alpha，未年化", "基于 {d} 日回测样本，没有年化"),
    ("基於 {d} 日回測樣本，未年化", "基於 {d} 日回測樣本，沒有年化"),
    ("基于 {d} 日回测样本，未年化", "基于 {d} 日回测样本，没有年化"),
    ("本卡是 {d} 日回測窗口。樣本成交 {n} 筆，離散收斂率 {wr} pts，窗口累積Alpha {ret} pts。數字未年化。", "本卡是 {d} 日回測窗口。成交 {n} 筆，命中率 {wr} pts，這段總共 {ret} pts。沒有吹成一年。"),
    ("本卡是 {d} 日回测窗口。样本成交 {n} 笔，离散收敛率 {wr} pts，窗口累积Alpha {ret} pts。数字未年化。", "本卡是 {d} 日回测窗口。成交 {n} 笔，命中率 {wr} pts，这段总共 {ret} pts。没有吹成一年。"),
    ("失效條件寫在「適用」裡：單邊沒有來回、協整破裂、資金費率翻負，都不是再加一層格子能修好的。曲線是窗口淨值，不是實盤對帳單。", "不好用的情況也寫在「適用」裡：只漲不跌或只跌不漲、兩個幣不再一起動、持倉費變成要你付錢，加格子也救不了。曲線是這段試算的賬，不是真錢交易單。"),
    ("失效条件写在「适用」里：单边没有来回、协整破裂、资金费率翻负，都不是再加一层格子能修好的。曲线是窗口净值，不是实盘对账单。", "不好用的情况也写在「适用」里：只涨不跌或只跌不涨、两个币不再一起动、持仓费变成要你付钱，加格子也救不了。曲线是这段试算的账，不是真钱交易单。"),
    ("經典量化樣本：按訊號進出。下方數字是該回測窗口的累積Alpha，未年化。", "經典策略：有信號就買賣。下面數字是這段試算賺了多少，沒有年化。"),
    ("经典量化样本：按信号进出。下方数字是该回测窗口的累积Alpha，未年化。", "经典策略：有信号就买卖。下面数字是这段试算赚了多少，没有年化。"),
    ("曲線是窗口淨值，不是實盤對帳單。歷史樣本不保證下一窗。", "曲線是試算賬，不是真錢交易單。上一段好不代表下一段也好。"),
    ("曲线是窗口净值，不是实盘对账单。历史样本不保证下一窗。", "曲线是试算账，不是真钱交易单。上一段好不代表下一段也好。"),
    ("按方法歸類 · 寫明適用行情與回測天數 · 不作年化", "按方法分類 · 寫清楚適合什麼行情 · 試算了幾天 · 不吹成一年"),
    ("按方法归类 · 写明适用行情与回测天数 · 不作年化", "按方法分类 · 写清楚适合什么行情 · 试算了几天 · 不吹成一年"),
    # about
    ("自然語言 AI 策略編譯器 (Natural Language to Alpha)", "用人話寫策略（AI 幫你轉成規則）"),
    ("自然语言 AI 策略编译器 (Natural Language to Alpha)", "用人话写策略（AI 帮你转成规则）"),
    ("將交易直覺秒級轉化為嚴謹算法。專為金融時序優化的自然語言解析，輸入交易邏輯，自動生成帶風控約束的可執行策略代碼與離散收斂率矩陣。", "把你口頭說的交易想法，快速變成能跑的規則。輸入買賣邏輯，自動生成帶止損止盈的策略代碼和勝率表。"),
    ("将交易直觉秒级转化为严谨算法。专为金融时序优化的自然语言解析，输入交易逻辑，自动生成带风控约束的可执行策略代码与离散收敛率矩阵。", "把你口头说的交易想法，快速变成能跑的规则。输入买卖逻辑，自动生成带止损止盈的策略代码和胜率表。"),
    ("QuantAlpha 實驗室致力於將多因子量化研究框架與回測工具提供給每一位獨立研究者。", "QuantAlpha 實驗室想把「多種指標一起算」的策略工具和歷史試算，交給每一位自己研究的人。"),
    ("QuantAlpha 实验室致力于将多因子量化研究框架与回测工具提供给每一位独立研究者。", "QuantAlpha 实验室想把「多种指标一起算」的策略工具和历历史试算，交给每一位自己研究的人。"),
    ("QuantAlpha 由一群量化研究開發者、密碼學工程師與高頻交易系統架構師於 2026 年聯合發起。我們信奉代碼即法律、數學即信仰，致力於提供透明可驗證的量化研究工具，為每一位獨立交易者提供透明、去中心化且絕對私密的量化武器。", "QuantAlpha 由一群寫程序、做安全、做交易系統的人於 2026 年一起發起。我們想把策略怎麼算、怎麼試，講清楚、代碼能看，方便你自己研究。"),
    ("QuantAlpha 由一群量化研究开发者、密码学工程师与高频交易系统架构师于 2026 年联合发起。我们信奉代码即法律、数学即信仰，致力于提供透明可验证的量化研究工具，为每一位独立交易者提供透明、去中心化且绝对私密的量化武器。", "QuantAlpha 由一群写程序、做安全、做交易系统的人于 2026 年一起发起。我们想把策略怎么算、怎么试，讲清楚、代码能看，方便你自己研究。"),
    ("QuantAlpha 是獨立的量化研究與演算法編譯工具，不構成任何投資建議。虛擬資產波動劇烈，請嚴格做好部位風控。", "QuantAlpha 是獨立的策略研究和寫程序工具，不是投資建議。幣價漲跌很兇，請自己控制好倉位。"),
    ("QuantAlpha 是独立的量化研究与算法编译工具，不构成任何投资建议。虚拟资产波动剧烈，请严格做好仓位风控。", "QuantAlpha 是独立的策略研究和写程序工具，不是投资建议。币价涨跌很凶，请自己控制好仓位。"),
    # bots / fees
    ("回測於瀏覽器本機完成，含約 4bps 單邊成本假設。歷史結果不代表未來實盤收益。", "回測在你電腦瀏覽器裡完成，手續費按萬分之四左右估算。歷史結果不代表以後還能這樣賺。"),
    ("回测于浏览器本地完成，含约 4bps 单边成本假设。历史结果不代表未来实盘收益。", "回测在你电脑浏览器里完成，手续费按万分之四左右估算。历史结果不代表以后还能这样赚。"),
    ("含約 4bps 單邊成本假設", "手續費按萬分之四左右估算"),
    ("含约 4bps 单边成本假设", "手续费按万分之四左右估算"),
    ("含 4bps 來回成本", "含來回手續費（約萬分之八）"),
    ("含 4bps 来回成本", "含来回手续费（约万分之八）"),
    ("換倉手續費 4 bps（可配置）", "換一次倉手續費約萬分之四（可改）"),
    ("换仓手续费 4 bps（可配置）", "换一次仓手续费约万分之四（可改）"),
    ("參考手續費單邊 {bps} bps（萬分之{bps}）", "參考手續費單邊約萬分之四"),
    ("参考手续费单边 {bps} bps（万分之{bps}）", "参考手续费单边约万分之四"),
    # titles / misc
    ("開源量化研究終端", "開源策略研究站"),
    ("开源量化研究终端", "开源策略研究站"),
    ("量化戰情指揮部", "直播看盤室"),
    ("量化战情指挥部", "直播看盘室"),
    ("量化經典", "經典策略"),
    ("量化经典", "经典策略"),
    ("協整價差網格", "兩個幣價差網格"),
    ("协整价差网格", "两个币价差网格"),
    ("協整關係破裂", "兩個幣價格不再一起動"),
    ("协整关系破裂", "两个币价格不再一起动"),
    ("協整破裂", "兩個幣不再一起動"),
    ("协整破裂", "两个币不再一起动"),
    ("資金費率翻負", "持倉費變成要你付錢"),
    ("资金费率翻负", "持仓费变成要你付钱"),
    ("窗口淨值", "這段試算賬"),
    ("窗口净值", "这段试算账"),
    ("實盤對帳單", "真錢交易單"),
    ("实盘对账单", "真钱交易单"),
    ("未計入滑點與手續費", "沒算買賣價差和手續費"),
    ("未计入滑点与手续费", "没算买卖价差和手续费"),
    ("滑點與手續費", "買賣價差和手續費"),
    ("滑点与手续费", "买卖价差和手续费"),
    ("部位風控", "倉位風險控制"),
    ("部位缩放", "仓位风险控制"),
    ("Multi-Seat API Access", "多人一起用的權限"),
    ("開發者身分驗證", "Telegram 登入"),
    ("开发者身份验证", "Telegram 登录"),
    ("機構級仿真", "付費版演示"),
    ("机构级仿真", "付费版演示"),
    ("離散收斂率", "命中率"),
    ("离散收敛率", "命中率"),
    ("累積Alpha", "總收益"),
    ("累积Alpha", "总收益"),
    ("窗口累積Alpha", "這段總收益"),
    ("窗口累积Alpha", "这段总收益"),
    ("模擬Alpha", "模擬賺了多少"),
    ("模拟Alpha", "模拟赚了多少"),
    ("時序Alpha", "收益"),
    ("时序Alpha", "收益"),
    (" Alpha", " 收益"),
    ("波動捕捉", "賺了多少"),
    ("波动捕捉", "赚了多少"),
    ("報酬率", "收益率"),
    ("报酬率", "收益率"),
    ("未年化", "沒有年化"),
    ("量化研究", "策略研究"),
    ("量化工具", "自動算賬工具"),
    ("量化工具", "自动算账工具"),
    ("量化样本", "策略样本"),
    ("量化樣本", "策略樣本"),
    ("量化", "策略"),
    ("實盤", "真錢交易"),
    ("实盘", "真钱交易"),
]

# Don't break brand / URLs / code identifiers
SKIP_LINE_PATTERNS = [
    re.compile(r"^\s*//"),
    re.compile(r"^\s*\*"),
    re.compile(r"console\."),
    re.compile(r"import\s+"),
    re.compile(r"export\s+"),
    re.compile(r"function\s+\w+"),
    re.compile(r"QUANT_ALPHA"),
    re.compile(r"quantalpha\.space", re.I),
    re.compile(r"github\.com", re.I),
]


def should_skip_path(p: Path) -> bool:
    try:
        rel = p.relative_to(ROOT)
    except ValueError:
        return True
    if any(part in SKIP_DIRS for part in rel.parts):
        return True
    if p.name in SKIP_FILES or p.name in CONFIG_NAMES:
        return True
    if p.suffix.lower() not in SCAN_EXTS:
        return True
    if p.name.endswith(".config.js"):
        return True
    return False


def marker_for(p: Path) -> str:
    return "<!-- [PLAIN-TAG] -->" if p.suffix.lower() in {".html", ".vue"} else "// [PLAIN-TAG]"


def looks_like_ui_line(line: str) -> bool:
    if not line.strip():
        return False
    for pat in SKIP_LINE_PATTERNS:
        if pat.search(line):
            return False
    # skip pure code with lots of braces and no CJK
    if "{" in line and "}" in line and not re.search(r"[\u4e00-\u9fff]", line):
        return False
    return bool(re.search(r"[\u4e00-\u9fff]", line) or "Alpha" in line or "Sharpe" in line or "bps" in line)


def apply_pairs(text: str) -> tuple[str, list[tuple[str, str]]]:
    hits: list[tuple[str, str]] = []
    for og, lg in PAIRS:
        if og in text:
            text = text.replace(og, lg)
            hits.append((og, lg))
    return text, hits


def process_file(path: Path) -> list[str]:
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines(keepends=True)
    out_lines: list[str] = []
    log: list[str] = []
    rel = path.relative_to(ROOT).as_posix()
    changed = False
    for i, line in enumerate(lines, 1):
        if not looks_like_ui_line(line):
            out_lines.append(line)
            continue
        new_line, hits = apply_pairs(line)
        if hits and new_line != line:
            changed = True
            marker = marker_for(path) + "\n"
            if i == 1 or (out_lines and out_lines[-1].strip() not in ("// [PLAIN-TAG]", "<!-- [PLAIN-TAG] -->")):
                indent = re.match(r"^(\s*)", line)
                if indent:
                    marker = indent.group(1) + marker.strip() + "\n"
            out_lines.append(marker)
            for og, lg in hits:
                log.append(f"{rel}:{i}  {og[:60]} -> {lg[:60]}")
        out_lines.append(new_line)
    if changed:
        path.write_text("".join(out_lines), encoding="utf-8", newline="\n")
    return log


def main() -> None:
    all_logs: list[str] = []
    files = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            p = Path(dirpath) / name
            if should_skip_path(p):
                continue
            logs = process_file(p)
            if logs:
                files += 1
                all_logs.extend(logs)
    REPORT.write_text(
        f"PLAIN LANGUAGE REPORT\nFiles changed: {files}\nReplacements: {len(all_logs)}\n\n"
        + "\n".join(all_logs),
        encoding="utf-8",
    )
    print(f"done files={files} hits={len(all_logs)} report={REPORT}")


if __name__ == "__main__":
    main()
