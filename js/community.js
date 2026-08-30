/* Community entry helper: route all "get strategy / join group" CTAs to the TG bot.
   Replaces the retired Meta attribution flow (lead-bind.js) with a plain bot deep-link. */
(function (root) {
  var cfg = root.QUANT_CONFIG || {};
  var BOT_URL = cfg.JOIN_BOT_URL || "https://t.me/grid_quant_bot?start=web_free_group";

  function hit(el) {
    if (!el || !el.closest) return false;
    if (el.closest("#paySupport")) return false;
    return !!el.closest(
      "[data-get-strategy], [data-community-open], #btnGetStrategy, #btnChannel, #btnChannel2, #btnOpenBot, a.cta-btn-gold"
    );
  }

  document.addEventListener(
    "click",
    function (ev) {
      var el = ev.target && ev.target.closest && ev.target.closest("a, button");
      if (!hit(el)) return;
      ev.preventDefault();
      ev.stopPropagation();
      root.open(BOT_URL, "_blank", "noopener,noreferrer");
    },
    true
  );
})(typeof window !== "undefined" ? window : globalThis);
