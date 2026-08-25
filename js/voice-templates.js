/**
 * Persona voice templates + promo asset map for live-room TTS.
 * zh-CN ≈ 实战止损轮播 / 京味开仓；en ≈ Trump 演说风；zh-Hant ≈ 台妹急促止损轮播 + 曉臻开仓.
 * Runtime TTS uses hub Edge-TTS (MP3): zh-CN Yunyang / en Christopher / zh-TW HsiaoChen.
 * Idle ads use pre-rendered /audio/promo_*.mp3.
 */
(function (root) {
  const STOP_LOSS_ZH_CN = [
    "{symbol} 触碰止损红线，全体平仓！风控第一，撤！",
    "{symbol} 破位下杀，多头防线失守！立刻止损，兄弟们快跑！",
    "警报！{symbol} 触发紧急止损！空头偷袭，立刻砍仓离场！",
    "撤退信号！{symbol} 触发被动平仓，保留火种，严禁硬扛！",
    "娘希匹！{symbol} 战局逆转，触发止损！全员立刻后撤，转进防守！",
    "前线告急！{symbol} 触及防守底线，断然平仓！留得青山，务求再战！",
    "{symbol} 走势不对劲，触发止损线了！风紧扯呼，先撤出来观望！",
    "注意！{symbol} 策略认赔出局！这波庄家太狠，割肉保命，快闪！",
    "啊！{symbol} 跌破止损了啦！快点跑快点跑，不要再硬撑了吼！",
    "天哪！{symbol} 触发停损警报！大家先把单子平掉，听话快撤啦！",
  ];

  const STOP_LOSS_ZH_HANT = [
    "{symbol} 觸碰止損紅線，全體平倉！風控第一，撤！",
    "{symbol} 破位下殺，多頭防線失守！立刻止損，兄弟們快跑！",
    "警報！{symbol} 觸發緊急止損！空頭偷襲，立刻砍倉離場！",
    "撤退信號！{symbol} 觸發被動平倉，保留火種，嚴禁硬扛！",
    "娘希匹！{symbol} 戰局逆轉，觸發止損！全員立刻後撤，轉進防守！",
    "前線告急！{symbol} 觸及防守底線，斷然平倉！留得青山，務求再戰！",
    "{symbol} 走勢不對勁，觸發止損線了！風緊扯呼，先撤出來觀望！",
    "注意！{symbol} 策略認賠出局！這波莊家太狠，割肉保命，快閃！",
    "啊！{symbol} 跌破止損了啦！快點跑快點跑，不要再硬撐了吼！",
    "天哪！{symbol} 觸發停損警報！大家先把單子平掉，聽話快撤啦！",
  ];

  const stopLossIdx = { "zh-CN": 0, "zh-Hant": 0 };

  function fillSymbol(tpl, sym) {
    return String(tpl || "").replace(/\{symbol\}/g, sym || "標的");
  }

  function nextStopLoss(lang, sym) {
    const key = lang === "zh-CN" ? "zh-CN" : "zh-Hant";
    const pool = key === "zh-CN" ? STOP_LOSS_ZH_CN : STOP_LOSS_ZH_HANT;
    const i = stopLossIdx[key] % pool.length;
    stopLossIdx[key] = i + 1;
    return fillSymbol(pool[i], sym || (key === "zh-CN" ? "标的" : "標的"));
  }

  const VOICE_TEMPLATES = {
    "zh-CN": {
      LONG: function (sym, price) {
        return "得嘞！" + sym + " 探底回升发出多头信号！现价 " + price + "，顺势抬一手，列位坐稳咯！";
      },
      SHORT: function (sym, price) {
        return "注意着点儿！" + sym + " 上冲乏力发出做空信号！现价 " + price + "，空单准备进场，切莫贪杯！";
      },
      TAKE_PROFIT: function (sym, pnl) {
        return "哎呦喂！" + sym + " 止盈出场，大赚 " + pnl + "%！落袋为安，今儿个晚饭必须加个硬菜！";
      },
      STOP_LOSS: function (sym) {
        return nextStopLoss("zh-CN", sym);
      },
      CLOSE: function (sym) {
        return sym + " 平仓离场，稳字当头，咱们接着听下一出！";
      },
      ALERT: function (sym) {
        return "整点报时！主流币波动加剧，" + (sym || "盘面") + " 突然放量，都把精神头提起来，盯紧盘面！";
      },
      STORM: function () {
        return "列位注意！当前大面积整点异动，多套策略齐开花，赶紧盯紧战情面板！";
      },
    },
    en: {
      LONG: function (sym, price) {
        return (
          "Breaking news! " +
          sym +
          " is looking tremendous. Buy signal at " +
          price +
          ". We are going long, folks, and we are going to WIN big!"
        );
      },
      SHORT: function (sym, price) {
        return (
          "Total weakness on " +
          sym +
          "! Short signal active at " +
          price +
          ". The dump is real, believe me. Take the short side right now!"
        );
      },
      TAKE_PROFIT: function (sym, pnl) {
        return (
          "Massive profit on " +
          sym +
          "! Up " +
          pnl +
          "%, absolutely huge! Nobody makes gains like our algorithms. Make Your Portfolio Great Again!"
        );
      },
      STOP_LOSS: function (sym) {
        return (
          "Stop loss executed on " +
          sym +
          ". Very disciplined, very smart risk management. We protect the capital and strike back!"
        );
      },
      CLOSE: function (sym) {
        return sym + " position closed. Clean exit. We move on and we WIN again!";
      },
      ALERT: function (sym) {
        return (
          "Market Alert! Huge volume spike on " +
          (sym || "majors") +
          ". The volatility is unbelievable, stay sharp everyone!"
        );
      },
      STORM: function () {
        return "Huge market storm right now! Multiple strategies firing at once. Check the war board immediately!";
      },
    },
    "zh-Hant": {
      LONG: function (sym, price) {
        return "即時信號：" + sym + " 觸發多頭動量突破，現價 " + price + "，建議關注進場時機。";
      },
      SHORT: function (sym, price) {
        return "即時信號：" + sym + " 破位觸發做空信號，現價 " + price + "。";
      },
      TAKE_PROFIT: function (sym, pnl) {
        return "交易結算：" + sym + " 達成目標止盈，獲利 " + pnl + "%。";
      },
      STOP_LOSS: function (sym) {
        return nextStopLoss("zh-Hant", sym);
      },
      CLOSE: function (sym) {
        return "交易結算：" + sym + " 平倉離場。";
      },
      ALERT: function (sym) {
        return "異動監控：" + (sym || "市場") + " 出現時序放量波動。";
      },
      STORM: function () {
        return "當前發生大面積整點異動，已觸發多套策略，請查閱戰情面板。";
      },
    },
  };

  const PROMO_SRC = {
    "zh-CN": "./audio/promo_zh_cn.mp3",
    en: "./audio/promo_en_us.mp3",
    "zh-Hant": "./audio/promo_zh_tw.mp3",
  };

  function normalizeLang(raw) {
    const s = String(raw || "").trim();
    if (s === "zh-Hans" || s === "zh-CN" || s === "zh") return "zh-CN";
    if (s === "en" || s === "en-US" || s === "en-GB") return "en";
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
    en: "en-US-ChristopherNeural",
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

  function speechConfig(lang) {
    const key = normalizeLang(lang || currentVoiceLang());
    if (key === "zh-CN") {
      return {
        lang: "zh-CN",
        edgeVoice: EDGE_VOICE["zh-CN"],
        rate: "-5%",
        pitch: "-8Hz",
        prefer: [/Yunyang/i, /Yunjian/i, /Yunxi/i, /Kangkang/i, /zh-CN.*Neural.*Male/i, /zh-CN/i],
      };
    }
    if (key === "en") {
      return {
        lang: "en-US",
        edgeVoice: EDGE_VOICE.en,
        rate: "-3%",
        pitch: "-5Hz",
        prefer: [/Christopher/i, /Eric/i, /Steffan/i, /Guy/i, /Davis/i, /David/i, /en-US.*Neural.*Male/i, /en-US/i],
      };
    }
    return {
      lang: "zh-TW",
      edgeVoice: EDGE_VOICE["zh-Hant"],
      rate: "+8%",
      pitch: "+0Hz",
      prefer: [/HsiaoChen/i, /曉臻/, /zh-TW-HsiaoChenNeural/i, /zh-TW/i, /Taiwan/i],
    };
  }

  function pickSpeechVoice(voices, lang) {
    const list = voices || [];
    if (!list.length) return null;
    const cfg = speechConfig(lang);
    const males = list.filter((v) => !isFemaleVoiceName(v.name, cfg.lang));
    const pool = males.length ? males : list;
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
