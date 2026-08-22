import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  QUANT_USERS: KVNamespace;
  TG_BOT_TOKEN: string;
  ADMIN_TG_ID: string;
  TRONGRID_API_KEY: string;
  USDT_WALLET: string;
  WEBHOOK_SECRET: string;
  TG_CHANNEL_ID?: string;
  TG_CHANNEL_USERNAME?: string;
  TG_BOT_USERNAME?: string;
  PUBLIC_CHANNEL_ENABLED?: string;
};

type CommissionRow = {
  from_tg: string;
  level: 1 | 2;
  amount: number;
  at: number;
};

type UserRecord = {
  tg_id: string;
  invite_code: string;
  parent_invite: string;
  invite_count: number;
  invited: string[];
  created_at: number;
  unlocked: boolean;
  paid?: boolean;
  withdraw_address?: string;
  withdrawable?: number;
  pending?: number;
  commissions?: CommissionRow[];
};

type PayIntent = {
  user_id: string;
  amount: string;
  amount_sun: string;
  created_at: number;
  expires_at: number;
};

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const ACTIVE_KEY = "ACTIVE_SUBSCRIBERS";
const INTENT_TTL = 15 * 60;
const BIND_TTL = 10 * 60;
const CHANNEL_URL = "https://t.me/quant_alpha_signals";
const BOT_URL = "https://t.me/grid_quant_bot?start=bind";
const VIP_USDT = 99;
const L1_USDT = 34.65;
const L2_USDT = 14.85;

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Webhook-Secret", "X-Admin-Secret", "Authorization", "X-Telegram-Bot-Api-Secret-Token"],
    maxAge: 86400,
  }),
);

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "quant-saas-api",
    channel: CHANNEL_URL,
    bot: BOT_URL,
    endpoints: [
      "POST /api/register",
      "GET /api/pay-intent",
      "POST /api/verify-usdt",
      "POST /api/bind-confirm",
      "POST /api/bind-tg",
      "POST /api/telegram",
      "POST /api/webhook-relay",
      "GET /api/affiliate",
      "POST /api/withdraw",
      "GET /api/klines",
      "GET /api/strategies",
      "POST /api/strategies",
      "PUT /api/strategies/:id",
      "DELETE /api/strategies/:id",
    ],
  }),
);

app.post("/api/register", async (c) => {
  const body = await readJson(c);
  const tgId = String(body.tg_id || "").trim();
  const parentInvite = String(body.parent_invite || "").trim();
  if (!/^\d{5,15}$/.test(tgId)) {
    return c.json({ error: "invalid tg_id" }, 400);
  }

  const existing = await getUserByTg(c.env, tgId);
  let user = existing;
  if (!user) {
    user = {
      tg_id: tgId,
      invite_code: await allocInviteCode(c.env),
      parent_invite: parentInvite,
      invite_count: 0,
      invited: [],
      created_at: Date.now(),
      unlocked: false,
      paid: false,
      withdraw_address: "",
      withdrawable: 0,
      pending: 0,
      commissions: [],
    };
    await putUser(c.env, user);
    await c.env.QUANT_USERS.put(`invite:${user.invite_code}`, tgId);
  }

  user = await attachReferral(c.env, user, parentInvite);

  const subs = await listSubscribers(c.env);
  user.unlocked = user.unlocked || subs.includes(user.tg_id);

  return c.json({
    ok: true,
    tg_id: user.tg_id,
    invite_code: user.invite_code,
    invite_count: user.invite_count,
    unlocked: user.unlocked,
    paid: Boolean(user.paid),
    withdrawable: Number(user.withdrawable || 0),
    pending: Number(user.pending || 0),
  });
});

app.post("/api/bind-confirm", (c) => confirmBind(c));
app.post("/api/bind-tg", (c) => confirmBind(c));

