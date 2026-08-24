/**
 * Organic Meta / analytics event dispatch — same rules for every visitor.
 * PageView on load; ViewContent after real engagement + random delay;
 * Lead only after explicit subscribe CTA.
 */
(function (root) {
  const cfg = root.QUANT_CONFIG || {};
  const STATE = {
    pageViewSent: false,
    viewContentArmed: false,
    viewContentSent: false,
    leadSent: false,
    engaged: false,
    timer: null,
  };

  function pixelId() {
    return String(cfg.metaPixelId || cfg.META_PIXEL_ID || "").trim();
  }

  function ensureFbq() {
    const id = pixelId();
    if (!id) return false;
    if (typeof root.fbq === "function") return true;
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(root, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    root.fbq("init", id);
    return true;
  }

  function hubBase() {
    return String(cfg.hubApiBase || "").replace(/\/$/, "");
  }

  function postHub(eventName, extra) {
    const base = hubBase();
    if (!base) return;
    const body = Object.assign(
      {
        event_name: eventName,
        event_source_url: root.location && root.location.href,
        fbclid: (root.QALeadBind && root.QALeadBind.fbclidFromLocation && root.QALeadBind.fbclidFromLocation()) || "",
        user_agent: (navigator && navigator.userAgent) || "",
      },
      extra || {},
    );
    try {
      fetch(base + "/api/capi/event", {
        method: "POST",
        headers: { "content-type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        mode: "cors",
        credentials: "omit",
        keepalive: true,
      }).catch(function () {});
    } catch {
      /* */
    }
  }

  function track(eventName, opts) {
    const o = opts || {};
    if (ensureFbq()) {
      try {
        root.fbq("track", eventName, o.params || {}, o.eventID ? { eventID: o.eventID } : undefined);
      } catch {
        /* */
      }
    }
    postHub(eventName, o.params || {});
  }

  function randBetween(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function markEngaged() {
    if (STATE.engaged) return;
    STATE.engaged = true;
    armViewContent();
  }

  function armViewContent() {
    if (STATE.viewContentArmed || STATE.viewContentSent) return;
    STATE.viewContentArmed = true;
    const delayMs = randBetween(30, 120) * 1000;
    STATE.timer = setTimeout(function () {
      if (STATE.viewContentSent || !STATE.engaged) return;
      STATE.viewContentSent = true;
      track("ViewContent", {
        params: { content_name: "research_terminal", content_category: "quant_lab" },
      });
    }, delayMs);
  }

  function trackPageView() {
    if (STATE.pageViewSent) return;
    STATE.pageViewSent = true;
    track("PageView");
  }

  function trackLead(extra) {
    if (STATE.leadSent) return;
    STATE.leadSent = true;
    track("Lead", {
      params: Object.assign({ content_name: "node_stream_subscribe" }, extra || {}),
    });
  }

  function bindEngagement() {
    let scrolled = false;
    let dwellTimer = setTimeout(markEngaged, 45000);
    function onScroll() {
      const doc = document.documentElement;
      const body = document.body;
      const scrollTop = root.pageYOffset || doc.scrollTop || body.scrollTop || 0;
      const height = Math.max(doc.scrollHeight, body.scrollHeight) - root.innerHeight;
      if (height <= 0) return;
      if (scrollTop / height >= 0.6) {
        scrolled = true;
        markEngaged();
        root.removeEventListener("scroll", onScroll);
      }
    }
    root.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener(
      "click",
      function (ev) {
        const el = ev.target && ev.target.closest && ev.target.closest("[data-engine], .term-tab, .period-pill, .plaza-card, .coin-card, .hb-card tr");
        if (el) markEngaged();
      },
      true,
    );
    document.addEventListener(
      "pointermove",
      function once() {
        markEngaged();
        document.removeEventListener("pointermove", once, true);
      },
      true,
    );
    root.addEventListener("pagehide", function () {
      clearTimeout(dwellTimer);
      if (STATE.timer) clearTimeout(STATE.timer);
    });
    void scrolled;
  }

  function boot() {
    trackPageView();
    bindEngagement();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  root.QAMetaEvents = {
    trackPageView: trackPageView,
    trackViewContent: function () {
      STATE.engaged = true;
      STATE.viewContentSent = true;
      track("ViewContent", { params: { content_name: "research_terminal" } });
    },
    trackLead: trackLead,
    markEngaged: markEngaged,
  };
})(typeof window !== "undefined" ? window : globalThis);
