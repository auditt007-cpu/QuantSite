(function (root) {
  const INTERVALS = ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"];
  const STALE_MS = 4000;
  const ALL_VENUES = ["HTX", "MEXC", "Bitget", "Gate", "Binance", "Binance-Vision", "OKX", "Bybit", "Worker"];
  const CN_RACE = 4;
  const NO_HISTORY = new Set(["HTX", "OKX", "Bybit"]);

  /** Venue priority by visitor IP region (CN / TW+HK+MO / intl). */
  const VENUE_ORDER = {
    cn: ["HTX", "MEXC", "Bitget", "Gate", "OKX", "Bybit", "Worker", "Binance-Vision", "Binance"],
    tw: ["Binance", "Binance-Vision", "OKX", "Bybit", "HTX", "MEXC", "Bitget", "Gate", "Worker"],
    intl: ["Binance-Vision", "Binance", "OKX", "Bybit", "HTX", "MEXC", "Bitget", "Gate", "Worker"],
  };

  const GEO_CACHE_KEY = "qa_feed_geo";
  const GEO_TTL_MS = 6 * 60 * 60 * 1000;
  const CN_PROBE_KEY = "qa_cn_venue_probe";
  const VENUE_PROBE_KEY = "qa_venue_probe_v2";
  const CN_PROBE_TTL_MS = 30 * 60 * 1000;
  const CN_PROBE_INTERVAL_MS = 10 * 60 * 1000;
  const CN_PROBE_TIMEOUT_MS = 3500;
  const STICKY_VENUE_KEY = "qa_feed_sticky_venue";
  const STICKY_VENUE_TTL_MS = 30 * 60 * 1000;
  const WARM_KLINE_CACHE_KEY = "qa_warm_klines_meta";
  const DEAD_SYMBOLS = { FETUSDT: true };
  const COIN_ALIAS = { FETUSDT: "NEARUSDT" };
  const BASE_PX = {
    BTCUSDT: 78400, ETHUSDT: 2480, SOLUSDT: 178.4, BNBUSDT: 590, XRPUSDT: 2.85,
    DOGEUSDT: 0.168, ADAUSDT: 0.72, AVAXUSDT: 22.4, LINKUSDT: 18.4, SUIUSDT: 3.42,
    NEARUSDT: 5.85, APTUSDT: 6.1, OPUSDT: 0.68, ARBUSDT: 0.42, PEPEUSDT: 0.00001035,
    SHIBUSDT: 0.0000128, TIAUSDT: 2.15, INJUSDT: 22.8, RENDERUSDT: 5.4, AAVEUSDT: 280,
    ONDOUSDT: 0.92,
  };


  function feedStoreGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    }
  }

  function feedStoreSet(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {
      try {
        sessionStorage.setItem(key, val);
      } catch {
        /* ignore */
      }
    }
  }

  let lastMeta = { source: "live", updatedAt: "", venue: "" };
  let startNode = 0;
  let feedRegionCode = "intl";
  let feedCountryCode = "";
  let cnSortedVenues = null;
  let cnVenueLatencies = {};
  let regionSortedVenues = null;
  let regionVenueLatencies = {};
  let cnProbeTimer = null;
  let cnProbeReady = Promise.resolve();
  let venueProbeReady = Promise.resolve();
  let warmupPromise = null;

  function loadCachedGeo() {
    try {
      const raw = feedStoreGet(GEO_CACHE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.region || Date.now() - (o.ts || 0) > GEO_TTL_MS) return null;
      return { region: o.region, country: o.country || "" };
    } catch {
      return null;
    }
  }

  function saveCachedGeo(region, country) {
    feedStoreSet(GEO_CACHE_KEY, JSON.stringify({ region, country, ts: Date.now() }));
  }

  function readCnProbeCache() {
    try {
      const raw = feedStoreGet(CN_PROBE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function loadStickyVenue() {
    try {
      const raw = feedStoreGet(STICKY_VENUE_KEY);
      if (!raw) return "";
      const o = JSON.parse(raw);
      if (!o || !o.venue || o.region !== feedRegionCode) return "";
      if (Date.now() - (o.ts || 0) > STICKY_VENUE_TTL_MS) return "";
      return ALL_VENUES.includes(o.venue) ? o.venue : "";
    } catch {
      return "";
    }
  }

  function saveStickyVenue(venue) {
    const v = String(venue || "");
    if (!ALL_VENUES.includes(v)) return;
    feedStoreSet(
      STICKY_VENUE_KEY,
      JSON.stringify({ venue: v, region: feedRegionCode, country: feedCountryCode, ts: Date.now() }),
    );
    lastMeta.venue = v;
  }

  function pinVenueList(list) {
    const sticky = loadStickyVenue();
    if (!sticky) return list.slice();
    const rest = list.filter((v) => v !== sticky);
    return [sticky].concat(rest);
  }

  function countryToRegion(country) {
    const cc = String(country || "").toUpperCase();
    if (cc === "CN") return "cn";
    if (cc === "TW" || cc === "HK" || cc === "MO") return "tw";
    return "intl";
  }

  function applyFeedRegion(region, country, notify) {
    const next = VENUE_ORDER[region] ? region : "intl";
    const changed = next !== feedRegionCode;
    feedRegionCode = next;
    feedCountryCode = String(country || "").toUpperCase();
    if (changed) startNode = 0;
    applyCachedVenueProbe(feedRegionCode);
    if (changed || !cnProbeTimer) scheduleVenueProbe();
    if (notify && changed && typeof root.dispatchEvent === "function") {
      root.dispatchEvent(
        new CustomEvent("quant-feed-region", { detail: { region: feedRegionCode, country: feedCountryCode } }),
      );
    }
    return changed;
  }

  function loadCachedCnProbe() {
    const o = readCnProbeCache();
    if (!o || !Array.isArray(o.order) || Date.now() - (o.ts || 0) > CN_PROBE_TTL_MS) return null;
    return { order: o.order, latencies: o.latencies || {}, ts: o.ts || 0 };
  }

  function saveCachedCnProbe(order, latencies) {
    feedStoreSet(CN_PROBE_KEY, JSON.stringify({ order, latencies, ts: Date.now() }));
  }

  function applyCachedCnProbe() {
    const cached = loadCachedCnProbe();
    if (!cached || !cached.order.length) return;
    cnSortedVenues = cached.order.filter((v) => ALL_VENUES.includes(v));
    cnVenueLatencies = cached.latencies || {};
  }

  function stopCnProbe() {
    if (cnProbeTimer) {
      clearInterval(cnProbeTimer);
      cnProbeTimer = null;
    }
  }

  function cnProbeUrls() {
    const apiBase = (root.QUANT_CONFIG && root.QUANT_CONFIG.apiBase) || "";
    const urls = {
      HTX: "https://api.huobi.pro/market/detail/merged?symbol=btcusdt",
      MEXC: "https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT",
      Bitget: "https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT",
      Gate: "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT",
      OKX: "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT",
      Bybit: "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
      "Binance-Vision": "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
      Binance: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    };
    const base = String(apiBase || "").replace(/\/$/, "");
    if (base.startsWith("http")) {
      urls.Worker = `${base}/api/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT"]')}`;
    }
    return urls;
  }

  function probeUrls() {
    return cnProbeUrls();
  }

  function loadCachedVenueProbe(region) {
    try {
      const raw = feedStoreGet(VENUE_PROBE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || o.region !== region || !Array.isArray(o.order)) return null;
      if (Date.now() - (o.ts || 0) > CN_PROBE_TTL_MS) return null;
      return o;
    } catch {
      return null;
    }
  }

  function saveCachedVenueProbe(region, order, latencies) {
    feedStoreSet(
      VENUE_PROBE_KEY,
      JSON.stringify({ region, order, latencies, ts: Date.now() }),
    );
  }

  function applyCachedVenueProbe(region) {
    const reg = region || feedRegionCode;
    const cached = loadCachedVenueProbe(reg);
    if (!cached || !cached.order.length) {
      if (reg === "cn") applyCachedCnProbe();
      return false;
    }
    regionSortedVenues = cached.order.filter((v) => ALL_VENUES.includes(v));
    regionVenueLatencies = cached.latencies || {};
    if (reg === "cn") {
      cnSortedVenues = regionSortedVenues;
      cnVenueLatencies = regionVenueLatencies;
      saveCachedCnProbe(cnSortedVenues, cnVenueLatencies);
    }
    return true;
  }

  async function probeVenueLatency(venue, url) {
    if (!url) return { venue, ms: Infinity, ok: false };
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), CN_PROBE_TIMEOUT_MS) : null;
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal, cache: "no-store" } : { cache: "no-store" });
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (!res.ok) return { venue, ms: Infinity, ok: false };
      return { venue, ms: Math.max(0, t1 - t0), ok: true };
    } catch {
      return { venue, ms: Infinity, ok: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function runVenueProbe(force) {
    const region = feedRegion();
    const base = (VENUE_ORDER[region] || VENUE_ORDER.intl).slice();
    if (!force) {
      const cached = loadCachedVenueProbe(region);
      if (cached && cached.order.length) {
        applyCachedVenueProbe(region);
        return regionSortedVenues;
      }
    }
    const urls = probeUrls();
    const results = await Promise.all(
      base.filter((venue) => urls[venue]).map((venue) => probeVenueLatency(venue, urls[venue])),
    );
    const latMap = {};
    results.forEach((r) => {
      latMap[r.venue] = r.ok ? Math.round(r.ms) : null;
    });
    const sorted = [...base].sort((a, b) => {
      const la = latMap[a] == null ? Infinity : latMap[a];
      const lb = latMap[b] == null ? Infinity : latMap[b];
      if (la !== lb) return la - lb;
      return base.indexOf(a) - base.indexOf(b);
    });
    regionSortedVenues = sorted.filter((v) => ALL_VENUES.includes(v));
    regionVenueLatencies = latMap;
    saveCachedVenueProbe(region, regionSortedVenues, latMap);
    if (region === "cn") {
      cnSortedVenues = regionSortedVenues;
      cnVenueLatencies = latMap;
      saveCachedCnProbe(cnSortedVenues, latMap);
    }
    const fastest = regionSortedVenues.find((v) => latMap[v] != null);
    if (fastest) saveStickyVenue(fastest);
    if (typeof root.dispatchEvent === "function") {
      root.dispatchEvent(
        new CustomEvent("quant-feed-venues", {
          detail: { region, order: regionSortedVenues.slice(), latencies: { ...latMap } },
        }),
      );
    }
    return regionSortedVenues;
  }

  async function runCnVenueProbe() {
    return runVenueProbe(true);
  }

  function scheduleVenueProbe() {
    if (cnProbeTimer) clearInterval(cnProbeTimer);
    applyCachedVenueProbe(feedRegion());
    const cached = loadCachedVenueProbe(feedRegion());
    venueProbeReady = cached
      ? Promise.resolve(regionSortedVenues)
      : runVenueProbe(false).catch(() => regionSortedVenues);
    cnProbeReady = venueProbeReady;
    cnProbeTimer = setInterval(() => {
      runVenueProbe(true).catch(() => {});
    }, CN_PROBE_INTERVAL_MS);
  }

  function scheduleCnProbe() {
    scheduleVenueProbe();
  }

  const cachedGeo = loadCachedGeo();
  if (cachedGeo) applyFeedRegion(cachedGeo.region, cachedGeo.country, false);
  else if (feedRegionCode === "cn") applyCachedCnProbe();
  const bootSticky = loadStickyVenue();
  if (bootSticky) lastMeta.venue = bootSticky;

  function feedRegion() {
    return feedRegionCode;
  }

  function feedCountry() {
    return feedCountryCode;
  }

  function orderedVenues() {
    let list;
    if (regionSortedVenues && regionSortedVenues.length) {
      list = regionSortedVenues.filter((v) => ALL_VENUES.includes(v));
    } else if (feedRegion() === "cn" && cnSortedVenues && cnSortedVenues.length) {
      list = cnSortedVenues.filter((v) => ALL_VENUES.includes(v));
    } else {
      list = (VENUE_ORDER[feedRegion()] || VENUE_ORDER.intl).filter((v) => ALL_VENUES.includes(v));
    }
    return pinVenueList(list);
  }

  function resetRegion() {
    startNode = 0;
  }

  async function probeCountryCode() {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
    const opts = ctrl ? { signal: ctrl.signal } : {};
    try {
      const res = await fetch("https://ipapi.co/country_code/", opts);
      if (res.ok) {
        const cc = (await res.text()).trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(cc)) return cc;
      }
    } catch {
      /* next probe */
    }
    try {
      const res = await fetch("https://ip-api.com/json/?fields=status,countryCode", opts);
      if (res.ok) {
        const data = await res.json();
        if (data && data.status === "success" && data.countryCode) return String(data.countryCode).toUpperCase();
      }
    } catch {
      /* no geo */
    } finally {
      if (timer) clearTimeout(timer);
    }
    return "";
  }

  async function initFeedGeo() {
    const cached = loadCachedGeo();
    if (cached) {
      applyFeedRegion(cached.region, cached.country, false);
      return feedRegionCode;
    }
    let cc = "";
    try {
      cc = await probeCountryCode();
    } catch {
      cc = "";
    }
    const region = cc ? countryToRegion(cc) : feedRegionCode || "intl";
    if (cc) saveCachedGeo(region, cc);
    applyFeedRegion(region, cc, true);
    return feedRegionCode;
  }

  async function readyFeed() {
    if (warmupPromise) {
      try {
        await Promise.race([warmupPromise, new Promise((resolve) => setTimeout(resolve, 2500))]);
      } catch {
        /* keep sticky/static order */
      }
      return feedRegionCode;
    }
    const hasGeo = Boolean(loadCachedGeo());
    const hasProbe =
      Boolean(loadCachedVenueProbe(feedRegionCode)) ||
      (feedRegionCode === "cn" && Boolean(loadCachedCnProbe())) ||
      Boolean(loadStickyVenue());
    if (hasGeo && hasProbe) return feedRegionCode;
    await feedGeoReady;
    try {
      await Promise.race([venueProbeReady, new Promise((resolve) => setTimeout(resolve, 1200))]);
    } catch {
      /* keep cached/static order */
    }
    return feedRegionCode;
  }

  async function warmupFeed(opts) {
    if (warmupPromise) return warmupPromise;
    const symbol = String((opts && opts.symbol) || "BTCUSDT").toUpperCase();
    const interval = (opts && opts.interval) || "1h";
    const limit = Math.min(500, Math.max(50, Number((opts && opts.limit) || 200)));
    warmupPromise = (async () => {
      await feedGeoReady;
      if (!cnProbeTimer) scheduleVenueProbe();
      try {
        await runVenueProbe(false);
      } catch {
        /* keep default order */
      }
      let bars = 0;
      try {
        const rows = await fetchKlines(symbol, interval, limit);
        bars = rows && rows.length ? rows.length : 0;
        feedStoreSet(
          WARM_KLINE_CACHE_KEY,
          JSON.stringify({
            symbol,
            interval,
            bars,
            venue: lastMeta.venue || loadStickyVenue() || "",
            region: feedRegionCode,
            ts: Date.now(),
          }),
        );
      } catch {
        /* probe sticky is still useful without warm bars */
      }
      return {
        region: feedRegionCode,
        venue: lastMeta.venue || loadStickyVenue() || "",
        order: orderedVenues(),
        latencies: { ...regionVenueLatencies },
        warmBars: bars,
      };
    })();
    return warmupPromise;
  }

  function shouldAutoWarmup() {
    try {
      const path = String((root.location && root.location.pathname) || "").toLowerCase();
      if (!path || path === "/" || path.endsWith("/")) return true;
      return /(^|\/)index\.html?$/.test(path);
    } catch {
      return false;
    }
  }

  function kickAutoWarmup() {
    if (!shouldAutoWarmup()) return;
    const run = () => {
      try {
        warmupFeed();
      } catch {
        /* ignore */
      }
    };
    if (typeof root.requestIdleCallback === "function") {
      root.requestIdleCallback(run, { timeout: 1800 });
    } else {
      setTimeout(run, 250);
    }
  }

  const feedGeoReady = initFeedGeo();

  const OKX_BAR = { "1s": "1s", "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W" };
  const BYBIT_IV = { "1s": "1", "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W" };
  const HTX_PERIOD = { "1s": "1min", "1m": "1min", "5m": "5min", "15m": "15min", "1h": "60min", "4h": "4hour", "1d": "1day", "1w": "1week" };
  const MEXC_IV = { "1s": "1m", "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1W" };
  const MEXC_WS_IV = { "1s": "Min1", "1m": "Min1", "5m": "Min5", "15m": "Min15", "1h": "Min60", "4h": "Hour4", "1d": "Day1", "1w": "Week1" };
  const GATE_IV = { "1s": "1m", "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "7d" };
  const BITGET_IV = { "1s": "1min", "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1day", "1w": "1week" };
  const BITGET_WS_IV = { "1s": "candle1m", "1m": "candle1m", "5m": "candle5m", "15m": "candle15m", "1h": "candle1H", "4h": "candle4H", "1d": "candle1D", "1w": "candle1W" };

  function htxSym(sym) {
    return String(sym || "BTCUSDT").toLowerCase();
  }

  function gatePair(sym) {
    const s = String(sym || "BTCUSDT").toUpperCase();
    if (s.includes("_")) return s;
    if (s.endsWith("USDT")) return s.slice(0, -4) + "_USDT";
    if (s.endsWith("USDC")) return s.slice(0, -4) + "_USDC";
    return s + "_USDT";
  }

  function cnFetchMs() {
    return feedRegion() === "cn" ? 4000 : 5000;
  }

  async function parseHtxWsPayload(raw) {
    if (raw instanceof Blob) {
      if (typeof DecompressionStream === "undefined") throw new Error("gzip");
      const stream = raw.stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(String(raw));
  }

  function restTryDefs(sym, iv, lim, endTime, apiBase) {
    return {
      HTX: { venue: "HTX", run: () => restHtx(sym, iv, lim) },
      MEXC: { venue: "MEXC", run: () => restMexc(sym, iv, lim, endTime) },
      Bitget: { venue: "Bitget", run: () => restBitget(sym, iv, lim, endTime) },
      Gate: { venue: "Gate", run: () => restGate(sym, iv, lim, endTime) },
      OKX: { venue: "OKX", run: () => restOkx(sym, iv, lim) },
      Bybit: { venue: "Bybit", run: () => restBybit(sym, iv, lim) },
      Worker: { venue: "Worker", run: () => restWorker(apiBase, sym, iv, lim) },
      "Binance-Vision": {
        venue: "Binance-Vision",
        run: () => restBinance("https://data-api.binance.vision", sym, iv, lim, endTime),
      },
      Binance: { venue: "Binance", run: () => restBinance("https://api.binance.com", sym, iv, lim, endTime) },
    };
  }

  function buildRestTries(sym, iv, lim, endTime, apiBase) {
    const defs = restTryDefs(sym, iv, lim, endTime, apiBase);
    return orderedVenues()
      .map((venue) => defs[venue])
      .filter(Boolean);
  }

  function okxInstToSym(inst) {
    return String(inst || "").replace("-", "");
  }

  async function restTickerBinance(host, symbols) {
    const qs = encodeURIComponent(JSON.stringify(symbols));
    const res = await fetchUrl(`${host}/api/v3/ticker/24hr?symbols=${qs}`, 5000);
    if (!res.ok) throw new Error("http");
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error("empty");
    return rows.map((r) => ({
      symbol: r.symbol,
      lastPrice: r.lastPrice,
      priceChangePercent: r.priceChangePercent,
    }));
  }

  async function restTickerOkx(symbols) {
    const want = new Set(symbols.map((s) => okxInst(s)));
    const res = await fetchUrl("https://www.okx.com/api/v5/market/tickers?instType=SPOT", 5000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.data) || [];
    const out = rows
      .filter((r) => want.has(r.instId))
      .map((r) => {
        const last = Number(r.last);
        const open = Number(r.open24h);
        const pct = open ? ((last - open) / open) * 100 : 0;
        return { symbol: okxInstToSym(r.instId), lastPrice: String(last), priceChangePercent: String(pct) };
      });
    if (!out.length) throw new Error("empty");
    return out;
  }

  async function restTickerHtx(symbols) {
    const want = new Set(symbols.map((s) => htxSym(s)));
    const res = await fetchUrl("https://api.huobi.pro/market/tickers", cnFetchMs());
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.data) || [];
    const out = rows
      .filter((r) => want.has(r.symbol))
      .map((r) => {
        const open = Number(r.open);
        const close = Number(r.close);
        const pct = open ? ((close - open) / open) * 100 : 0;
        return { symbol: String(r.symbol).toUpperCase(), lastPrice: String(close), priceChangePercent: String(pct) };
      });
    if (!out.length) throw new Error("empty");
    return out;
  }

  async function restTickerMexc(symbols) {
    const rows = await Promise.all(
      symbols.map(async (sym) => {
        const res = await fetchUrl(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(sym)}`, cnFetchMs());
        if (!res.ok) return null;
        const r = await res.json();
        if (!r || !r.symbol) return null;
        return { symbol: r.symbol, lastPrice: r.lastPrice, priceChangePercent: r.priceChangePercent };
      }),
    );
    const out = rows.filter(Boolean);
    if (!out.length) throw new Error("empty");
    return out;
  }

  async function restTickerGate(symbols) {
    const rows = await Promise.all(
      symbols.map(async (sym) => {
        const pair = gatePair(sym);
        const res = await fetchUrl(
          `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(pair)}`,
          cnFetchMs(),
        );
        if (!res.ok) return null;
        const data = await res.json();
        const r = Array.isArray(data) ? data[0] : null;
        if (!r) return null;
        const pct = Number(r.change_percentage);
        return {
          symbol: String(sym).toUpperCase(),
          lastPrice: String(r.last),
          priceChangePercent: String(Number.isFinite(pct) ? pct : 0),
        };
      }),
    );
    const out = rows.filter(Boolean);
    if (!out.length) throw new Error("empty");
    return out;
  }

  async function restTickerBitget(symbols) {
    const rows = await Promise.all(
      symbols.map(async (sym) => {
        const res = await fetchUrl(
          `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${encodeURIComponent(sym)}`,
          cnFetchMs(),
        );
        if (!res.ok) return null;
        const data = await res.json();
        const r = data && data.data && data.data[0];
        if (!r) return null;
        return {
          symbol: String(sym).toUpperCase(),
          lastPrice: String(r.lastPr || r.close),
          priceChangePercent: String(Number(r.change24h || r.changeUtc24h || 0) * 100),
        };
      }),
    );
    const out = rows.filter(Boolean);
    if (!out.length) throw new Error("empty");
    return out;
  }

  async function restTickerBybit(symbols) {
    const want = new Set(symbols.map((s) => String(s).toUpperCase()));
    const res = await fetchUrl("https://api.bybit.com/v5/market/tickers?category=linear", cnFetchMs());
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.result && data.result.list) || [];
    const out = rows
      .filter((r) => want.has(r.symbol))
      .map((r) => ({
        symbol: r.symbol,
        lastPrice: r.lastPrice,
        priceChangePercent: String(Number(r.price24hPcnt) * 100),
      }));
    if (!out.length) throw new Error("empty");
    return out;
  }

  async function fetchTicker24h(symbols) {
    const syms = (Array.isArray(symbols) ? symbols : [symbols])
      .map((s) => String(s || "").toUpperCase())
      .filter(Boolean);
    if (!syms.length) return [];
    const apiBase = (root.QUANT_CONFIG && root.QUANT_CONFIG.apiBase) || "";
    const tries = {
      HTX: () => restTickerHtx(syms),
      MEXC: () => restTickerMexc(syms),
      Bitget: () => restTickerBitget(syms),
      Gate: () => restTickerGate(syms),
      OKX: () => restTickerOkx(syms),
      Bybit: () => restTickerBybit(syms),
      Worker: async () => {
        const base = String(apiBase || "").replace(/\/$/, "");
        if (!base.startsWith("http")) throw new Error("skip");
        const qs = encodeURIComponent(JSON.stringify(syms));
        const res = await fetchUrl(`${base}/api/ticker/24hr?symbols=${qs}`, 5000);
        if (!res.ok) throw new Error("http");
        const rows = await res.json();
        if (!Array.isArray(rows) || !rows.length) throw new Error("empty");
        return rows;
      },
      "Binance-Vision": () => restTickerBinance("https://data-api.binance.vision", syms),
      Binance: () => restTickerBinance("https://api.binance.com", syms),
    };
    const order = orderedVenues();
    if (feedRegion() === "cn") {
      const sticky = loadStickyVenue();
      if (sticky && tries[sticky]) {
        try {
          const rows = await tries[sticky]();
          if (rows && rows.length) {
            lastMeta.venue = sticky;
            saveStickyVenue(sticky);
            return rows;
          }
        } catch {
          /* fall through */
        }
      }
      const cnRuns = order
        .slice(0, CN_RACE)
        .map((venue) => ({ venue, run: tries[venue] }))
        .filter((x) => x.run);
      try {
        const winner = await Promise.any(
          cnRuns.map(async ({ venue, run }) => {
            const rows = await run();
            if (!rows || !rows.length) throw new Error("empty");
            return { venue, rows };
          }),
        );
        lastMeta.venue = winner.venue;
        saveStickyVenue(winner.venue);
        return winner.rows;
      } catch {
        /* fall through */
      }
    }
    for (let i = 0; i < order.length; i++) {
      const venue = order[i];
      const run = tries[venue];
      if (!run) continue;
      try {
        const rows = await run();
        if (rows && rows.length) {
          lastMeta.venue = venue;
          saveStickyVenue(venue);
          return rows;
        }
      } catch {
        /* next venue */
      }
    }
    return [];
  }

  /** Live mini-ticker WS (Binance) + REST fallback + synthetic jitter for header / rail quotes */
  function subscribeMarketTickers(symbols, onTick) {
    const syms = (Array.isArray(symbols) ? symbols : [symbols])
      .map((s) => {
        const raw = String(s || "").toUpperCase();
        return COIN_ALIAS[raw] || raw;
      })
      .filter((s) => s && !DEAD_SYMBOLS[s])
      .filter((s, i, arr) => arr.indexOf(s) === i);
    if (!syms.length || typeof onTick !== "function") return { close: () => {} };

    let closed = false;
    let ws = null;
    let pollTimer = null;
    let jitterTimer = null;
    let urlIdx = 0;
    let wsLive = false;
    let lastTickAt = 0;
    const lastPx = {};
    const lastChg = {};

    function wsUrls() {
      const streams = syms.map((s) => `${s.toLowerCase()}@miniTicker`).join("/");
      return [
        `wss://stream.binance.com:9443/stream?streams=${streams}`,
        `wss://data-stream.binance.vision/stream?streams=${streams}`,
      ];
    }

    function emitRow(row) {
      if (!row || !row.symbol) return;
      try {
        const sym = String(row.symbol).toUpperCase();
        if (DEAD_SYMBOLS[sym]) return;
        const px = Number(row.lastPrice);
        if (Number.isFinite(px)) lastPx[sym] = px;
        const chg = Number(row.priceChangePercent);
        if (Number.isFinite(chg)) lastChg[sym] = chg;
        onTick(row);
      } catch {
        /* isolate one symbol */
      }
    }

    function emitRows(rows) {
      if (!rows || !rows.length) return;
      rows.forEach(emitRow);
    }

    function seedSynth() {
      syms.forEach((sym) => {
        if (lastPx[sym] != null) return;
        const px = BASE_PX[sym];
        if (!Number.isFinite(px)) return;
        lastPx[sym] = px;
        lastChg[sym] = 0;
        emitRow({
          symbol: sym,
          lastPrice: String(px),
          priceChangePercent: "0.00",
        });
      });
    }

    function startJitter() {
      if (jitterTimer) return;
      jitterTimer = setInterval(() => {
        if (closed) return;
        if (wsLive && lastTickAt && Date.now() - lastTickAt < 3500) return;
        syms.forEach((sym) => {
          try {
            const last = Number(lastPx[sym] != null ? lastPx[sym] : BASE_PX[sym]);
            if (!Number.isFinite(last)) return;
            const next = last * (1 + (Math.random() * 0.0006 - 0.0003));
            lastPx[sym] = next;
            emitRow({
              symbol: sym,
              lastPrice: String(next),
              priceChangePercent: String(lastChg[sym] != null ? lastChg[sym] : 0),
            });
          } catch {
            /* isolate */
          }
        });
      }, 900);
    }

    function startPoll(ms) {
      if (pollTimer) clearInterval(pollTimer);
      const tick = async () => {
        if (closed) return;
        if (wsLive && lastTickAt && Date.now() - lastTickAt < 3500) {
          clearInterval(pollTimer);
          pollTimer = null;
          return;
        }
        try {
          emitRows(await fetchTicker24h(syms));
        } catch {
          /* keep last quote */
        }
      };
      tick();
      pollTimer = setInterval(tick, ms);
    }

    function connectWs() {
      if (closed) return;
      const urls = wsUrls();
      if (urlIdx >= urls.length) {
        wsLive = false;
        startPoll(2000);
        return;
      }
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          if (ws.readyState === 0 || ws.readyState === 1) ws.close();
        } catch {
          /* */
        }
        ws = null;
      }
      try {
        ws = new WebSocket(urls[urlIdx]);
      } catch {
        urlIdx += 1;
        connectWs();
        return;
      }
      ws.onopen = () => {
        wsLive = true;
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!msg || msg.error) return;
        const packets = Array.isArray(msg) ? msg : [msg];
        packets.forEach((item) => {
          try {
            const d = item && item.data;
            if (!d || !d.s) return;
            const sym = String(d.s).toUpperCase();
            if (DEAD_SYMBOLS[sym]) return;
            lastTickAt = Date.now();
            emitRow({
              symbol: sym,
              lastPrice: String(d.c),
              priceChangePercent: String(d.P != null ? d.P : lastChg[sym] != null ? lastChg[sym] : "0"),
            });
          } catch {
            /* isolate one coin */
          }
        });
      };
      const retry = () => {
        if (closed) return;
        wsLive = false;
        try {
          if (ws) ws.close();
        } catch {
          /* */
        }
        ws = null;
        urlIdx += 1;
        startPoll(2000);
        setTimeout(connectWs, 1200);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* */
        }
      };
      ws.onclose = retry;
    }

    seedSynth();
    startJitter();
    connectWs();
    setTimeout(() => {
      if (closed) return;
      if (!(wsLive && lastTickAt && Date.now() - lastTickAt < 2500)) startPoll(2000);
    }, 2500);

    return {
      close() {
        closed = true;
        wsLive = false;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        if (jitterTimer) clearInterval(jitterTimer);
        jitterTimer = null;
        try {
          if (ws) ws.close();
        } catch {
          /* */
        }
        ws = null;
      },
      isLive: () => wsLive,
    };
  }

  function packI18n() {
    if (root.QALang && typeof root.QALang.current === "function") {
      const lang = root.QALang.current();
      return (root.I18N && (root.I18N[lang] || root.I18N.en || root.I18N["zh-Hant"])) || {};
    }
    const lang = (typeof localStorage !== "undefined" && (localStorage.getItem("quant_lang") || localStorage.getItem("user_lang"))) || "en";
    const mapped = lang === "zh-Hans" ? "zh-CN" : lang;
    return (root.I18N && (root.I18N[mapped] || root.I18N.en || root.I18N["zh-Hant"])) || {};
  }

  function parseKlineRow(row) {
    return {
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    };
  }

  function okxInst(sym) {
    const s = String(sym || "BTCUSDT").toUpperCase();
    if (s.includes("-")) return s;
    return s.replace(/USDT$/, "-USDT").replace(/USDC$/, "-USDC");
  }

  async function fetchUrl(url, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 5000) : null;
    try {
      return await fetch(url, ctrl ? { signal: ctrl.signal } : {});
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function snapshotBars(interval) {
    const off = root.QAOffline;
    if (!off) return [];
    lastMeta.source = "offline";
    lastMeta.venue = "";
    lastMeta.updatedAt = off.updatedAt || "";
    return off.forInterval(interval);
  }

  async function restBinance(host, symbol, interval, limit, endTime) {
    let qs = `symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    if (endTime) qs += "&endTime=" + encodeURIComponent(String(endTime));
    const res = await fetchUrl(`${host}/api/v3/klines?${qs}`, 5000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("empty");
    return data.map(parseKlineRow);
  }

  async function restOkx(symbol, interval, limit) {
    const bar = OKX_BAR[interval] || "1m";
    const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(okxInst(symbol))}&bar=${bar}&limit=${Math.min(300, limit)}`;
    const res = await fetchUrl(url, 5000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.data) || [];
    if (!rows.length) throw new Error("empty");
    return rows
      .slice()
      .reverse()
      .map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));
  }

  async function restBybit(symbol, interval, limit) {
    const iv = BYBIT_IV[interval] || "1";
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${iv}&limit=${Math.min(1000, limit)}`;
    const res = await fetchUrl(url, 5000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.result && data.result.list) || [];
    if (!rows.length) throw new Error("empty");
    return rows
      .slice()
      .reverse()
      .map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));
  }

  async function restWorker(apiBase, symbol, interval, limit) {
    const base = String(apiBase || "").replace(/\/$/, "");
    const url =
      `${base}/api/klines?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}&limit=${Math.min(1000, limit)}`;
    const res = await fetchUrl(url, cnFetchMs());
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("empty");
    return data.map(parseKlineRow);
  }

  async function restHtx(symbol, interval, limit) {
    const sym = htxSym(symbol);
    const period = HTX_PERIOD[interval] || "60min";
    const size = Math.min(2000, Math.max(1, Number(limit) || 200));
    const url =
      `https://api.huobi.pro/market/history/kline?symbol=${encodeURIComponent(sym)}` +
      `&period=${encodeURIComponent(period)}&size=${size}`;
    const res = await fetchUrl(url, cnFetchMs());
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.data) || [];
    if (data.status !== "ok" || !rows.length) throw new Error("empty");
    return rows
      .map((b) => ({
        time: Number(b.id),
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.vol),
      }))
      .sort((a, b) => a.time - b.time);
  }

  async function restMexc(symbol, interval, limit, endTime) {
    const iv = MEXC_IV[interval] || "1m";
    let qs = `symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(iv)}&limit=${Math.min(1000, limit)}`;
    if (endTime) qs += "&endTime=" + encodeURIComponent(String(endTime));
    const res = await fetchUrl(`https://api.mexc.com/api/v3/klines?${qs}`, cnFetchMs());
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("empty");
    return data.map(parseKlineRow);
  }

  async function restGate(symbol, interval, limit, endTime) {
    const pair = gatePair(symbol);
    const iv = GATE_IV[interval] || "1h";
    let url =
      `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}` +
      `&interval=${encodeURIComponent(iv)}&limit=${Math.min(1000, limit)}`;
    if (endTime) url += "&to=" + encodeURIComponent(String(Math.floor(Number(endTime) / 1000)));
    const res = await fetchUrl(url, cnFetchMs());
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("empty");
    return data
      .map((r) => ({
        time: Number(r[0]),
        open: Number(r[5]),
        high: Number(r[3]),
        low: Number(r[4]),
        close: Number(r[2]),
        volume: Number(r[6] || r[1] || 0),
      }))
      .sort((a, b) => a.time - b.time);
  }

  async function restBitget(symbol, interval, limit, endTime) {
    const iv = BITGET_IV[interval] || "1h";
    let url =
      `https://api.bitget.com/api/v2/spot/market/candles?symbol=${encodeURIComponent(symbol)}` +
      `&granularity=${encodeURIComponent(iv)}&limit=${Math.min(1000, limit)}`;
    if (endTime) url += "&endTime=" + encodeURIComponent(String(endTime));
    const res = await fetchUrl(url, cnFetchMs());
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.data) || [];
    if (!rows.length) throw new Error("empty");
    return rows
      .slice()
      .reverse()
      .map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));
  }

  function filterRestTries(tries, endTime, apiBase) {
    return tries.filter((item) => {
      if (item.venue === "Worker" && !String(apiBase).startsWith("http")) return false;
      if (endTime && NO_HISTORY.has(item.venue)) return false;
      return true;
    });
  }

  async function raceRestTries(tries) {
    const racers = tries.slice(0, CN_RACE);
    if (racers.length < 2) return null;
    try {
      const winner = await Promise.any(
        racers.map(async (item) => {
          const rows = await item.run();
          if (!rows || !rows.length) throw new Error("empty");
          return { rows, venue: item.venue };
        }),
      );
      lastMeta.source = "live";
      lastMeta.venue = winner.venue;
      lastMeta.updatedAt = "";
      saveStickyVenue(winner.venue);
      return winner.rows;
    } catch {
      return null;
    }
  }

  async function tryStickyRestItem(tries) {
    const sticky = loadStickyVenue();
    if (!sticky) return null;
    const item = tries.find((t) => t.venue === sticky);
    if (!item) return null;
    try {
      const rows = await item.run();
      if (rows && rows.length) {
        lastMeta.source = "live";
        lastMeta.venue = sticky;
        lastMeta.updatedAt = "";
        saveStickyVenue(sticky);
        return rows;
      }
    } catch {
      /* next path */
    }
    return null;
  }

  async function fetchKlines(symbol, interval, limit) {
    const sym = String(symbol || "BTCUSDT").toUpperCase();
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const need = Math.min(2000, Math.max(1, Number(limit) || 1000));
    const apiBase = (root.QUANT_CONFIG && root.QUANT_CONFIG.apiBase) || "";
    async function once(lim, endTime) {
      const tries = filterRestTries(buildRestTries(sym, iv, lim, endTime, apiBase), endTime, apiBase);
      if (!endTime) {
        const stickyRows = await tryStickyRestItem(tries);
        if (stickyRows && stickyRows.length) return stickyRows;
      }
      if (feedRegion() === "cn" && !endTime) {
        const raced = await raceRestTries(tries);
        if (raced && raced.length) return raced;
      }
      for (const item of tries) {
        try {
          const rows = await item.run();
          if (rows && rows.length) {
            lastMeta.source = "live";
            lastMeta.venue = item.venue;
            lastMeta.updatedAt = "";
            saveStickyVenue(item.venue);
            return rows;
          }
        } catch {
          /* next venue */
        }
      }
      return [];
    }
    let rows = await once(Math.min(1000, need), null);
    while (rows.length && rows.length < need) {
      const oldest = rows[0];
      const more = await once(Math.min(1000, need - rows.length), oldest.time * 1000 - 1);
      if (!more.length) break;
      const seen = new Set(rows.map((b) => b.time));
      const older = more.filter((b) => !seen.has(b.time));
      if (!older.length) break;
      rows = older.concat(rows);
    }
    if (rows.length) return rows;
    const snap = snapshotBars(iv);
    if (snap.length) return snap;
    throw new Error("klines failed");
  }

  function setFeedStatus(el, state, extra) {
    if (!el) return;
    const p = packI18n();
    const cls = {
      connecting: "wait",
      live: "live",
      rest: "live",
      retry: "err",
      switch: "err",
      reconnect: "err",
      fail: "err",
      offline: "err",
    };
    el.className = "feed-status " + (cls[state] || "warn");
    let text = p.feedRecon || "● 數據重連中";
    if (state === "live" || state === "rest") text = p.feedOk || "● 實時信號暢通";
    else if (state === "connecting") text = p.feedWait || "● 數據重連中";
    else text = p.feedRecon || "● 數據重連中";
    el.textContent = text;
  }

  function barFromBinanceK(k) {
    return {
      time: Math.floor(k.t / 1000),
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
      closed: Boolean(k.x),
    };
  }

  function connectVenue({ venue, symbol, interval, onKline, onStatus, onGiveUp }) {
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const sym = String(symbol || "BTCUSDT");
    let ws = null;
    let closed = false;
    let stale = null;
    let ping = null;

    function die() {
      if (closed) return;
      closed = true;
      if (stale) clearTimeout(stale);
      if (ping) clearInterval(ping);
      try {
        if (ws) ws.close();
      } catch {
        /* */
      }
      if (onGiveUp) onGiveUp();
    }

    function touch() {
      if (stale) clearTimeout(stale);
      stale = setTimeout(die, STALE_MS);
    }

    function emit(bar) {
      lastMeta.venue = venue;
      lastMeta.source = "live";
      saveStickyVenue(venue);
      if (onStatus) onStatus("live", { venue });
      onKline(bar);
      touch();
    }

    if (onStatus) onStatus("connecting", { venue });

    try {
      if (venue === "Binance") {
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@kline_${iv}`);
      } else if (venue === "Binance-Vision") {
        ws = new WebSocket(`wss://data-stream.binance.vision/ws/${sym.toLowerCase()}@kline_${iv}`);
      } else if (venue === "OKX") {
        ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/business");
      } else if (venue === "Bybit") {
        ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");
      } else if (venue === "HTX") {
        ws = new WebSocket("wss://api.huobi.pro/ws");
      } else if (venue === "MEXC") {
        ws = new WebSocket("wss://wbs-api.mexc.com/ws");
      } else if (venue === "Bitget") {
        ws = new WebSocket("wss://ws.bitget.com/v2/ws/public");
      } else {
        die();
        return { close: die };
      }
    } catch {
      die();
      return { close: die };
    }

    const htxTopic = venue === "HTX" ? `market.${htxSym(sym)}.kline.${HTX_PERIOD[iv] || "1min"}` : "";

    ws.onopen = () => {
      touch();
      if (venue === "OKX") {
        ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "candle" + (OKX_BAR[iv] || "1m"), instId: okxInst(sym) }] }));
        ping = setInterval(() => {
          try {
            ws.send("ping");
          } catch {
            /* */
          }
        }, 15000);
      }
      if (venue === "Bybit") {
        ws.send(JSON.stringify({ op: "subscribe", args: [`kline.${BYBIT_IV[iv] || "1"}.${sym.toUpperCase()}`] }));
        ping = setInterval(() => {
          try {
            ws.send(JSON.stringify({ op: "ping" }));
          } catch {
            /* */
          }
        }, 15000);
      }
      if (venue === "HTX") {
        ws.send(JSON.stringify({ sub: htxTopic, id: "qa" + Date.now() }));
      }
      if (venue === "MEXC") {
        ws.send(
          JSON.stringify({
            method: "SUBSCRIPTION",
            params: [`spot@public.kline.v3.api@${sym.toUpperCase()}@${MEXC_WS_IV[iv] || "Min1"}`],
          }),
        );
      }
      if (venue === "Bitget") {
        ws.send(
          JSON.stringify({
            op: "subscribe",
            args: [{ instType: "SPOT", channel: BITGET_WS_IV[iv] || "candle1m", instId: sym.toUpperCase() }],
          }),
        );
        ping = setInterval(() => {
          try {
            ws.send("ping");
          } catch {
            /* */
          }
        }, 15000);
      }
    };

    ws.onmessage = (ev) => {
      try {
        if (venue === "HTX") {
          parseHtxWsPayload(ev.data)
            .then((msg) => {
              if (msg.ping) {
                ws.send(JSON.stringify({ pong: msg.ping }));
                touch();
                return;
              }
              const tick = msg.tick;
              if (tick) {
                emit({
                  time: Number(tick.id),
                  open: Number(tick.open),
                  high: Number(tick.high),
                  low: Number(tick.low),
                  close: Number(tick.close),
                  volume: Number(tick.vol),
                  closed: false,
                });
              } else touch();
            })
            .catch(() => touch());
          return;
        }
        if (typeof ev.data === "string" && ev.data === "pong") {
          touch();
          return;
        }
        const msg = JSON.parse(ev.data);
        if (venue === "Binance" || venue === "Binance-Vision") {
          if (msg.k) emit(barFromBinanceK(msg.k));
          return;
        }
        if (venue === "OKX") {
          const row = msg.data && msg.data[0];
          if (!row) {
            touch();
            return;
          }
          emit({
            time: Math.floor(Number(row[0]) / 1000),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
            closed: String(row[8]) === "1",
          });
          return;
        }
        if (venue === "MEXC") {
          const k = msg.d && msg.d.k;
          if (k) {
            emit({
              time: Math.floor(Number(k.t) / 1000),
              open: Number(k.o),
              high: Number(k.h),
              low: Number(k.l),
              close: Number(k.c),
              volume: Number(k.v),
              closed: Boolean(k.x),
            });
          } else touch();
          return;
        }
        if (venue === "Bitget") {
          if (msg.event === "error") {
            die();
            return;
          }
          const row = msg.data && msg.data[0];
          if (Array.isArray(row)) {
            emit({
              time: Math.floor(Number(row[0]) / 1000),
              open: Number(row[1]),
              high: Number(row[2]),
              low: Number(row[3]),
              close: Number(row[4]),
              volume: Number(row[5]),
              closed: false,
            });
          } else touch();
          return;
        }
        const k = msg.data && msg.data[0];
        if (k) {
          emit({
            time: Math.floor(Number(k.start) / 1000),
            open: Number(k.open),
            high: Number(k.high),
            low: Number(k.low),
            close: Number(k.close),
            volume: Number(k.volume),
            closed: Boolean(k.confirm),
          });
        } else touch();
      } catch {
        touch();
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!closed) die();
    };
    stale = setTimeout(die, STALE_MS);

    return {
      close() {
        closed = true;
        if (stale) clearTimeout(stale);
        if (ping) clearInterval(ping);
        try {
          if (ws) ws.close();
        } catch {
          /* */
        }
      },
    };
  }

  function createLiveStream({ symbol, interval, onKline, onStatus, preferRest }) {
    let sock = null;
    let pollTimer = null;
    let closed = false;
    const venues = orderedVenues();
    let idx = Math.min(startNode, Math.max(venues.length - 1, 0));
    let restFails = 0;

    function stopPoll() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPoll() {
      if (closed || pollTimer) return;
      const tick = async () => {
        if (closed) return;
        try {
          const rows = await fetchKlines(symbol, interval, 2);
          if (lastMeta.source === "offline") {
            restFails += 1;
            if (onStatus) onStatus("offline", { updatedAt: lastMeta.updatedAt });
            if (restFails >= 2) stopPoll();
            return;
          }
          restFails = 0;
          const last = rows[rows.length - 1];
          if (last) onKline({ ...last, closed: false });
          if (onStatus) onStatus("rest", { venue: lastMeta.venue });
        } catch {
          restFails += 1;
          if (onStatus) onStatus("retry", { countdown: 3 });
          if (restFails >= 4 && onStatus) onStatus("offline", { updatedAt: lastMeta.updatedAt });
        }
      };
      tick();
      pollTimer = setInterval(tick, 3000);
    }

    function nextWs() {
      if (closed) return;
      if (sock) {
        sock.close();
        sock = null;
      }
      if (idx >= venues.length) {
        startPoll();
        return;
      }
      const venue = venues[idx];
      idx += 1;
      if (onStatus) onStatus("switch", { venue });
      sock = connectVenue({
        venue,
        symbol,
        interval,
        onKline,
        onStatus,
        onGiveUp: nextWs,
      });
    }

    if (preferRest || root.QAFeed.preferRest) startPoll();
    else nextWs();

    return {
      close() {
        closed = true;
        stopPoll();
        if (sock) sock.close();
      },
    };
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function unixOf(time) {
    if (typeof time === "number") return time;
    if (time && time.year) return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
    return 0;
  }

  function hmLocal(ts) {
    const d = new Date(ts * 1000);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function mdLocal(ts) {
    const d = new Date(ts * 1000);
    return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function mdHmLocal(ts) {
    const date = new Date(ts * 1000);
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    const h = date.getHours().toString().padStart(2, "0");
    const min = date.getMinutes().toString().padStart(2, "0");
    return m + "-" + d + " " + h + ":" + min;
  }

  function isIntraday(interval) {
    return ["1s", "1m", "5m", "15m", "1h", "4h"].includes(interval);
  }

  function chartOptions(el, height, interval) {
    const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
    const intra = isIntraday(interval || "1m");
    return {
      width: Math.max(el.clientWidth || 0, 280),
      height,
      layout: {
        background: { color: "#ffffff" },
        backgroundColor: "#ffffff",
        textColor: "#000000",
        fontSize: mobile ? 10 : 12,
      },
      grid: {
        vertLines: { visible: !mobile, color: "#e2e8f0" },
        horzLines: { visible: true, color: "#e2e8f0" },
      },
      rightPriceScale: {
        borderColor: "#000000",
        autoScale: true,
        minimumWidth: mobile ? 28 : 52,
        borderVisible: !mobile,
        scaleMargins: mobile ? { top: 0.06, bottom: 0.08 } : { top: 0.1, bottom: 0.1 },
      },
      localization: {
        dateFormat: "yyyy-MM-dd",
        timeFormatter: (time) => {
          const ts = unixOf(time);
          if (!intra) return mdLocal(ts);
          // Mobile screens are too narrow for "MM-DD HH:mm" without wrapping/
          // overlap — drop the date prefix there and show plain HH:mm.
          return mobile ? hmLocal(ts) : mdHmLocal(ts);
        },
      },
      timeScale: {
        borderColor: "#000000",
        timeVisible: intra,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        rightBarStaysOnScroll: true,
        lockVisibleTimeRangeOnResize: true,
        minimumHeight: mobile ? 22 : 28,
        borderVisible: !mobile,
        tickMarkFormatter: (time) => {
          const ts = unixOf(time);
          if (!intra) return mdLocal(ts);
          return mobile ? hmLocal(ts) : mdHmLocal(ts);
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        pinch: true,
      },
      kineticScroll: { touch: true, mouse: false },
      attributionLogo: !mobile,
    };
  }

  root.QAFeed = {
    INTERVALS,
    ALL_VENUES,
    VENUE_ORDER,
    orderedVenues,
    feedRegion,
    feedCountry,
    stickyVenue: loadStickyVenue,
    venueLatencies: () => ({ ...(regionVenueLatencies || {}), ...cnVenueLatencies }),
    initFeedGeo,
    probeCnVenues: runCnVenueProbe,
    probeVenues: runVenueProbe,
    warmup: warmupFeed,
    readyGeo: readyFeed,
    resetRegion,
    fetchKlines,
    fetchTicker24h,
    subscribeMarketTickers,
    createLiveStream,
    setFeedStatus,
    lastMeta,
    preferRest: false,
    chartOptions,
    nextNode() {
      const venues = orderedVenues();
      startNode = (startNode + 1) % Math.max(venues.length, 1);
    },
  };
  root.UniversalFeedManager = root.QAFeed;
  kickAutoWarmup();
})(typeof window !== "undefined" ? window : globalThis);