async function confirmBind(c: { req: { json: () => Promise<unknown>; text: () => Promise<string> }; env: Bindings; json: (d: unknown, s?: number) => Response }) {
  const body = await readJson(c);
  const code = String(body.code || body.bind_code || "").trim();
  if (!/^\d{4}$/.test(code)) return c.json({ error: "請輸入 4 位綁定碼" }, 400);
  const rec = await c.env.QUANT_USERS.get(`bind:${code}`, "json") as { tg_id: string; exp: number } | null;
  if (!rec || rec.exp < Date.now()) return c.json({ error: "綁定碼無效或已過期，請重新在 Telegram 傳送 /bind" }, 410);
  const parentInvite = String(body.parent_invite || "").trim();
  const tgId = rec.tg_id;
  let user = await getUserByTg(c.env, tgId);
  if (!user) {
    user = {
      tg_id: tgId,
      invite_code: await allocInviteCode(c.env),
      parent_invite: "",
      invite_count: 0,
      invited: [],
      created_at: Date.now(),
      unlocked: true,
      paid: false,
      withdraw_address: "",
      withdrawable: 0,
      pending: 0,
      commissions: [],
    };
    await putUser(c.env, user);
    await c.env.QUANT_USERS.put(`invite:${user.invite_code}`, tgId);
  } else {
    user.unlocked = true;
    await putUser(c.env, user);
  }
  user = await attachReferral(c.env, user, parentInvite);
  await addSubscriber(c.env, tgId, "free-bind");
  await c.env.QUANT_USERS.delete(`bind:${code}`);
  return c.json({
    ok: true,
    activated: true,
    message: "已啟用基礎訊號推送",
    tg_id: tgId,
    invite_code: user.invite_code,
    invite_count: user.invite_count,
    unlocked: user.unlocked,
  });
}

app.get("/api/pay-intent", async (c) => {
  const userId = String(c.req.query("user_id") || "").trim();
  if (!userId) return c.json({ error: "user_id required" }, 400);

  const key = `pay:${userId}`;
  const prev = await c.env.QUANT_USERS.get(key, "json") as PayIntent | null;
  const now = Date.now();
  if (prev && prev.expires_at > now) {
    return c.json({
      amount: prev.amount,
      amount_sun: prev.amount_sun,
      expires_at: prev.expires_at,
      reused: true,
    });
  }

  const cents = 9901 + Math.floor(Math.random() * 99);
  const amount = (cents / 100).toFixed(2);
  const amountSun = String(cents * 10_000);
  const intent: PayIntent = {
    user_id: userId,
    amount,
    amount_sun: amountSun,
    created_at: now,
    expires_at: now + INTENT_TTL * 1000,
  };
  await c.env.QUANT_USERS.put(key, JSON.stringify(intent), { expirationTtl: INTENT_TTL + 60 });
  return c.json({
    amount: intent.amount,
    amount_sun: intent.amount_sun,
    expires_at: intent.expires_at,
    reused: false,
    wallet: c.env.USDT_WALLET,
    network: "TRC20",
  });
});

