/**
 * Persona voice templates + promo asset map for live-room TTS.
 * zh-CN ≈ 相声京味文案；en ≈ Trump 演说风文案；zh-Hant ≈ 曉臻专业播报。
 * Runtime TTS uses Web Speech voices (Edge/Azure neural when available).
 * Idle ads use pre-rendered /audio/promo_*.mp3.
 */
(function (root) {
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
        return "没关系啊，" + sym + " 触发止损！留得青山在，不怕没柴烧，咱下把再战！";
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
        return "風險控制：" + sym + " 觸發防守止損離場。";
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

  function speechConfig(lang) {
    const key = normalizeLang(lang || currentVoiceLang());
    if (key === "zh-CN") {
      return {
        lang: "zh-CN",
        rate: 1.05,
        pitch: 0.95,
        prefer: [/Yunjian/i, /Yunxi/i, /Kangkang/i, /Xiaoyi/i, /zh-CN/i, /Chinese/i],
      };
    }
    if (key === "en") {
      return {
        lang: "en-US",
        rate: 1.1,
        pitch: 1.05,
        prefer: [/Guy/i, /Christopher/i, /Davis/i, /Eric/i, /David/i, /en-US/i, /English/i],
      };
    }
    return {
      lang: "zh-TW",
      rate: 1.08,
      pitch: 1.0,
      prefer: [/HsiaoChen/i, /曉臻/, /zh-TW-HsiaoChenNeural/i, /zh-TW/i, /Taiwan/i, /Hanhan/i],
    };
  }

  function pickSpeechVoice(voices, lang) {
    const list = voices || [];
    if (!list.length) return null;
    const cfg = speechConfig(lang);
    for (let i = 0; i < cfg.prefer.length; i += 1) {
      const re = cfg.prefer[i];
      const hit = list.find((v) => re.test((v.name || "") + " " + (v.lang || "")));
      if (hit) return hit;
    }
    const exact = list.find((v) => (v.lang || "").toLowerCase().replace("_", "-") === cfg.lang.toLowerCase());
    if (exact) return exact;
    const prefix = cfg.lang.slice(0, 2);
    return list.find((v) => (v.lang || "").toLowerCase().indexOf(prefix) === 0) || null;
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
    line: line,
  };
})(typeof window !== "undefined" ? window : globalThis);
