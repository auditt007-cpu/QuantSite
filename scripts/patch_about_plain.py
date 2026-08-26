# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"E:\QuantSite\i18n.js")
t = p.read_text(encoding="utf-8")
repls = [
    (
        'aboutP1Title: "純客端極速歷史試算 (Zero-Knowledge Engine)"',
        'aboutP1Title: "在你電腦裡試策略（資料不上傳）"',
    ),
    (
        'aboutP1Body: "策略即資產，絕不離散本地。基於 WebAssembly 引擎，歷史試算計算 100 pts 在您瀏覽器本機完成，零資料上傳，徹底告別策略被盜顧慮。"',
        'aboutP1Body: "試算在你自己的瀏覽器裡跑，策略代碼不用上傳到我們伺服器，減少被別人偷看的擔心。"',
    ),
    (
        'aboutP2Body: "將交易直覺秒級轉化為嚴謹演算法。專為金融時序優化的自然語言解析，輸入交易邏輯，自動生成帶風控約束的可執行策略程式碼與命中率矩陣。"',
        'aboutP2Body: "把你口頭說的買賣想法，快速變成能跑的規則。輸入邏輯後，自動生成帶止損止盈的策略代碼和勝率表。"',
    ),
    (
        'aboutP3Title: "嚴格風控與生存哲學 (Risk Management First)"',
        'aboutP3Title: "先活下來，再談賺錢"',
    ),
    (
        'aboutP3Body: "生存是複利的前提。全站策略均內建動態部位縮放與多層級熔斷機制，經歷史極端行情壓力測試，追求平滑淨值曲線與極端情景下的動態倉位調節機制（不保證絕對盈利或本金安全）。"',
        'aboutP3Body: "虧太多要會自動停、買多少會自動調。我們用過去最慘的行情試過，但不保證以後不虧、更不保證一定賺。"',
    ),
    (
        'aboutLabBody: "QuantAlpha 由一群策略研究開發者、密碼學工程師與高頻交易系統架構師於 2026 年聯合發起。我們信奉程式碼即法律、數學即信仰，致力於提供透明可驗證的策略研究工具，為每一位獨立交易者提供透明、去中心化且絕對私密的策略武器。"',
        'aboutLabBody: "QuantAlpha 由一群寫程序、做安全、做交易系統的人於 2026 年一起發起。我們想把策略怎麼算、怎麼試，講清楚、代碼能看，方便你自己研究。"',
    ),
    (
        'aboutPaperBody: "本實驗室將機構級多因子框架壓縮為可在瀏覽器執行的規則引擎：信號生成、部位縮放與熔斷均在同一套開源路徑上重現。白皮書級說明見開源目錄與 Pine / Grademark 原始碼，拒絕黑箱曲線。"',
        'aboutPaperBody: "我們把很多指標合在一起算，壓成能在瀏覽器跑的規則：什麼時候買、買多少、虧太多就停，代碼都公開，不給你看不懂的黑箱曲線。"',
    ),
    (
        'aboutLead: "QuantAlpha 實驗室致力於將多因子策略研究框架提供給每一位獨立研究者。"',
        'aboutLead: "QuantAlpha 實驗室想把「多種指標一起算」的策略工具和歷史試算，交給每一位自己研究的人。"',
    ),
    ('botSharpe: "稳不稳（数字越大越好）"', 'botSharpe: "穩不穩（數字越大越好）"'),
    (
        'aboutP1Title: "纯客端极速历史试算 (Zero-Knowledge Engine)"',
        'aboutP1Title: "在你电脑里试策略（资料不上传）"',
    ),
    (
        'aboutP1Body: "策略即资产，绝不离散本地。基于 WebAssembly 引擎，历史试算计算 100 pts 在您浏览器本地完成，零数据上传，彻底告别策略被盗顾虑。"',
        'aboutP1Body: "试算在你自己的浏览器里跑，策略代码不用上传到服务器，减少被别人偷看的担心。"',
    ),
    (
        'aboutP3Title: "严格风控与生存哲学 (Risk Management First)"',
        'aboutP3Title: "先活下来，再谈赚钱"',
    ),
    (
        'aboutP3Body: "生存是复利的前提。全站策略均内置动态仓位缩放与多层级熔断机制，经历史极端行情压力测试，追求平滑净值曲线与极端情景下的动态仓位调节机制（不保证绝对盈利或本金安全）。"',
        'aboutP3Body: "亏太多要会自动停、买多少会自动调。我们用过去最惨的行情试过，但不保证以后不亏、更不保证一定赚。"',
    ),
    (
        'aboutLead: "QuantAlpha 实验室致力于将多因子策略研究框架提供给每一位独立研究者。"',
        'aboutLead: "QuantAlpha 实验室想把「多种指标一起算」的策略工具和历史试算，交给每一位自己研究的人。"',
    ),
    (
        'aboutBrandSub: "理性、数学与代码 —— 赋能独立交易者的端侧策略基础设施"',
        'aboutBrandSub: "用数学和代码，帮你自己研究策略、自己盯盘"',
    ),
    (
        'aboutHero: "拒绝情绪交易，让每一次开仓都有数学期望支持"',
        'aboutHero: "少靠冲动下单，多用规则和数据说话"',
    ),
]
for a, b in repls:
    if a not in t:
        print("MISS", a[:60])
    else:
        t = t.replace(a, b)
p.write_text(t, encoding="utf-8", newline="\n")
print("ok")
