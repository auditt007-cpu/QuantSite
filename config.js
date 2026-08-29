window.QUANT_CONFIG = {

  apiBase: "https://quant-saas-api.quant-alpha-desk.workers.dev",

  hubApiBase: "https://api.quantalpha.space",

  leaderboardUrl: "./leaderboard.json",

  usdtWallet: "TDo1RvTCh8jHawjW4rMkri4MpZwc4Wxn2P",

  /* Community / node stream — never hardcode t.me in HTML */

  COMMUNITY_ENDPOINT: "https://t.me/grid_quant_bot",

  /* 转化导流：一键进群深链接参数（废弃网页端登录后的主入口） */
  JOIN_BOT_START: "web_free_group",
  JOIN_LABEL: "免费加入 Telegram 信号群",
  JOIN_BOT_URL: "https://t.me/grid_quant_bot?start=web_free_group",

  COMMUNITY_BIND_PATH: "?start=bind",

  tgChannelUrl: "https://t.me/quant_alpha_signals",

  tgChannelUser: "@quant_alpha_signals",

  tgBotUser: "@grid_quant_bot",

  tgBotUrl: "https://t.me/grid_quant_bot",

  tgSupportUrl: "https://t.me/grid_quant_bot",

  inviteNeed: 2,

  /* Public Meta Pixel id only (no access token in the browser) */

  metaPixelId: "",

};



(function (root) {

  const cfg = root.QUANT_CONFIG || {};



  function communityEndpoint(startParam) {

    const base = String(cfg.COMMUNITY_ENDPOINT || cfg.tgBotUrl || "").replace(/\/$/, "");

    if (!base) return "#";

    if (startParam) {

      const join = base.indexOf("?") >= 0 ? "&" : "?";

      return base + join + "start=" + encodeURIComponent(String(startParam));

    }

    return base;

  }



  function communityBindUrl() {

    const base = String(cfg.COMMUNITY_ENDPOINT || cfg.tgBotUrl || "").replace(/\/$/, "");

    const path = String(cfg.COMMUNITY_BIND_PATH || "?start=bind");

    if (!base) return "#";

    if (path.charAt(0) === "?" || path.charAt(0) === "&") return base + path;

    return base.replace(/\/$/, "") + "/" + path.replace(/^\//, "");

  }



  function openCommunity(startParam) {

    const url = startParam ? communityEndpoint(startParam) : communityEndpoint();

    if (!url || url === "#") return false;

    root.open(url, "_blank", "noopener,noreferrer");

    return true;

  }



  root.QACommunity = {

    endpoint: communityEndpoint,

    bindUrl: communityBindUrl,

    open: openCommunity,

  };

})(typeof window !== "undefined" ? window : globalThis);