app.post("/api/verify-usdt", async (c) => {
  const body = await readJson(c);
  const txid = normalizeTxid(String(body.txid || ""));
  const userId = String(body.user_id || "").trim();
  if (!txid || txid.length < 16) return c.json({ error: "invalid txid" }, 400);
  if (!userId) return c.json({ error: "user_id required" }, 400);

  const used = await c.env.QUANT_USERS.get(`txid:${txid}`);
  if (used) return c.json({ error: "txid already consumed (replay blocked)" }, 409);

  const intent = await c.env.QUANT_USERS.get(`pay:${userId}`, "json") as PayIntent | null;
  if (!intent) return c.json({ error: "no locked pay-intent; call GET /api/pay-intent first" }, 400);
  if (intent.expires_at < Date.now()) return c.json({ error: "pay-intent expired; request a new amount" }, 410);

  const transfer = await inspectUsdtTransfer(txid, c.env);
  if (!transfer.ok) return c.json({ error: transfer.error }, 422);

  const wallet = c.env.USDT_WALLET.trim();
  if (transfer.to !== wallet) {
    return c.json({
      error: "to_address mismatch",
      expected: wallet,
      actual: transfer.to,
    }, 422);
  }
  if (transfer.amount_sun !== intent.amount_sun) {
    return c.json({
      error: "amount mismatch (USDT 6-decimal exact match required)",
      expected: intent.amount,
      expected_sun: intent.amount_sun,
      actual: sunToUsdt(transfer.amount_sun),
      actual_sun: transfer.amount_sun,
    }, 422);
  }

  await c.env.QUANT_USERS.put(
    `txid:${txid}`,
    JSON.stringify({ user_id: userId, at: Date.now(), amount: intent.amount }),
    { expirationTtl: 60 * 60 * 24 * 400 },
  );

  const tgId = /^\d{5,15}$/.test(userId) ? userId : null;
  if (tgId) {
    const user = await getUserByTg(c.env, tgId);
    if (user) {
      user.unlocked = true;
      user.paid = true;
      await putUser(c.env, user);
      await creditVipCommissions(c.env, user);
    }
    await addSubscriber(c.env, tgId, "paid");
  } else {
    await addSubscriber(c.env, userId, "paid");
  }

  await notifyAdmin(
    c.env,
    `PAYMENT OK\nuser=${userId}\namount=${intent.amount} USDT\ntxid=${txid}`,
  );

  return c.json({
    ok: true,
    message: "鏈上校驗通過，已開通機構 VIP 並加入 ACTIVE_SUBSCRIBERS",
    amount: intent.amount,
    txid,
  });
});

app.get("/api/affiliate", async (c) => {
  const tgId = String(c.req.query("tg_id") || "").trim();
  if (!/^\d{5,15}$/.test(tgId)) return c.json({ error: "invalid tg_id" }, 400);
  const user = await getUserByTg(c.env, tgId);
  if (!user) return c.json({ error: "not found" }, 404);

  let parent: { masked: string; invite_code: string } | null = null;
  if (user.parent_invite) {
    const parentTg = await c.env.QUANT_USERS.get(`invite:${user.parent_invite}`);
    if (parentTg) {
      const p = await getUserByTg(c.env, parentTg);
      if (p) parent = { masked: maskTg(p.tg_id), invite_code: p.invite_code };
    }
  }

  const l1 = [];
  const l2 = [];
  for (const id of user.invited || []) {
    const child = await getUserByTg(c.env, id);
    if (!child) continue;
    l1.push(downlineView(child, 1, user.commissions || []));
    for (const id2 of child.invited || []) {
      const g = await getUserByTg(c.env, id2);
      if (g) l2.push(downlineView(g, 2, user.commissions || []));
    }
  }

  return c.json({
    ok: true,
    me: {
      tg_id: user.tg_id,
      masked: maskTg(user.tg_id),
      invite_code: user.invite_code,
      created_at: user.created_at,
      unlocked: user.unlocked,
      paid: Boolean(user.paid),
      invite_count: user.invite_count,
    },
    parent,
    l1,
    l2,
    rules: {
      free_unlock: 2,
      vip_usdt: VIP_USDT,
      l1_rate: 0.35,
      l1_usdt: L1_USDT,
      l2_rate: 0.15,
      l2_usdt: L2_USDT,
    },
    withdrawable: Number(user.withdrawable || 0),
    pending: Number(user.pending || 0),
    withdraw_address: user.withdraw_address || "",
  });
});

