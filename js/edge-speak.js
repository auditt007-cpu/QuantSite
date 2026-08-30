/**
 * Live-room Edge-TTS player — defeats Autoplay Policy + lost User Activation.
 *
 * Key rules:
 * 1. One global HTMLAudioElement (window.globalTTSAudio), unlocked on first gesture.
 * 2. Prefer GET /api/tts/speak?... so the <audio> element fetches (no JS fetch() play).
 * 3. Never silently swallow NotAllowedError; log [TTS Play Error].
 * 4. window.FORCE_SERVER_TTS === true → never fall back to speechSynthesis.
 */
(function (root) {
  const SILENT_WAV =
    "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAA=";

  let playbackUnlocked = false;
  let playToken = 0;
  let unlockBound = false;

  if (typeof root.FORCE_SERVER_TTS === "undefined") {
    root.FORCE_SERVER_TTS = true;
  }

  function hubBase() {
    const cfg = root.QUANT_CONFIG || {};
    return String(cfg.hubApiBase || "https://api.quantalpha.space").replace(/\/$/, "");
  }

  function normalizeLang(raw) {
    const api = root.QAVoiceTemplates;
    if (api && api.normalizeLang) return api.normalizeLang(raw);
    const s = String(raw || "").trim();
    if (s === "zh-Hans" || s === "zh-CN" || s === "zh") return "zh-CN";
    if (s === "en" || s === "en-US" || s === "en-GB") return "zh-Hant";
    return "zh-Hant";
  }

  function edgeVoiceFor(lang) {
    const api = root.QAVoiceTemplates;
    if (api && api.edgeVoiceFor) return api.edgeVoiceFor(lang);
    const key = normalizeLang(lang);
    if (key === "zh-CN") return "zh-CN-YunyangNeural";
    return "zh-TW-HsiaoChenNeural";
  }

  function speechCfg(lang) {
    const api = root.QAVoiceTemplates;
    if (api && api.speechConfig) return api.speechConfig(lang);
    return { lang: normalizeLang(lang), rate: "+0%", pitch: "+0Hz" };
  }

  function ensureGlobalAudio() {
    if (root.globalTTSAudio) return root.globalTTSAudio;
    const a = new Audio();
    a.preload = "auto";
    a.setAttribute("playsinline", "");
    a.setAttribute("webkit-playsinline", "");
    root.globalTTSAudio = a;
    root.currentPromoAudio = a;
    return a;
  }

  function touchMediaSession(title) {
    try {
      if (!("mediaSession" in root.navigator)) return;
      root.navigator.mediaSession.metadata = new root.MediaMetadata({
        title: title || "广州表哥 Live",
        artist: "GZBG QUANT",
        album: "Live War Room",
      });
      root.navigator.mediaSession.playbackState = "playing";
    } catch {
      /* */
    }
  }

  function ttsGetUrl(text, lang) {
    const keyLang = normalizeLang(lang);
    const cfg = speechCfg(keyLang);
    const voice = edgeVoiceFor(keyLang);
    const q = new URLSearchParams();
    q.set("text", String(text || "").slice(0, 480));
    q.set("lang", keyLang);
    q.set("voice", voice);
    if (cfg.rate && typeof cfg.rate === "string") q.set("rate", cfg.rate);
    if (cfg.pitch && typeof cfg.pitch === "string") q.set("pitch", cfg.pitch);
    q.set("t", String(Date.now()));
    return hubBase() + "/api/tts/speak?" + q.toString();
  }

  async function unlockPlayback(force) {
    if (playbackUnlocked && !force) return true;
    const a = ensureGlobalAudio();
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
      try {
        console.log("[TTS] Audio Context Unlocked");
      } catch {
        /* */
      }
      return true;
    } catch (err) {
      try {
        console.error("[TTS] Unlock failed", err);
      } catch {
        /* */
      }
      return false;
    }
  }

  function bindGestureUnlock() {
    if (unlockBound) return;
    unlockBound = true;
    const run = function () {
      unlockPlayback(false);
    };
    document.addEventListener("click", run, { capture: true, passive: true });
    document.addEventListener("touchstart", run, { capture: true, passive: true });
    document.addEventListener("pointerdown", run, { capture: true, passive: true });
  }

  function stopShared() {
    playToken += 1;
    try {
      const a = root.globalTTSAudio;
      if (!a) return;
      a.pause();
      /* Do NOT clear src / load() — that can drop the unlocked media element state */
    } catch {
      /* */
    }
  }

  function waitEndedOrError(a, token, gen, isAlive) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(safety);
        a.removeEventListener("ended", onEnded);
        a.removeEventListener("error", onError);
        resolve(!!ok);
      };
      const onEnded = () => {
        if (token !== playToken) return finish(false);
        finish(true);
      };
      const onError = (ev) => {
        try {
          console.error("[TTS Play Error] media error", a.error || ev);
        } catch {
          /* */
        }
        if (token !== playToken) return finish(false);
        finish(false);
      };
      a.addEventListener("ended", onEnded);
      a.addEventListener("error", onError);
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
      const safety = setTimeout(() => {
        if (!a.paused && a.currentTime > 0) finish(true);
        else finish(false);
      }, 48000);
    });
  }

  /**
   * Primary path: set unlocked <audio>.src to GET TTS URL (element fetches MP3).
   * No JS fetch() → no lost User Activation from network round-trip before play().
   */
  async function playServerUrl(url, gen, isAlive) {
    const a = ensureGlobalAudio();
    root.currentPromoAudio = a;
    const token = ++playToken;
    if (typeof isAlive === "function" && !isAlive(gen)) return false;

    touchMediaSession("广州表哥 · Live Voice");
    a.volume = 1;
    a.src = url;

    try {
      const p = a.play();
      if (p && typeof p.then === "function") await p;
      try {
        console.log("[TTS] Successfully played server audio:", url.slice(0, 120));
      } catch {
        /* */
      }
    } catch (err) {
      try {
        console.error("[TTS Play Error]", err);
      } catch {
        /* */
      }
      const unlocked = await unlockPlayback(true);
      if (!unlocked) return false;
      try {
        await a.play();
        try {
          console.log("[TTS] Play retry OK after re-unlock");
        } catch {
          /* */
        }
      } catch (err2) {
        try {
          console.error("[TTS Play Error] retry failed", err2);
        } catch {
          /* */
        }
        return false;
      }
    }

    if (token !== playToken) return false;
    return waitEndedOrError(a, token, gen, isAlive);
  }

  async function playBlob(blob, gen, isAlive) {
    if (!blob) return false;
    let url = "";
    try {
      url = URL.createObjectURL(blob);
      const ok = await playServerUrl(url, gen, isAlive);
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* */
      }
      return ok;
    } catch (err) {
      try {
        console.error("[TTS Play Error] blob path", err);
      } catch {
        /* */
      }
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* */
        }
      }
      return false;
    }
  }

  async function fetchMp3(text, lang) {
    const keyLang = normalizeLang(lang);
    const cfg = speechCfg(keyLang);
    const voice = edgeVoiceFor(keyLang);
    const body = { text: text, lang: keyLang, voice: voice };
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
    return new Blob([raw], { type: "audio/mpeg" });
  }

  async function speak(text, lang, gen, isAlive) {
    const line = String(text || "").trim();
    if (!line) return false;
    if (typeof isAlive === "function" && !isAlive(gen)) return false;
    const keyLang = normalizeLang(lang);

    await unlockPlayback();
    if (typeof isAlive === "function" && !isAlive(gen)) return false;

    /* 1) GET via <audio src> — preferred (no JS fetch before play) */
    try {
      const ok = await playServerUrl(ttsGetUrl(line, keyLang), gen, isAlive);
      if (ok) return true;
    } catch (err) {
      try {
        console.error("[TTS Play Error] GET path", err);
      } catch {
        /* */
      }
    }

    if (typeof isAlive === "function" && !isAlive(gen)) return false;

    /* 2) POST blob fallback (still on unlocked singleton) */
    try {
      const blob = await fetchMp3(line, keyLang);
      if (typeof isAlive === "function" && !isAlive(gen)) return false;
      await unlockPlayback();
      return await playBlob(blob, gen, isAlive);
    } catch (err) {
      try {
        console.error("[TTS Play Error] POST blob path", err);
      } catch {
        /* */
      }
      return false;
    }
  }

  async function prefetch(text, lang) {
    /* Warm CDN/DNS only — real play uses GET on unlocked element */
    const line = String(text || "").trim();
    if (!line) return null;
    try {
      const url = ttsGetUrl(line, lang);
      ensureGlobalAudio();
      return { url: url, text: line, lang: normalizeLang(lang) };
    } catch {
      return null;
    }
  }

  async function speakBlob(blobOrPref, gen, isAlive) {
    await unlockPlayback();
    if (blobOrPref && blobOrPref.url) {
      return playServerUrl(blobOrPref.url, gen, isAlive);
    }
    if (blobOrPref instanceof Blob) {
      return playBlob(blobOrPref, gen, isAlive);
    }
    return false;
  }

  bindGestureUnlock();
  ensureGlobalAudio();

  root.QAEdgeSpeak = {
    speak: speak,
    speakBlob: speakBlob,
    prefetch: prefetch,
    fetchMp3: fetchMp3,
    playBlob: playBlob,
    playServerUrl: playServerUrl,
    ttsGetUrl: ttsGetUrl,
    unlockPlayback: unlockPlayback,
    stopShared: stopShared,
    touchMediaSession: touchMediaSession,
    edgeVoiceFor: edgeVoiceFor,
    normalizeLang: normalizeLang,
  };
})(typeof window !== "undefined" ? window : globalThis);
