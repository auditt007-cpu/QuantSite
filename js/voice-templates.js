/**
 * Persona voice templates + promo asset map for live-room TTS.
 * zh-CN ≈ 35岁大陆金融精英男；zh-Hant ≈ 28岁台湾甜妹女职员；en ≈ Trump 演说风.
 * Runtime TTS: Edge Yunyang / Christopher / HsiaoChen；语速约为原配置 1.2 倍.
 * Idle ads: /audio/promo_*.mp3.
 */
(function (root) {
  /* ---- rotating pools (10 each, no repeat within cycle) ---- */
  const POOLS = {
    "zh-CN": {
      LONG: [
        "{symbol} 多头结构确认，现价 {price}。仓位按计划抬升，纪律进场。",
        "注意，{symbol} 出现买入力道，现价 {price}。顺势做多，止损先设好。",
        "{symbol} 突破关键压力，现价 {price}。多单信号生效，别追高潮位。",
        "盘面给机会了：{symbol} 多头信号，现价 {price}。分批建仓，别一把梭。",
        "{symbol} 回踩后重新抬头，现价 {price}。这是干净的多头入场点。",
        "策略提示：{symbol} 触发做多，现价 {price}。执行计划，情绪靠边。",
        "{symbol} 量价配合向上，现价 {price}。多单开仓，盯紧失效位。",
        "看好短线弹性：{symbol} 多头点火，现价 {price}。进场后立刻管理风险。",
        "{symbol} 低吸逻辑成立，现价 {price}。多单就位，别因为犹豫错过节奏。",
        "同步一下：{symbol} 发出多头指令，现价 {price}。按模型仓位执行即可。",
      ],
      SHORT: [
        "{symbol} 上攻乏力，现价 {price}。空头信号确认，准备做空。",
        "注意风险翻转：{symbol} 破位下行，现价 {price}。空单按计划进场。",
        "{symbol} 高位滞涨，现价 {price}。这是偏干净的空头结构。",
        "策略提示：{symbol} 触发做空，现价 {price}。别跟情绪硬扛多头。",
        "{symbol} 量能衰减向下，现价 {price}。空单就位，止损放在失效位上方。",
        "{symbol} 跌破关键支撑，现价 {price}。空头主导，分批布局。",
        "盘面转弱：{symbol} 空头信号，现价 {price}。执行做空，控制杠杆。",
        "{symbol} 反弹无力，现价 {price}。顺势空，不赌V反。",
        "{symbol} 空头动能增强，现价 {price}。开空，盯回补风险。",
        "同步：{symbol} 发出做空指令，现价 {price}。按风控规则进场。",
      ],
      TAKE_PROFIT: [
        // [REPLACE-TAG]
        "{symbol} 目标到位，触发平仓条件，模拟Alpha {pnl} pts。策略执行完成。",
        // [REPLACE-TAG]
        "结算：{symbol} 触及预设平仓条件，模拟Alpha {pnl} pts。执行纪律良好。",
        // [REPLACE-TAG]
        "{symbol} 兑现利润 {pnl} pts。这一笔执行合格，继续下一枪。",
        // [REPLACE-TAG]
        "平仓触发：{symbol} 模拟Alpha {pnl} pts。锁定仿真结果。",
        // [REPLACE-TAG]
        "{symbol} 到达预设目标，平仓模拟Alpha {pnl} pts。纪律执行。",
        // [REPLACE-TAG]
        "不错，{symbol} 平仓成交，模拟Alpha {pnl} pts。曲线反映回测数据。",
        // [REPLACE-TAG]
        "{symbol} 利润回撤前离场，锁定 {pnl} pts。这才是职业做法。",
        // [REPLACE-TAG]
        "提醒：{symbol} 平仓完成，模拟Alpha {pnl} pts。准备下一次仿真。",
        // [REPLACE-TAG]
        "{symbol} 阶段性目标达成，模拟Alpha {pnl} pts。此段仿真结束。",
        // [REPLACE-TAG]
        "同步结果：{symbol} 平仓出局，模拟Alpha {pnl} pts。风控与执行仿真完成。",
      ],
      STOP_LOSS: [
        "{symbol} 触发止损。认赔离场，本金优先，下一笔再说。",
        "风控生效：{symbol} 止损平仓。错了就停，这是专业。",
        "{symbol} 结构失效，止损出场。小亏可接受，硬扛不可接受。",
        "注意，{symbol} 触及防守线，已被动平仓。留子弹，不留情绪。",
        "{symbol} 止损成交。这笔交易结束，复盘以后再战。",
        "同步：{symbol} 风险阈值击穿，砍仓离场。活着比面子重要。",
        "{symbol} 走势与预期相反，止损执行完毕。纪律大于观点。",
        "{symbol} 防守失败，止损清仓。把损失定格在计划内。",
        "提醒：{symbol} 触发止损机制。该撤就撤，账户才能走远。",
        "{symbol} 被动平仓完成。止损不是失败，是门票。",
      ],
      CLOSE: [
        "{symbol} 仓位关闭。中性离场，等待下一个清晰信号。",
        "{symbol} 平仓完成。先空仓观望，不勉强留仓。",
        "同步：{symbol} 主动平仓。节奏重置，下一笔再评估。",
        "{symbol} 离场。这笔交易闭环，注意力回到盘面。",
        "{symbol} 仓位清零。不恋战，保持机动。",
        "提醒：{symbol} 平仓指令已执行。现金为王这一小段。",
        "{symbol} 交易结束。先出来，比猜方向更重要。",
        "{symbol} 中性结算离场。等待更好的赔率。",
        "{symbol} 平仓到位。账户回到待命状态。",
        "同步结果：{symbol} 已平仓。下一信号见。",
      ],
      ALERT: [
        "异动提醒：{symbol} 放量波动加剧，盯紧盘面。",
        "注意，{symbol} 短时波动抬升，别被噪音带走仓位。",
        "{symbol} 出现异常波动。先观察，再决定加减仓。",
        "警报：主流品种里 {symbol} 量能突增，提高警惕。",
        "{symbol} 波动率跳升。风控参数检查一遍。",
        "盘面提示：{symbol} 异动中。滑点与冲击成本会上升。",
        "{symbol} 短线动能突变，保持专注。",
        "提醒：{symbol} 波动加剧，避免情绪化追单。",
        "{symbol} 出现脉冲行情。先看结构，再动手。",
        "同步：{symbol} 异动监控触发，请回到战情面板。",
      ],
      STORM: [
        "当前多策略同时点火，盘面拥挤。先看战情面板，别逐条追。",
        "警报：大面积整点异动，信号扎堆。优先级管理，稳住。",
        "风暴模式：多品种共振。降低操作频率，只抓主线。",
        "注意，策略集群触发。先确认风控总敞口。",
        "同步：行情进入高密度信号段。面板为先，耳朵为辅。",
        "多空信号并发，市场噪音上升。执行要更挑剔。",
        "整点风暴来了。别被连续提示打断节奏。",
        "当前是信号潮汐，不是单笔交易。回到总览再决策。",
        "提醒：多套策略同时生效。仓位总和先算清楚。",
        "战情升级：大面积触发。保持冷静，按清单处理。",
      ],
    },
    "zh-Hant": {
      LONG: [
        "欸！{symbol} 出現做多訊號喔，現價 {price}，可以留意進場時機啦！",
        "{symbol} 往上有動能耶，現價 {price}，多單機會來了吼！",
        "提醒你一下：{symbol} 觸發多頭，現價 {price}，別猶豫太久喔！",
        "哇，{symbol} 看起來要攻了，現價 {price}，順勢做多可以考慮！",
        "{symbol} 多頭訊號亮起，現價 {price}，記得先設停損再進場啦！",
        "快看！{symbol} 買盤變強，現價 {price}，這波多單值得盯！",
        "{symbol} 回檔後又抬頭囉，現價 {price}，做多節奏滿乾淨的！",
        "欸欸，{symbol} 策略喊多，現價 {price}，按計畫執行就好！",
        "{symbol} 突破關鍵位置，現價 {price}，多單準備接一下吼！",
        "同步一下：{symbol} 開多訊號，現價 {price}，大家盯緊喔！",
      ],
      SHORT: [
        "欸注意！{symbol} 轉弱了，現價 {price}，做空訊號出現啦！",
        "{symbol} 上攻沒力耶，現價 {price}，空單可以準備！",
        "提醒：{symbol} 破位下行，現價 {price}，別再硬扛多單吼！",
        "{symbol} 高位滯漲，現價 {price}，這空單結構還不錯喔！",
        "快看，{symbol} 觸發做空，現價 {price}，風控先放好！",
        "{symbol} 賣壓變重了，現價 {price}，順勢空比較安心啦！",
        "欸，{symbol} 支撐不住，現價 {price}，空單訊號確認！",
        "{symbol} 反彈很無力耶，現價 {price}，不要賭V轉吼！",
        "{symbol} 空頭動能起來了，現價 {price}，可以留意空單！",
        "同步：{symbol} 開空訊號，現價 {price}，大家小心倉位喔！",
      ],
      TAKE_PROFIT: [
        // [REPLACE-TAG]
        "耶！{symbol} 止盈到了，賺 {pnl} pts，先落袋為安啦！",
        // [REPLACE-TAG]
        "太好了，{symbol} 達標出場，獲利 {pnl} pts，今晚可以開心一點！",
        // [REPLACE-TAG]
        "{symbol} 停利成交，賺了 {pnl} pts，執行得很漂亮吼！",
        // [REPLACE-TAG]
        "提醒你：{symbol} 利潤鎖住 {pnl} pts，該收就收，不要貪！",
        // [REPLACE-TAG]
        "哇塞，{symbol} 止盈成功，回報 {pnl} pts，帳戶有說話耶！",
        // [REPLACE-TAG]
        "{symbol} 目標價碰到了，獲利 {pnl} pts，先把戰果收起來！",
        // [REPLACE-TAG]
        "欸嘿，{symbol} 停利離場，賺 {pnl} pts，下一段再來！",
        // [REPLACE-TAG]
        "{symbol} 利潤保護成功，鎖定 {pnl} pts，這才是好習慣啦！",
        // [REPLACE-TAG]
        "同步結果：{symbol} 平倉完成，模擬Alpha {pnl} pts。",
        // [REPLACE-TAG]
        "{symbol} 達標平倉，到手 {pnl} pts，情緒歸零準備下一筆喔！",
      ],
      STOP_LOSS: [
        "啊！{symbol} 碰到停損了，先平掉啦，保本金比較重要！",
        "欸不行了，{symbol} 觸發停損，快撤，不要硬撐吼！",
        "{symbol} 方向反了，停損出場。小虧沒關係，活著最重要！",
        "提醒：{symbol} 防守線破掉，已自動平倉，先深呼吸一下！",
        "天哪，{symbol} 停損成交了。認賠離場，下一筆再來！",
        "{symbol} 風險爆掉，砍倉走人。聽話，別跟行情賭氣啦！",
        "欸欸，{symbol} 結構失效，停損執行完畢，先退場觀望！",
        "{symbol} 跌破停損位，平倉保命。留得本金在，不怕沒行情！",
        "同步：{symbol} 被動停損。這不是丟臉，是紀律喔！",
        "{symbol} 停損警報解除前先離場。乖，先出來再說！",
      ],
      CLOSE: [
        "{symbol} 平倉完成囉，先空手等一下下！",
        "欸，{symbol} 倉位關掉了，等下一個清楚訊號再進！",
        "{symbol} 離場完成，先喘口氣，不要急著追！",
        "提醒：{symbol} 中性平倉，帳戶先回到待命狀態！",
        "{symbol} 交易結束啦，注意力放回盤面就好！",
        "同步一下：{symbol} 已平倉，現金多一點比較安心！",
        "{symbol} 主動出場，不戀戰，這樣才長久吼！",
        "{symbol} 倉位清零，等待更好的進場點！",
        "{symbol} 平倉到位，下一訊號見喔！",
        "好，{symbol} 已關單，節奏重置，大家放輕鬆！",
      ],
      ALERT: [
        "欸注意！{symbol} 波動變大了，盯緊一點吼！",
        "{symbol} 突然放量耶，先不要追著情緒下單！",
        "提醒：{symbol} 異動中，滑點可能變大，小心！",
        "哇，{symbol} 短線跳來跳去，先觀察再動手啦！",
        "{symbol} 波動率升起來了，風控檢查一下喔！",
        "快看，{symbol} 量能異常，提高警覺！",
        "{symbol} 脈衝行情出現，別被嚇到亂砍或亂追！",
        "欸欸，{symbol} 異動警報，回戰情面板看一下！",
        "{symbol} 盤面變吵了，操作節奏放慢一點！",
        "同步：{symbol} 異動監控觸發，大家專心一點喔！",
      ],
      STORM: [
        "天哪，訊號一次出好多！先看戰情面板，別逐條追啦！",
        "欸亂了亂了，多策略一起響，先算總倉位吼！",
        "風暴模式來了，市場很吵，只抓主線就好！",
        "提醒：大面積異動中，操作頻率先降下來！",
        "哇塞，訊號潮汐耶，耳朵當輔助，眼睛看總覽！",
        "現在很多品種同時動，冷靜，按清單處理！",
        "欸欸，整點風暴，不要被連續提示帶跑！",
        "多空訊號塞車了，優先級先排好再動手！",
        "同步：戰情升級，先確認風險敞口再交易！",
        "大家深呼吸！訊號很多，但我們只要最清楚的那幾筆！",
      ],
    },
  };

  const poolIdx = {};

  function fillTpl(tpl, vars) {
    return String(tpl || "")
      .replace(/\{symbol\}/g, vars.symbol || "")
      .replace(/\{price\}/g, vars.price || "")
      .replace(/\{pnl\}/g, vars.pnl || "");
  }

  function nextLine(lang, kind, vars) {
    const key = lang === "zh-CN" ? "zh-CN" : "zh-Hant";
    const pack = POOLS[key] || POOLS["zh-Hant"];
    const pool = pack[kind] || pack.ALERT;
    const idxKey = key + ":" + kind;
    const i = (poolIdx[idxKey] || 0) % pool.length;
    poolIdx[idxKey] = i + 1;
    const fallbackSym = key === "zh-CN" ? "标的" : "標的";
    return fillTpl(pool[i], {
      symbol: vars.symbol || fallbackSym,
      price: vars.price || "",
      pnl: vars.pnl || "",
    });
  }

  function makeRotators(lang) {
    return {
      LONG: function (sym, price) {
        return nextLine(lang, "LONG", { symbol: sym, price: price });
      },
      SHORT: function (sym, price) {
        return nextLine(lang, "SHORT", { symbol: sym, price: price });
      },
      TAKE_PROFIT: function (sym, pnl) {
        return nextLine(lang, "TAKE_PROFIT", { symbol: sym, pnl: pnl });
      },
      STOP_LOSS: function (sym) {
        return nextLine(lang, "STOP_LOSS", { symbol: sym });
      },
      CLOSE: function (sym) {
        return nextLine(lang, "CLOSE", { symbol: sym });
      },
      ALERT: function (sym) {
        return nextLine(lang, "ALERT", { symbol: sym || (lang === "zh-CN" ? "盘面" : "盤面") });
      },
      STORM: function () {
        return nextLine(lang, "STORM", {});
      },
    };
  }

  const VOICE_TEMPLATES = {
    "zh-CN": makeRotators("zh-CN"),
    "zh-Hant": makeRotators("zh-Hant"),
  };

  const PROMO_SRC = {
    "zh-CN": "./audio/promo_zh_cn.mp3",
    "zh-Hant": "./audio/promo_zh_tw.mp3",
  };

  function normalizeLang(raw) {
    const s = String(raw || "").trim();
    if (s === "zh-Hans" || s === "zh-CN" || s === "zh") return "zh-CN";
    if (s === "en" || s === "en-US" || s === "en-GB") return "zh-Hant";
    if (s === "zh-Hant" || s === "zh-TW" || s === "zh-HK") return "zh-Hant";
    return "zh-Hant";
  }

  function currentVoiceLang() {
    if (root.QALang && typeof root.QALang.current === "function") {
      try {
        return normalizeLang(root.QALang.current());
      } catch {
        /* fall through */
      }
    }
    try {
      return normalizeLang(
        localStorage.getItem("quant_lang") || localStorage.getItem("user_lang") || "zh-Hant"
      );
    } catch {
      return "zh-Hant";
    }
  }

  function pack(lang) {
    return VOICE_TEMPLATES[normalizeLang(lang)] || VOICE_TEMPLATES["zh-Hant"];
  }

  function promoSrc(lang) {
    const key = normalizeLang(lang || currentVoiceLang());
    return PROMO_SRC[key] || PROMO_SRC["zh-Hant"];
  }

  const EDGE_VOICE = {
    "zh-CN": "zh-CN-YunyangNeural",
    "zh-Hant": "zh-TW-HsiaoChenNeural",
  };

  function isFemaleVoiceName(name, lang) {
    const blob = String(name || "").toLowerCase();
    if (/female|女/.test(blob)) return true;
    if (/xiaoxiao|xiaoyi|huihui|yaoyao|hanhan|meijia|tingting|linda|heera|helen|amy|emma|samantha|victoria|zira|susan|karen|moira|tessa|fiona|veena|lekha|catherine|laura|sara|jenny|aria|sabina|hazel|heather|michelle|sonia|libby|mia|olivia|natasha|yuna|yukari|nanami|hsiaoyu|hsiaochen.*female/i.test(blob)) {
      return true;
    }
    if (lang === "zh-CN" && /xiaoxiao|xiaoyi|xiaomo|xiaorui|xiaoshuang|xiaoyan|xiaochen(?!neural)/i.test(blob)) return true;
    return false;
  }

    /* 语速：简中保持 1.2×；繁中在 1.2× 基础上再减慢 10 pts（+30 pts → +17 pts） */
  function speechConfig(lang) {
    const key = normalizeLang(lang || currentVoiceLang());
    if (key === "zh-CN") {
      return {
        lang: "zh-CN",
        edgeVoice: EDGE_VOICE["zh-CN"],
        rate: "+14%",
        pitch: "-8Hz",
        prefer: [/Yunyang/i, /Yunjian/i, /Yunxi/i, /Kangkang/i, /zh-CN.*Neural.*Male/i, /zh-CN/i],
      };
    }
    return {
      lang: "zh-TW",
      edgeVoice: EDGE_VOICE["zh-Hant"],
      rate: "+17%",
      pitch: "+0Hz",
      prefer: [/HsiaoChen/i, /曉臻/, /zh-TW-HsiaoChenNeural/i, /zh-TW/i, /Taiwan/i],
    };
  }

  function pickSpeechVoice(voices, lang) {
    const list = voices || [];
    if (!list.length) return null;
    const cfg = speechConfig(lang);
    const key = normalizeLang(lang);
    /* 台湾甜妹：优先女声；大陆精英男：优先男声 */
    let pool = list;
    if (key === "zh-Hant") {
      const females = list.filter((v) => isFemaleVoiceName(v.name, cfg.lang));
      if (females.length) pool = females;
    } else {
      const males = list.filter((v) => !isFemaleVoiceName(v.name, cfg.lang));
      if (males.length) pool = males;
    }
    for (let i = 0; i < cfg.prefer.length; i += 1) {
      const re = cfg.prefer[i];
      const hit = pool.find((v) => re.test((v.name || "") + " " + (v.lang || "")));
      if (hit) return hit;
    }
    const exact = pool.find((v) => (v.lang || "").toLowerCase().replace("_", "-") === cfg.lang.toLowerCase());
    if (exact) return exact;
    const prefix = cfg.lang.slice(0, 2);
    return pool.find((v) => (v.lang || "").toLowerCase().indexOf(prefix) === 0) || null;
  }

  function edgeVoiceFor(lang) {
    const key = normalizeLang(lang || currentVoiceLang());
    return EDGE_VOICE[key] || EDGE_VOICE["zh-Hant"];
  }

  function line(kind, lang, a, b) {
    const p = pack(lang);
    const fn = p[kind] || p.ALERT;
    return typeof fn === "function" ? fn(a, b) : "";
  }

  root.QAVoiceTemplates = {
    VOICE_TEMPLATES: VOICE_TEMPLATES,
    POOLS: POOLS,
    normalizeLang: normalizeLang,
    currentVoiceLang: currentVoiceLang,
    pack: pack,
    promoSrc: promoSrc,
    speechConfig: speechConfig,
    pickSpeechVoice: pickSpeechVoice,
    edgeVoiceFor: edgeVoiceFor,
    line: line,
  };
})(typeof window !== "undefined" ? window : globalThis);