app.post("/api/withdraw", async (c) => {
  const body = await readJson(c);
  const tgId = String(body.tg_id || "").trim();
  const address = String(body.address || "").trim();
  const amount = Number(body.amount);
  if (!/^\d{5,15}$/.test(tgId)) return c.json({ error: "invalid tg_id" }, 400);
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    return c.json({ error: "請填入有效的 USDT TRC20 地址" }, 400);
  }
  const user = await getUserByTg(c.env, tgId);
  if (!user) return c.json({ error: "not found" }, 404);
  const avail = Number(user.withdrawable || 0);
  if (!(amount > 0) || amount > avail + 1e-9) {
    return c.json({ error: "可提現餘額不足" }, 400);
  }
  user.withdraw_address = address;
  user.withdrawable = Number((avail - amount).toFixed(2));
  user.pending = Number((Number(user.pending || 0) + amount).toFixed(2));
  await putUser(c.env, user);
  await notifyAdmin(
    c.env,
    `WITHDRAW REQUEST\nuser=${tgId}\namount=${amount.toFixed(2)} USDT\naddr=${address}`,
  );
  return c.json({
    ok: true,
    message: "已受理提現申請，將人工核對後撥款至 TRC20 地址",
    withdrawable: user.withdrawable,
    pending: user.pending,
    withdraw_address: address,
  });
});

const STRATEGY_KEY = "STRATEGIES_V1";
const KLINE_IV = new Set(["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"]);

const DEFAULT_STRATEGIES = [
  { id: "dual", name: "Dual SuperTrend 趨勢追蹤", symbols: ["BTCUSDT"], interval: "1h", tags: ["趨勢", "SuperTrend"], engine: "dual", pine: "" },
  { id: "ribbon", name: "EMA Ribbon 均線多頭共振", symbols: ["BTCUSDT"], interval: "1h", tags: ["均線", "共振"], engine: "ribbon", pine: "" },
  { id: "rsi", name: "RSI Divergence 頂底背離", symbols: ["BTCUSDT"], interval: "15m", tags: ["震盪", "RSI"], engine: "rsi", pine: "" },
  { id: "squeeze", name: "Bollinger Squeeze 突破", symbols: ["BTCUSDT"], interval: "1h", tags: ["突破", "布林"], engine: "squeeze", pine: "" },
  { id: "atr", name: "Adaptive ATR 動態網格", symbols: ["BTCUSDT"], interval: "5m", tags: ["網格", "ATR"], engine: "atr", pine: "" },
];

function adminOk(c: { req: { header: (n: string) => string | undefined }; env: Bindings }) {
  const hdr = c.req.header("X-Admin-Secret") || "";
  return Boolean(c.env.WEBHOOK_SECRET) && timingSafeEq(hdr, c.env.WEBHOOK_SECRET);
}

async function loadStrategies(env: Bindings) {
  const hit = (await env.QUANT_USERS.get(STRATEGY_KEY, "json")) as typeof DEFAULT_STRATEGIES | null;
  if (Array.isArray(hit) && hit.length) return hit;
  await env.QUANT_USERS.put(STRATEGY_KEY, JSON.stringify(DEFAULT_STRATEGIES));
  return DEFAULT_STRATEGIES;
}

function normalizeStrategy(body: Record<string, unknown>, fallbackId?: string) {
  const id = String(body.id || fallbackId || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) throw new Error("invalid id");
  const symbols = Array.isArray(body.symbols)
    ? body.symbols.map((s) => String(s).toUpperCase()).filter(Boolean)
    : String(body.symbols || "BTCUSDT")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
  const interval = String(body.interval || "1h").toLowerCase();
  if (!KLINE_IV.has(interval)) throw new Error("invalid interval");
  const tags = Array.isArray(body.tags)
    ? body.tags.map((s) => String(s)).filter(Boolean)
    : String(body.tags || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const winRate = body.winRate == null || body.winRate === "" ? null : Number(body.winRate);
  const sharpe = body.sharpe == null || body.sharpe === "" ? null : Number(body.sharpe);
  return {
    id,
    name: String(body.name || id).slice(0, 80),
    symbols: symbols.length ? symbols : ["BTCUSDT"],
    interval,
    tags,
    engine: String(body.engine || id),
    pine: String(body.pine || ""),
    winRate: winRate != null && Number.isFinite(winRate) ? winRate : null,
    sharpe: sharpe != null && Number.isFinite(sharpe) ? sharpe : null,
  };
}

app.get("/api/klines", async (c) => {
  const symbol = String(c.req.query("symbol") || "BTCUSDT").toUpperCase();
  const interval = String(c.req.query("interval") || "1m").toLowerCase();
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") || 500)));
  if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !KLINE_IV.has(interval)) {
    return c.json({ error: "invalid symbol or interval" }, 400);
  }
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
});

