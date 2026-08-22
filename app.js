const cfg = window.QUANT_CONFIG;
const $ = (id) => document.getElementById(id);
let lang = "zh-Hant";

function t(key) {
  const pack = window.I18N[lang] || window.I18N["zh-Hant"];
  return pack[key] || window.I18N["zh-Hant"][key] || key;
}

function detectLang() {
  const saved = localStorage.getItem("quant_lang");
  if (saved && window.I18N[saved]) return saved;
  return "zh-Hant";
}

function loggedIn() {
  if (window.QAAuth && typeof window.QAAuth.loggedIn === "function") return window.QAAuth.loggedIn();
  return Boolean(localStorage.getItem("quant_tg"));
}

function applyAuthUi() {
  const hint = document.querySelector(".micro-tag");
  if (hint) hint.style.display = "none";
  const tg = localStorage.getItem("quant_tg") || "";
  if ($("dashUser")) $("dashUser").textContent = tg ? "Telegram ID  " + tg : "";
  const vip = localStorage.getItem("quant_paid") === "1";
  if ($("nodeName")) $("nodeName").textContent = vip ? t("nodePro") : t("nodeBasic");
  if ($("dashLevel")) $("dashLevel").textContent = vip ? t("seatVip") : t("seatFree");
  if (loggedIn() && !localStorage.getItem("quant_join_at")) {
    localStorage.setItem("quant_join_at", String(Date.now()));
  }
  const hook = $("hookUrl");
  if (hook && cfg.apiBase) {
    const url = cfg.apiBase.replace(/\/$/, "") + "/api/webhook-relay";
    hook.textContent = url;
    const tgId = localStorage.getItem("quant_tg") || "";
    const payload = JSON.stringify(
      { symbol: "{{ticker}}", action: "{{strategy.order.action}}", price: "{{close}}", tg_id: tgId },
      null,
      2,
    );
    if ($("hookPayload")) $("hookPayload").textContent = payload;
  }
  refreshInviteUi();
  window.dispatchEvent(new Event("quant-auth"));
}

function applyI18n() {
  document.documentElement.lang = lang === "en" ? "en" : lang === "zh-CN" ? "zh-CN" : "zh-Hant";
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    if (el.id === "nodeName" || el.id === "dashLevel" || el.id === "mCap" || el.id === "mWin" || el.id === "mPf" || el.id === "mDd" || el.id === "btnAuth" || el.id === "idPill" || el.id === "refCount") return;
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-ph]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-ph"));
  });
  if ($("txid") && !$("txid").getAttribute("data-ph")) $("txid").placeholder = t("phTxid");
  document.querySelectorAll("[data-lang]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-lang") === lang);
  });
  applyAuthUi();
  applyDesk(false);
}

function toast(msg, kind) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show " + (kind || "ok");
  setTimeout(() => el.classList.remove("show"), 2400);
}

async function copyText(text, doneKey) {
  const fn = window.copyToClipboard;
  if (fn) {
    await fn(text, () => toast(t(doneKey || "copied"), "ok"));
    return;
  }
  toast(t("copyFail"), "err");
}

function uid() {
  let id = localStorage.getItem("quant_uid");
  if (!id) {
    id = "web_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("quant_uid", id);
  }
  return id;
}

async function api(path, opts = {}) {
  const res = await fetch(cfg.apiBase + path, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || "API " + res.status);
  return data;
}

function applyDesk() {}

function openModal(id) { $(id).classList.add("show"); }
function closeModal(id) { $(id).classList.remove("show"); }

function onAuthClick() {
  if (loggedIn()) {
    $("payDetail").hidden = true;
    applyAuthUi();
    openModal("dashModal");
  } else openModal("loginModal");
}

let loginBusy = false;

function lockUntil() {
  return Number(localStorage.getItem("quant_login_lock") || 0);
}

function failCount() {
  return Number(localStorage.getItem("quant_login_fails") || 0);
}

function bumpLoginFail() {
  const n = failCount() + 1;
  localStorage.setItem("quant_login_fails", String(n));
  if (n >= 5) localStorage.setItem("quant_login_lock", String(Date.now() + 15 * 60 * 1000));
  return n;
}

