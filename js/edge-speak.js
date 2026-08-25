/**
 * Live-room speech via hub Edge-TTS (MP3 → shared HTML5 Audio).
 * Same playback path as promo ads so zh-CN / en stay male (Yunyang / Christopher).
 */
(function (root) {
  const CACHE_MAX = 48;
  const cache = new Map();
  const SILENT_WAV =
    "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAA=";

  let sharedAudio = null;
  let playbackUnlocked = false;
  let playToken = 0;

  function hubBase() {
    const cfg = root.QUANT_CONFIG || {};
    return String(cfg.hubApiBase || "https://api.quantalpha.space").replace(/\/$/, "");
  }

  function normalizeLang(raw) {
    const api = root.QAVoiceTemplates;
    if (api && api.normalizeLang) return api.normalizeLang(raw);
    const s = String(raw || "").trim();
    if (s === "zh-Hans" || s === "zh-CN" || s === "zh") return "zh-CN";
    if (s === "en" || s === "en-US" || s === "en-GB") return "en";
    return "zh-Hant";
  }

  function edgeVoiceFor(lang) {
    const api = root.QAVoiceTemplates;
    if (api && api.edgeVoiceFor) return api.edgeVoiceFor(lang);
    const key = normalizeLang(lang);
    if (key === "zh-CN") return "zh-CN-YunyangNeural";
    if (key === "en") return "en-US-ChristopherNeural";
    return "zh-TW-HsiaoChenNeural";
  }

  function speechCfg(lang) {
    const api = root.QAVoiceTemplates;
    if (api && api.speechConfig) return api.speechConfig(lang);
    return { lang: normalizeLang(lang), rate: "+0%", pitch: "+0Hz" };
  }

  function cacheKey(text, lang, voice) {
    return String(lang || "") + "\0" + String(voice || "") + "\0" + String(text || "").slice(0, 400);
  }

  function trimCache() {
    while (cache.size > CACHE_MAX) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
  }

  function ensureSharedAudio() {
    if (sharedAudio) return sharedAudio;
    const a = new Audio();
    a.preload = "auto";
    a.setAttribute("playsinline", "");
    a.setAttribute("webkit-playsinline", "");
    sharedAudio = a;
    root.currentPromoAudio = a;
    return a;
  }

  async function fetchMp3(text, lang) {
    const keyLang = normalizeLang(lang);
    const cfg = speechCfg(keyLang);
    const voice = edgeVoiceFor(keyLang);
    const key = cacheKey(text, keyLang, voice);
    const hit = cache.get(key);
    if (hit && hit.blob) return hit.blob;

    const body = {
      text: text,
      lang: keyLang,
      voice: voice,
    };
    if (cfg.rate && typeof cfg.rate === "string") body.rate = cfg.rate;
    if (cfg.pitch && typeof cfg.pitch === "string") body.pitch = cfg.pitch;

    const res = await fetch(hubBase() + "/api/tts/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      mode: "cors",
    });
    if (!res.ok) throw new Error("tts_http_" + res.status);
    const raw = await res.arrayBuffer();
    if (!raw || raw.byteLength < 128) throw new Error("tts_empty");
    const blob = new Blob([raw], { type: "audio/mpeg" });
    cache.set(key, { blob: blob });
    trimCache();
    return blob;
  }

  function touchMediaSession(title) {
    try {
      if (!("mediaSession" in root.navigator)) return;
      root.navigator.mediaSession.metadata = new root.MediaMetadata({
        title: title || "QUANT ALPHA Live",
        artist: "QUANT.ALPHA",
        album: "Live War Room",
      });
      root.navigator.mediaSession.playbackState = "playing";
    } catch {
      /* */
    }
  }

  async function unlockPlayback(force) {
    if (playbackUnlocked && !force) return true;
    try {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (Ctx) {
        const ctx = unlockPlayback._ctx || new Ctx();
        unlockPlayback._ctx = ctx;
        if (ctx.state === "suspended") await ctx.resume();
      }
    } catch {
      /* optional */
    }
    try {
      const a = ensureSharedAudio();
      a.src = SILENT_WAV;
      a.volume = 0.01;
      await a.play();
      try {
        a.pause();
        a.currentTime = 0;
      } catch {
        /* */
      }
      a.volume = 1;
      playbackUnlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  function stopShared() {
    playToken += 1;
    try {
      const a = sharedAudio;
      if (!a) return;
      a.pause();
      a.removeAttribute("src");
      a.load();
    } catch {
      /* */
    }
  }

  function playBlob(blob, gen, isAlive) {
    return new Promise((resolve) => {
      if (!blob) return resolve(false);
      if (typeof isAlive === "function" && !isAlive(gen)) return resolve(false);

      const token = ++playToken;
      let done = false;
      let safetyTimer = null;
      let url = "";
      const a = ensureSharedAudio();
      root.currentPromoAudio = a;

      const finish = (ok) => {
        if (done) return;
        done = true;
        if (poll) clearInterval(poll);
        if (safetyTimer) clearTimeout(safetyTimer);
        if (url) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* */
          }
        }
        resolve(!!ok);
      };

      try {
        url = URL.createObjectURL(blob);
      } catch {
        return finish(false);
      }

      touchMediaSession("QUANT ALPHA · Live Voice");

      a.onended = () => {
        if (token !== playToken) return finish(false);
        finish(true);
      };
      a.onerror = () => {
        if (token !== playToken) return finish(false);
        finish(false);
      };

      const poll = setInterval(() => {
        if (typeof isAlive === "function" && !isAlive(gen)) {
          try {
            a.pause();
          } catch {
            /* */
          }
          finish(false);
        }
      }, 40);

      const tryPlay = (attempt) => {
        if (done || token !== playToken) return finish(false);
        if (typeof isAlive === "function" && !isAlive(gen)) return finish(false);
        a.volume = 1;
        const p = a.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            /* playing */
          }).catch(() => {
            if (done || token !== playToken) return;
            if (attempt >= 3) return finish(false);
            unlockPlayback(true).then(() => {
              setTimeout(() => tryPlay(attempt + 1), 80);
            });
          });
        }
      };

      try {
        a.src = url;
        a.load();
      } catch {
        return finish(false);
      }

      const start = () => tryPlay(0);
      if (a.readyState >= 2) start();
      else {
        a.addEventListener("canplay", start, { once: true });
        setTimeout(start, 400);
      }
      safetyTimer = setTimeout(() => {
        if (!done && a && !a.paused && a.currentTime > 0) finish(true);
        else finish(!a.paused && a.currentTime > 0);
      }, 48000);
    });
  }

  async function speakOnce(text, lang, gen, isAlive) {
    await unlockPlayback();
    const blob = await fetchMp3(text, lang);
    if (typeof isAlive === "function" && !isAlive(gen)) return false;
    await unlockPlayback();
    return playBlob(blob, gen, isAlive);
  }

  async function speak(text, lang, gen, isAlive) {
    const line = String(text || "").trim();
    if (!line) return false;
    if (typeof isAlive === "function" && !isAlive(gen)) return false;
    const keyLang = normalizeLang(lang);
    for (let i = 0; i < 3; i += 1) {
      if (typeof isAlive === "function" && !isAlive(gen)) return false;
      try {
        const ok = await speakOnce(line, keyLang, gen, isAlive);
        if (ok) return true;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 180 + i * 160));
    }
    return false;
  }

  /** Prefetch TTS during chime so play starts immediately after ding. */
  async function prefetch(text, lang) {
    const line = String(text || "").trim();
    if (!line) return null;
    try {
      return await fetchMp3(line, normalizeLang(lang));
    } catch {
      return null;
    }
  }

  async function speakBlob(blob, gen, isAlive) {
    if (!blob) return false;
    await unlockPlayback();
    return playBlob(blob, gen, isAlive);
  }

  root.QAEdgeSpeak = {
    speak: speak,
    speakBlob: speakBlob,
    prefetch: prefetch,
    fetchMp3: fetchMp3,
    playBlob: playBlob,
    unlockPlayback: unlockPlayback,
    stopShared: stopShared,
    touchMediaSession: touchMediaSession,
    edgeVoiceFor: edgeVoiceFor,
    normalizeLang: normalizeLang,
  };
})(typeof window !== "undefined" ? window : globalThis);