app.get("/api/strategies", async (c) => {
  const list = await loadStrategies(c.env);
  return c.json({ ok: true, strategies: list });
});

app.post("/api/strategies", async (c) => {
  if (!adminOk(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await readJson(c);
  let item;
  try {
    item = normalizeStrategy(body);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "invalid" }, 400);
  }
  const list = await loadStrategies(c.env);
  if (list.some((s) => s.id === item.id)) return c.json({ error: "id exists" }, 409);
  list.push(item);
  await c.env.QUANT_USERS.put(STRATEGY_KEY, JSON.stringify(list));
  return c.json({ ok: true, strategy: item });
});

app.put("/api/strategies/:id", async (c) => {
  if (!adminOk(c)) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");
  const body = await readJson(c);
  let item;
  try {
    item = normalizeStrategy({ ...body, id }, id);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "invalid" }, 400);
  }
  const list = await loadStrategies(c.env);
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return c.json({ error: "not found" }, 404);
  list[idx] = item;
  await c.env.QUANT_USERS.put(STRATEGY_KEY, JSON.stringify(list));
  return c.json({ ok: true, strategy: item });
});

app.delete("/api/strategies/:id", async (c) => {
  if (!adminOk(c)) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");
  const list = await loadStrategies(c.env);
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return c.json({ error: "not found" }, 404);
  await c.env.QUANT_USERS.put(STRATEGY_KEY, JSON.stringify(next));
  return c.json({ ok: true });
});

app.post("/api/telegram", async (c) => {
  const hdr = c.req.header("X-Telegram-Bot-Api-Secret-Token") || "";
  if (c.env.WEBHOOK_SECRET && !timingSafeEq(hdr, c.env.WEBHOOK_SECRET)) {
    return c.json({ error: "unauthorized telegram webhook" }, 401);
  }
  const update = await readJson(c);
  await handleTelegramUpdate(c.env, update);
  return c.json({ ok: true });
});

app.post("/api/webhook-relay", async (c) => {
  const secretHeader = c.req.header("X-Webhook-Secret") || "";
  const body = await readJson(c);
  const secret = String(body.secret || body.passphrase || secretHeader || "");
  if (!timingSafeEq(secret, c.env.WEBHOOK_SECRET)) {
    return c.json({ error: "invalid webhook secret" }, 401);
  }

  const privateOnly = body.private === true || body.public === false;
  const fullText = formatSignal(body, false);
  const publicText = formatSignal(body, true);
  const subs = await listSubscribers(c.env);
  const results = await fanoutTelegram(c.env, subs, fullText);

  let channel: { ok: boolean; skipped?: boolean; id?: string } = { ok: false, skipped: true };
  const channelEnabled = (c.env.PUBLIC_CHANNEL_ENABLED || "true").toLowerCase() !== "false";
  const channelId = resolveChannel(c.env);
  if (!privateOnly && channelEnabled && channelId) {
    const sent = await sendTelegram(c.env, channelId, publicText);
    channel = { ok: sent.ok, skipped: false, id: String(channelId) };
  }

  const failed = results.filter((r) => !r.ok).length;
  return c.json({
    ok: failed === 0 && (channel.skipped || channel.ok),
    delivered: results.length - failed,
    failed,
    subscribers: subs.length,
    channel,
  });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : "internal error" }, 500);
});

export default app;