function otpCells() {
  return Array.from(document.querySelectorAll(".otp-cell"));
}

function otpRead() {
  const v = otpCells().map((el) => el.value.replace(/\D/g, "")).join("").slice(0, 4);
  if ($("loginCode")) $("loginCode").value = v;
  return v;
}

function otpWrite(str) {
  const s = String(str || "").replace(/\D/g, "").slice(0, 4);
  otpCells().forEach((el, i) => {
    el.value = s[i] || "";
  });
  if ($("loginCode")) $("loginCode").value = s;
}

function wireOtp() {
  const cells = otpCells();
  if (!cells.length) return;
  cells.forEach((el, i) => {
    el.addEventListener("input", () => {
      el.value = el.value.replace(/\D/g, "").slice(-1);
      otpRead();
      if (el.value && cells[i + 1]) cells[i + 1].focus();
      if (otpRead().length === 4) doLogin();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !el.value && cells[i - 1]) cells[i - 1].focus();
      if (e.key === "Enter") doLogin();
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      otpWrite((e.clipboardData || window.clipboardData).getData("text"));
      if (otpRead().length === 4) doLogin();
    });
  });
}

async function doLogin() {
  const st = $("loginStatus");
  const btn = $("btnDoLogin");
  if (loginBusy) return;
  const until = lockUntil();
  if (until > Date.now()) {
    st.className = "status err";
    st.textContent = t("locked");
    return;
  }
  const code = otpRead() || String($("loginCode").value || "").replace(/\D/g, "").slice(0, 4);
  otpWrite(code);
  st.className = "status";
  if (!/^\d{4}$/.test(code)) {
    st.className = "status err";
    st.textContent = t("needLogin");
    return;
  }
  loginBusy = true;
  btn.disabled = true;
  btn.textContent = t("logging");
  st.textContent = t("logging");
  try {
    const data = await api("/api/bind-tg", {
      method: "POST",
      body: JSON.stringify({ code, parent_invite: parentInviteFromUrl() }),
    });
    if (!data || !data.ok || !data.tg_id) throw new Error(t("badCode"));
    localStorage.removeItem("quant_login_fails");
    localStorage.removeItem("quant_login_lock");
    if (window.QAAuth) window.QAAuth.persistSession(data.tg_id, data.token);
    else {
      localStorage.setItem("quant_tg", String(data.tg_id));
      localStorage.setItem("login_timestamp", String(Date.now()));
      if (data.token) localStorage.setItem("quant_token", String(data.token));
    }
    if (!localStorage.getItem("quant_join_at")) localStorage.setItem("quant_join_at", String(Date.now()));
    if (data.invite_code) localStorage.setItem("quant_invite", data.invite_code);
    if (data.invite_count != null) localStorage.setItem("quant_invites", String(data.invite_count));
    st.className = "status";
    st.textContent = t("logged");
    toast(t("logged"), "ok");
    applyAuthUi();
    closeModal("loginModal");
    openModal("dashModal");
  } catch (e) {
    const n = bumpLoginFail();
    st.className = "status err";
    if (lockUntil() > Date.now()) st.textContent = t("locked");
    else st.textContent = t("badCode") + " · " + t("leftTries").replace("{n}", String(Math.max(0, 5 - n)));
  } finally {
    loginBusy = false;
    btn.disabled = false;
    btn.textContent = t("doLogin");
  }
}

function parentInviteFromUrl() {
  const q = new URLSearchParams(location.search).get("ref");
  if (q) localStorage.setItem("quant_ref", q);
  return q || localStorage.getItem("quant_ref") || "";
}

