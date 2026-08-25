/**
 * Live-room speech via hub Edge-TTS (MP3 → HTML5 Audio).
 * Keeps playback alive on mobile lock-screen better than speechSynthesis.
 */
(function (root) {
  const CACHE_MAX = 48;
  const cache = new Map();

  function hubBase() {
    const cfg = root.QUANT_CONFIG || {};
    return String(cfg.hubApiBase || "https://api.quantalpha.space").replace(/\/$/, "");
  }

  function cacheKey(text, lang) {
    return String(lang || "") + "\0" + String(text || "").slice(0, 400);
  }

  function trimCache() {
    while (cache.size > CACHE_MAX) {
      const first = cache.keys().next().value;
      const hit = cache.get(first);
      if (hit && hit.url) {
        try {
          URL.revokeObjectURL(hit.url);
        } catch {
          /* */
        }
      }
      cache.delete(first);
    }
  }

  function cfgForLang(lang) {
    const api = root.QAVoiceTemplates;
    return api && api.speechConfig ? api.speechConfig(lang) : { lang: lang || "zh-Hant" };
  }

  async function fetchMp3(text, lang) {
    const key = cacheKey(text, lang);
    const hit = cache.get(key);
    if (hit && hit.blob) return hit.blob;

    const res = await fetch(hubBase() + "/api/tts/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, lang: lang }),
      credentials: "omit",
      mode: "cors",
    });
    if (!res.ok) throw new Error("tts_http_" + res.status);
    const blob = await res.blob();
    if (!blob || blob.size < 128) throw new Error("tts_empty");
    cache.set(key, { blob: blob, url: "" });
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

  function playBlob(blob, gen, isAlive) {
    return new Promise((resolve) => {
      if (!blob) return resolve(false);
      if (typeof isAlive === "function" && !isAlive(gen)) return resolve(false);

      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (poll) clearInterval(poll);
        resolve(!!ok);
      };

      let url;
      try {
        url = URL.createObjectURL(blob);
      } catch {
        return finish(false);
      }

      let a;
      try {
        a = new Audio();
        a.src = url;
        a.preload = "auto";
        a.setAttribute("playsinline", "");
        a.setAttribute("webkit-playsinline", "");
        root.currentPromoAudio = a;
      } catch {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* */
        }
        return finish(false);
      }

      touchMediaSession("QUANT ALPHA · Live Voice");

      a.onended = () => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* */
        }
        finish(true);
      };
      a.onerror = () => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* */
        }
        finish(false);
      };

      const poll = setInterval(() => {
        if (typeof isAlive === "function" && !isAlive(gen)) {
          try {
            a.pause();
            a.currentTime = 0;
          } catch {
            /* */
          }
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* */
          }
          finish(false);
        }
      }, 40);

      const p = a.play();
      if (p && typeof p.then === "function") {
        p.catch(() => finish(false));
      }
      setTimeout(() => finish(true), Math.min(45000, 3200 + String(blob.size || 0) / 8));
    });
  }

  async function speak(text, lang, gen, isAlive) {
    const line = String(text || "").trim();
    if (!line) return false;
    if (typeof isAlive === "function" && !isAlive(gen)) return false;
    const blob = await fetchMp3(line, lang || cfgForLang(lang).lang);
    if (typeof isAlive === "function" && !isAlive(gen)) return false;
    return playBlob(blob, gen, isAlive);
  }

  root.QAEdgeSpeak = {
    speak: speak,
    fetchMp3: fetchMp3,
    playBlob: playBlob,
    touchMediaSession: touchMediaSession,
  };
})(typeof window !== "undefined" ? window : globalThis);