function resolveChannel(env: Bindings) {
  const id = (env.TG_CHANNEL_ID || "").trim();
  if (id) return id;
  const name = (env.TG_CHANNEL_USERNAME || "@quant_alpha_signals").trim();
  return name.startsWith("@") ? name : "@" + name.replace(/^https:\/\/t\.me\//, "");
}

async function handleTelegramUpdate(env: Bindings, update: Record<string, unknown>) {
  const message = (update.message || update.edited_message) as
    | { text?: string; chat?: { id?: number }; from?: { id?: number } }
    | undefined;
  if (!message?.chat?.id) return;
  const chatId = String(message.chat.id);
  const text = String(message.text || "").trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const command = (cmd || "").split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim().toLowerCase();

  if (command === "/start" || command === "/bind") {
    const wantCode = command === "/bind" || arg === "bind" || arg === "" || command === "/start";
    const code = wantCode ? await issueBindCode(env, chatId) : "";
    await sendTelegram(env, chatId, bindWelcome(code, env));
    return;
  }
  if (command === "/help") {
    await sendTelegram(env, chatId, bindWelcome("", env));
    return;
  }
}

async function issueBindCode(env: Bindings, tgId: string) {
  let code = "";
  for (let i = 0; i < 12; i++) {
    code = String(1000 + Math.floor(Math.random() * 9000));
    const hit = await env.QUANT_USERS.get(`bind:${code}`);
    if (!hit) break;
  }
  await env.QUANT_USERS.put(
    `bind:${code}`,
    JSON.stringify({ tg_id: tgId, exp: Date.now() + BIND_TTL * 1000 }),
    { expirationTtl: BIND_TTL },
  );
  return code;
}

function bindWelcome(code: string, _env: Bindings) {
  const lines = [
    "歡迎來到 QUANT ALPHA 智能量化調度系統。",
    "",
    "免費公開頻道：https://t.me/quant_alpha_signals",
    "",
    "請將 4 位綁定碼回填至網站完成身份驗證。",
    "綁定碼 10 分鐘內有效。重新傳送 /bind 可換發新碼。",
  ];
  if (code) {
    lines.push("", `您的專屬 4 位綁定碼為：${code}，請回填至網站完成身份驗證。`);
  }
  return lines.join("\n");
}

function maskTg(id: string) {
  const s = String(id);
  if (s.length < 6) return s;
  return `${s.slice(0, 4)}****${s.slice(-2)}`;
}

function downlineView(u: UserRecord, level: 1 | 2, ledger: CommissionRow[]) {
  const earned = ledger
    .filter((r) => r.from_tg === u.tg_id && r.level === level)
    .reduce((s, r) => s + r.amount, 0);
  return {
    tg_masked: maskTg(u.tg_id),
    created_at: u.created_at,
    unlocked: u.unlocked,
    paid: Boolean(u.paid),
    status: u.paid ? "已付費 $99" : u.unlocked ? "已解鎖" : "未激活",
    commission: Number(earned.toFixed(2)),
  };
}

async function attachReferral(env: Bindings, user: UserRecord, parentInvite: string) {
  if (!parentInvite || parentInvite === user.invite_code) return user;
  if (!user.parent_invite) {
    user.parent_invite = parentInvite;
    await putUser(env, user);
  }
  const parentTg = await env.QUANT_USERS.get(`invite:${user.parent_invite}`);
  if (!parentTg || parentTg === user.tg_id) return user;
  const parent = await getUserByTg(env, parentTg);
  if (!parent || parent.invited.includes(user.tg_id)) return user;
  parent.invited.push(user.tg_id);
  parent.invite_count = parent.invited.length;
  if (parent.invite_count >= 2) {
    parent.unlocked = true;
    await addSubscriber(env, parent.tg_id, "referral");
  }
  await putUser(env, parent);
  await sendTelegram(
    env,
    parent.tg_id,
    `恭喜！您的夥伴已成功綁定，解鎖進度：${parent.invite_count}/2。`,
  );
  return user;
}

async function creditVipCommissions(env: Bindings, payer: UserRecord) {
  if (!payer.parent_invite) return;
  const parentTg = await env.QUANT_USERS.get(`invite:${payer.parent_invite}`);
  if (!parentTg) return;
  const parent = await getUserByTg(env, parentTg);
  if (!parent) return;

  const alreadyL1 = (parent.commissions || []).some((r) => r.from_tg === payer.tg_id && r.level === 1);
  if (parent.paid && !alreadyL1) {
    parent.commissions = parent.commissions || [];
    parent.commissions.push({ from_tg: payer.tg_id, level: 1, amount: L1_USDT, at: Date.now() });
    parent.withdrawable = Number((Number(parent.withdrawable || 0) + L1_USDT).toFixed(2));
    await putUser(env, parent);
    await sendTelegram(
      env,
      parent.tg_id,
      `機構 VIP 返傭入帳：L1 直推 ${L1_USDT.toFixed(2)} USDT（35%）。`,
    );
  }

  if (!parent.parent_invite) return;
  const gpTg = await env.QUANT_USERS.get(`invite:${parent.parent_invite}`);
  if (!gpTg) return;
  const gp = await getUserByTg(env, gpTg);
  if (!gp) return;
  const alreadyL2 = (gp.commissions || []).some((r) => r.from_tg === payer.tg_id && r.level === 2);
  if (gp.paid && !alreadyL2) {
    gp.commissions = gp.commissions || [];
    gp.commissions.push({ from_tg: payer.tg_id, level: 2, amount: L2_USDT, at: Date.now() });
    gp.withdrawable = Number((Number(gp.withdrawable || 0) + L2_USDT).toFixed(2));
    await putUser(env, gp);
    await sendTelegram(
      env,
      gp.tg_id,
      `機構 VIP 返傭入帳：L2 間推 ${L2_USDT.toFixed(2)} USDT（15%）。`,
    );
  }
}

async function readJson(c: { req: { json: () => Promise<unknown>; text: () => Promise<string> } }) {
  try {
    const data = await c.req.json();
    return (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  } catch {
    const raw = await c.req.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { text: raw };
    }
  }
}

function userKey(tgId: string) {
  return `user:${tgId}`;
}

async function getUserByTg(env: Bindings, tgId: string): Promise<UserRecord | null> {
  return (await env.QUANT_USERS.get(userKey(tgId), "json")) as UserRecord | null;
}

async function putUser(env: Bindings, user: UserRecord) {
  await env.QUANT_USERS.put(userKey(user.tg_id), JSON.stringify(user));
}

async function allocInviteCode(env: Bindings): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    const hit = await env.QUANT_USERS.get(`invite:${code}`);
    if (!hit) return code;
  }
  return Date.now().toString(36).toUpperCase();
}