async function refreshInviteUi() {
  const origin = location.origin + location.pathname.replace(/index\.html$/, "");
  const tg = localStorage.getItem("quant_tg");
  let code = localStorage.getItem("quant_invite") || "";
  let count = Number(localStorage.getItem("quant_invites") || "0");
  let avail = 0;
  let pend = 0;
  if (tg) {
    try {
      let res = await fetch(cfg.apiBase + "/api/affiliate?tg_id=" + encodeURIComponent(tg));
      let data = await res.json();
      if (!res.ok) throw new Error(data.error || "載入失敗");
      code = data.me?.invite_code || code;
      count = data.me?.invite_count ?? count;
      avail = Number(data.withdrawable || 0);
      pend = Number(data.pending || 0);
      if (data.me?.paid) localStorage.setItem("quant_paid", "1");
      if (data.me?.unlocked || (data.me?.invite_count || 0) >= 2) localStorage.setItem("quant_unlocked", "1");
      else localStorage.removeItem("quant_unlocked");
      localStorage.setItem("quant_invite", code);
      localStorage.setItem("quant_invites", String(count));
      const bar = $("refBar");
      if (bar) bar.style.width = Math.min(100, (count / 2) * 100) + "%";
    } catch {
      /* keep cached */
    }
  }
  $("inviteLink").textContent = code ? `${origin}?ref=${code}` : "—";
  const unit = lang === "en" ? " / 2 binds" : " / 2 人";
  $("refCount").textContent = `${count}${unit}`;
  const money = window.QAMoney;
  $("refAvail").textContent = money ? money.fmtUsdt(avail) : avail.toFixed(2) + " USDT";
  $("refPend").textContent = money ? money.fmtUsdt(pend) : pend.toFixed(2) + " USDT";
}

const LEGAL = {
  risk: {
    title: "風險披露聲明 (Risk Disclosure)",
    body: "數位資產與槓桿交易具有極高風險，可能導致本金全部損失。歷史回測績效不代表未來結果。請僅以可承受損失之資金參與研究。QUANT ALPHA TECHNOLOGIES LTD. 不對任何交易損益負責。",
  },
  tos: {
    title: "服務條款 (Terms of Service)",
    body: "使用本站即表示您同意：本平台提供量化回測展示、程式碼樣本與通知工具。您須自行遵守所在地法律。我們可因維護、合規或濫用行為中止服務。邀請與佣金以系統記錄為準，異常帳戶可被取消。",
  },
  privacy: {
    title: "隱私權政策 (Privacy Policy)",
    body: "我們僅處理您主動提供的 Telegram ID、綁定碼與鏈上 TXID，用於開通通知與核驗付款。資料存放於 Cloudflare 邊緣儲存。我們不出售個人資料。您可透過會員中心登出並停止使用。",
  },
  disclaimer: {
    title: "免責聲明 (Disclaimer)",
    body: "本平台所有策略、代碼與信號僅供量化回測與學術研究，不構成任何投資建議與收益承諾。看板數據、買賣點標記與績效數字均為研究展示，不得視為實盤保證。使用者應獨立判斷並自行承擔全部風險。",
  },
};

function openLegal(kind) {
  const doc = LEGAL[kind];
  if (!doc) return;
  $("legalTitle").textContent = t(kind === "risk" ? "legalRisk" : kind === "tos" ? "legalTos" : kind === "privacy" ? "legalPrivacy" : "legalDisc");
  $("legalBody").textContent = doc.body;
  openModal("legalModal");
}
function logout() {
  if (window.QAAuth) window.QAAuth.clearSession();
  else {
    localStorage.removeItem("quant_tg");
    localStorage.removeItem("quant_token");
    localStorage.removeItem("login_timestamp");
    localStorage.removeItem("quant_paid");
  }
  applyAuthUi();
  closeModal("dashModal");
}

