(function (root) {
  function gen(n, step) {
    const now = Math.floor(Date.now() / 1000);
    let px = 64180;
    const bars = [];
    for (let i = n; i >= 1; i--) {
      const t = now - i * step;
      const wave = Math.sin(i / 21) * 38 + Math.cos(i / 9) * 14;
      const o = px;
      const c = Math.max(1200, o + wave * 0.12 + ((i * 13) % 11) - 5);
      const high = Math.max(o, c) + 18 + (i % 5);
      const low = Math.min(o, c) - 16 - (i % 4);
      bars.push({
        time: t,
        open: +o.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +c.toFixed(2),
        volume: 8 + (i % 12) * 2.4,
      });
      px = c;
    }
    return bars;
  }

  const STEP = { "1s": 1, "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };

  root.QAOffline = {
    updatedAt: "2026-08-22 14:00 UTC",
    forInterval(interval) {
      return gen(420, STEP[interval] || 60);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