async function addSubscriber(env: Bindings, id: string, reason: string) {
  await env.QUANT_USERS.put(`sub:${id}`, JSON.stringify({ at: Date.now(), reason }));
  const arr = await listSubscribers(env);
  if (!arr.includes(id)) arr.push(id);
  await env.QUANT_USERS.put(ACTIVE_KEY, JSON.stringify(arr));
}

async function listSubscribers(env: Bindings): Promise<string[]> {
  const fromArray = (await env.QUANT_USERS.get(ACTIVE_KEY, "json")) as string[] | null;
  const ids = new Set<string>(Array.isArray(fromArray) ? fromArray.map(String) : []);
  let cursor: string | undefined;
  do {
    const page = await env.QUANT_USERS.list({ prefix: "sub:", cursor });
    for (const k of page.keys) ids.add(k.name.slice(4));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return [...ids];
}

function normalizeTxid(raw: string) {
  return raw.trim().replace(/^0x/i, "").toLowerCase();
}

function sunToUsdt(sun: string) {
  const n = BigInt(sun);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole.toString()}.${frac.slice(0, 2)}`;
}

async function inspectUsdtTransfer(
  txid: string,
  env: Bindings,
): Promise<{ ok: true; to: string; amount_sun: string } | { ok: false; error: string }> {
  const headers = { "TRON-PRO-API-KEY": env.TRONGRID_API_KEY, Accept: "application/json" };
  const url =
    `https://api.trongrid.io/v1/accounts/${env.USDT_WALLET}/transactions/trc20` +
    `?only_confirmed=true&limit=200&contract_address=${USDT_TRC20}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return { ok: false, error: `TronGrid HTTP ${res.status}` };
  const payload = (await res.json()) as {
    data?: Array<{
      transaction_id?: string;
      to?: string;
      value?: string;
      type?: string;
      token_info?: { symbol?: string; decimals?: number };
    }>;
  };
  const rows = payload.data || [];
  const hit = rows.find((r) => normalizeTxid(String(r.transaction_id || "")) === txid);
  if (!hit) {
    const exists = await txExists(txid, headers);
    if (!exists) return { ok: false, error: "transaction not found on chain (or still unconfirmed)" };
    return {
      ok: false,
      error: "txid exists but is not a confirmed incoming USDT TRC20 transfer to the merchant wallet",
    };
  }
  if ((hit.type || "Transfer") !== "Transfer") {
    return { ok: false, error: `unsupported trc20 type ${hit.type}` };
  }
  return { ok: true, to: String(hit.to || ""), amount_sun: String(hit.value || "0") };
}

async function txExists(txid: string, headers: Record<string, string>) {
  const infoRes = await fetch("https://api.trongrid.io/wallet/gettransactioninfobyid", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ value: txid }),
  });
  const info = (await infoRes.json()) as { id?: string };
  return Boolean(info?.id);
}

function formatSignal(body: Record<string, unknown>, publicDesk: boolean) {
  const symbol = String(body.ticker || body.symbol || "UNKNOWN");
  const action = String(body.action || body.side || body.signal || "ALERT");
  const price = String(body.price || body.close || "");
  const extra = String(body.message || body.text || "");
  const lines = publicDesk
    ? [
        "QUANT ALPHA · 公開頻道",
        `標的  ${symbol}`,
        `方向  ${action.toUpperCase()}`,
        price ? `價格  ${price}` : "",
        `頻道  ${CHANNEL_URL}`,
        "完整自動執行節點請綁定 @grid_quant_bot",
      ]
    : [
        "QUANT ALPHA 訊號 · 私密通道",
        `標的  ${symbol}`,
        `方向  ${action.toUpperCase()}`,
        price ? `價格  ${price}` : "",
        extra ? `備註  ${extra}` : "",
        `時間  ${new Date().toISOString()}`,
      ];
  return lines.filter(Boolean).join("\n");
}

async function sendTelegram(env: Bindings, chatId: string | number, text: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    const data = (await res.json()) as { ok?: boolean };
    return { id: String(chatId), ok: Boolean(data.ok) };
  } catch {
    return { id: String(chatId), ok: false };
  }
}

async function fanoutTelegram(env: Bindings, ids: string[], text: string) {
  const numeric = ids.filter((id) => /^-?\d{5,18}$/.test(id));
  const chunks: string[][] = [];
  for (let i = 0; i < numeric.length; i += 20) chunks.push(numeric.slice(i, i + 20));
  const out: Array<{ id: string; ok: boolean }> = [];
  for (const group of chunks) {
    const batch = await Promise.all(group.map((id) => sendTelegram(env, id, text)));
    out.push(...batch);
  }
  return out;
}

async function notifyAdmin(env: Bindings, text: string) {
  if (!env.ADMIN_TG_ID || !env.TG_BOT_TOKEN) return;
  await sendTelegram(env, env.ADMIN_TG_ID, text);
}

function timingSafeEq(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}