async function loadPay(plan) {
  const userId = localStorage.getItem("quant_tg") || uid();
  $("payStatus").textContent = t("locking");
  $("payDetail").hidden = false;
  try {
    const q = "/api/pay-intent?user_id=" + encodeURIComponent(userId) + "&plan=" + encodeURIComponent(plan || "vip");
    const data = await api(q);
    $("payAmount").textContent = window.QAMoney ? window.QAMoney.fmtUsdt(data.amount) : data.amount + " USDT";
    $("payMeta").textContent = t("lockMeta").replace("{t}", new Date(data.expires_at).toLocaleString());
    $("payStatus").textContent = t("payHint");
    $("wallet").textContent = cfg.usdtWallet;
  } catch (e) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = e.message;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let payLock = 0;
let payTimer = null;

async function verifyTx() {
  if (payLock > 0) return;
  const raw = $("txid").value.trim();
  const userId = localStorage.getItem("quant_tg") || uid();
  if (window.QAMoney && !window.QAMoney.isTxHash(raw)) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = t("badTx");
    return;
  }
  if (raw.length < 16) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = t("txShort");
    return;
  }
  payLock = 10;
  $("payBtn").disabled = true;
  $("payBtn").textContent = t("payBusy").replace("{n}", "10");
  payTimer = setInterval(() => {
    payLock -= 1;
    if (payLock <= 0) {
      clearInterval(payTimer);
      payTimer = null;
      $("payBtn").disabled = false;
      $("payBtn").textContent = t("submitPay");
      return;
    }
    $("payBtn").textContent = t("payBusy").replace("{n}", String(payLock));
  }, 1000);
  $("payStatus").className = "status";
  try {
    const data = await api("/api/verify-usdt", {
      method: "POST",
      body: JSON.stringify({ txid: raw, user_id: userId }),
    });
    localStorage.setItem("quant_paid", "1");
    applyAuthUi();
    $("payStatus").textContent = data.message || t("paidOk");
    toast(t("paidOk"), "ok");
  } catch (e) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = e.message;
  }
}

function wire() {
  lang = detectLang();
  parentInviteFromUrl();
  applyI18n();
  $("btnChannel").href = cfg.tgChannelUrl;
  if ($("btnChannel2")) $("btnChannel2").href = cfg.tgChannelUrl;
  $("btnOpenBot").href = cfg.tgBotUrl;
  $("wallet").textContent = cfg.usdtWallet;
  if ($("paySupport")) $("paySupport").href = cfg.tgSupportUrl || cfg.tgBotUrl;
  if ($("tgFab")) $("tgFab").href = cfg.tgChannelUrl;
  wireOtp();
  if (location.hash === "#login") openModal("loginModal");
  if (location.hash === "#dash" && loggedIn()) openModal("dashModal");
  if ($("btnOnboardInvite")) {
    $("btnOnboardInvite").addEventListener("click", () => {
      openModal("dashModal");
      const link = $("inviteLink");
      if (link) link.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  if (window.QACopy) {
    window.QACopy.bindCopyButton($("btnCopyInvite"), () => $("inviteLink").textContent, "copyInviteOk");
    window.QACopy.bindCopyButton($("btnCopyAddr"), () => cfg.usdtWallet, "copyAddrOk");
    window.QACopy.bindCopyButton($("btnCopyHook"), () => $("hookUrl").textContent, "copyHookOk");
    window.QACopy.bindCopyButton($("btnCopyPayload"), () => $("hookPayload").textContent, "copyPayloadOk");
  } else {
    $("btnCopyInvite").addEventListener("click", () => copyText($("inviteLink").textContent, "copyInviteOk"));
    $("btnCopyAddr").addEventListener("click", () => copyText(cfg.usdtWallet, "copyAddrOk"));
  }
  const tick = $("signalTicker");
  if (tick) {
    const spin = () => {
      const px = ($("lastPx") && $("lastPx").textContent) || "64,200";
      tick.textContent = t("tickerTpl").replace("{px}", px);
    };
    spin();
    setInterval(spin, 8000);
  }
  window.addEventListener("quant-lang", () => {
    lang = detectLang();
    applyI18n();
  });
  $("btnDoLogin").addEventListener("click", doLogin);
  $("btnLogout").addEventListener("click", logout);
  $("btnPayIntent").addEventListener("click", () => loadPay("vip"));
  if ($("btnPayTrial")) $("btnPayTrial").addEventListener("click", () => loadPay("trial"));
  $("payBtn").addEventListener("click", verifyTx);
  document.querySelectorAll("[data-legal]").forEach((b) => {
    b.addEventListener("click", () => openLegal(b.getAttribute("data-legal")));
  });
  document.querySelectorAll("[data-close]").forEach((b) => {
    b.addEventListener("click", () => closeModal(b.getAttribute("data-close")));
  });
  window.QALiveDesk.start();
}

wire();
