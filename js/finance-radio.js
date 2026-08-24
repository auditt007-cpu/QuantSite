/* 24H Global Financial Radio — isolated from signal/voice audio in live-room.js */
(function (root) {
  "use strict";

  var STORAGE_KEY = "qa_finance_radio";
  var STALL_MS = 5000;
  var DEFAULT_VOLUME = 0.22;

  /* HTML5 <audio> needs MP3/AAC — HLS/m3u8 is skipped. Sources probed 2026-08. */
  var STREAMS = {
    cn: [
      { label: "第一财经", url: "https://lhttp.qingting.fm/live/276/64k.mp3" },
      { label: "广东股市广播", url: "https://lhttp.qingting.fm/live/4847/64k.mp3" },
      { label: "东广新闻台", url: "https://lhttp.qingting.fm/live/275/64k.mp3" },
    ],
    en: [
      { label: "Bloomberg Radio", url: "https://playerservices.streamtheworld.com/api/livestream-redirect/WBBRAMAAC48.aac" },
      { label: "BBC World Service", url: "https://stream.live.vc.bbcmedia.co.uk/bbc_world_service" },
      { label: "NPR News", url: "https://npr-ice.streamguys1.com/live.mp3" },
    ],
  };

  var audio = null;
  var lang = "cn";
  var streamIdx = 0;
  var enabled = false;
  var stallTimer = null;
  var userPaused = true;

  function t(key) {
    return root.QALang && typeof root.QALang.t === "function" ? root.QALang.t(key) : key;
  }

  function langFromPage() {
    var pack = "";
    try {
      if (root.QALang && typeof root.QALang.current === "function") pack = root.QALang.current();
    } catch (e) {
      pack = "";
    }
    if (!pack && document.documentElement) pack = document.documentElement.lang || "";
    return String(pack).indexOf("en") === 0 ? "en" : "cn";
  }

  function loadPrefs() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (typeof raw.enabled === "boolean") enabled = raw.enabled;
      if (typeof raw.userPaused === "boolean") userPaused = raw.userPaused;
    } catch (e) {
      /* ignore */
    }
    lang = langFromPage();
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: enabled, userPaused: userPaused }));
    } catch (e) {
      /* ignore */
    }
  }

  function streams() {
    return STREAMS[lang] || STREAMS.cn;
  }

  function currentStation() {
    var list = streams();
    if (!list.length) return null;
    return list[streamIdx % list.length];
  }

  function clearStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  }

  function scheduleStallWatch() {
    clearStallTimer();
    stallTimer = setTimeout(function () {
      if (!enabled || userPaused) return;
      rotateStream(true);
    }, STALL_MS);
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "none";
    /* Do not set crossOrigin — Qingting/QTFM streams omit CORS and would fail. */
    audio.volume = DEFAULT_VOLUME;
    audio.addEventListener("playing", scheduleStallWatch);
    audio.addEventListener("timeupdate", scheduleStallWatch);
    audio.addEventListener("error", function () {
      if (enabled && !userPaused) rotateStream(true);
    });
    audio.addEventListener("stalled", function () {
      scheduleStallWatch();
    });
    audio.addEventListener("ended", function () {
      if (enabled && !userPaused) rotateStream(true);
    });
    return audio;
  }

  function paintUi() {
    var toggle = document.getElementById("financeRadioToggle");
    var dock = document.getElementById("financeRadioDock");
    var station = document.getElementById("financeRadioStation");
    if (toggle) {
      toggle.setAttribute("aria-pressed", enabled && !userPaused ? "true" : "false");
      toggle.textContent = enabled && !userPaused ? t("financeRadioOn") : t("financeRadioOff");
    }
    if (dock) dock.classList.toggle("is-live", enabled && !userPaused);
    if (station) {
      var item = currentStation();
      station.textContent = item ? item.label : "";
    }
  }

  function rotateStream(forceNext) {
    var list = streams();
    if (!list.length) return;
    if (forceNext) streamIdx = (streamIdx + 1) % list.length;
    var item = list[streamIdx % list.length];
    var a = ensureAudio();
    clearStallTimer();
    a.pause();
    a.src = item.url;
    a.load();
    if (enabled && !userPaused) {
      a.muted = false;
      a.play().catch(function () {
        a.muted = true;
        a.play().catch(function () {
          /* wait for user gesture */
        });
      });
    }
    paintUi();
  }

  function playRadio() {
    enabled = true;
    userPaused = false;
    savePrefs();
    streamIdx = 0;
    rotateStream(false);
    paintUi();
  }

  function pauseRadio() {
    userPaused = true;
    savePrefs();
    clearStallTimer();
    if (audio) audio.pause();
    paintUi();
  }

  function toggleRadio() {
    if (enabled && !userPaused) {
      pauseRadio();
      return;
    }
    playRadio();
  }

  function syncLangFromPage(forceRestart) {
    var next = langFromPage();
    if (next === lang && !forceRestart) {
      paintUi();
      return;
    }
    lang = next;
    streamIdx = 0;
    if (enabled && !userPaused) rotateStream(false);
    else paintUi();
  }

  function tryAutoplayMuted() {
    if (enabled) return;
    enabled = true;
    userPaused = true;
    savePrefs();
    var a = ensureAudio();
    a.muted = true;
    a.volume = DEFAULT_VOLUME;
    var list = streams();
    if (!list.length) return;
    a.src = list[0].url;
    a.play().catch(function () {
      /* blocked until interaction */
    });
    paintUi();
  }

  function bind() {
    var toggle = document.getElementById("financeRadioToggle");
    var dock = document.getElementById("financeRadioDock");
    if (!toggle || !dock || dock.getAttribute("data-bound") === "1") return;
    dock.setAttribute("data-bound", "1");
    lang = langFromPage();
    toggle.addEventListener("click", toggleRadio);
    window.addEventListener("quant-lang", function () {
      syncLangFromPage(false);
    });
    paintUi();
    tryAutoplayMuted();
    var unlock = function () {
      if (enabled && userPaused && audio && audio.paused) {
        audio.muted = true;
        audio.play().catch(function () {});
      }
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
    };
    document.addEventListener("click", unlock, true);
    document.addEventListener("touchstart", unlock, true);
  }

  loadPrefs();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  root.QAFinanceRadio = { toggle: toggleRadio, pause: pauseRadio };
})(window);
