const cfg = window.QUANT_CONFIG;
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-TW");
}

function box(x, y, w, h, title, sub, accent) {
  const stroke = accent || "#1a2330";
  const fill = "#090d13";
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" />
    <text x="${x + w / 2}" y="${y + 28}" fill="#5cc8ff" font-size="11" text-anchor="middle" font-family="Consolas,monospace">${title}</text>
    <text x="${x + w / 2}" y="${y + 50}" fill="#2ee59d" font-size="13" text-anchor="middle" font-family="Consolas,monospace">${sub}</text>
  `;
}

function arrow(x1, y, x2) {
  const mid = (x1 + x2) / 2;
  return `
    <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#5cc8ff" stroke-width="1.2" marker-end="url(#arr)" />
    <text x="${mid}" y="${y - 8}" fill="#7d8b9a" font-size="10" text-anchor="middle">➔</text>
  `;
}

function renderTree(data) {
  const parent = data.parent ? data.parent.masked : "無上級";
  const me = data.me ? `${data.me.masked}` : "—";
  const l1n = (data.l1 || []).length;
  const l2n = (data.l2 || []).length;
  const l1 = l1n ? `L1 × ${l1n}` : "尚無直推";
  const l2 = l2n ? `L2 × ${l2n}` : "尚無間推";
  const w = 160;
  const h = 72;
  const y = 36;
  const xs = [24, 220, 416, 612];
  $("tree").innerHTML = `
    <svg viewBox="0 0 800 140" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#5cc8ff" />
        </marker>
      </defs>
      ${box(xs[0], y, w, h, "【推薦人節點】", parent, "#1c4a62")}
      ${box(xs[1], y, w, h, "【我的節點 (TG ID)】", me, "#2ee59d")}
      ${box(xs[2], y, w, h, "【第一層直推夥伴 (L1)】", l1, "#5cc8ff")}
      ${box(xs[3], y, w, h, "【第二層裂變夥伴 (L2)】", l2, "#ffcc66")}
      ${arrow(xs[0] + w, y + h / 2, xs[1])}
      ${arrow(xs[1] + w, y + h / 2, xs[2])}
      ${arrow(xs[2] + w, y + h / 2, xs[3])}
    </svg>
  `;
}

function renderRows(data) {
  const rows = [
    ...(data.l1 || []).map((r) => ({ ...r, layer: "L1 直推" })),
    ...(data.l2 || []).map((r) => ({ ...r, layer: "L2 間推" })),
  ];
  if (!rows.length) {
    $("rows").innerHTML = `<tr><td colspan="5" class="muted">尚無下級節點（不虛構用戶）</td></tr>`;
    return;
  }
  $("rows").innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${r.layer}</td>
        <td>${r.tg_masked}</td>
        <td>${fmtTime(r.created_at)}</td>
        <td>${r.status}</td>
        <td>${Number(r.commission || 0).toFixed(2)} USDT</td>
      </tr>`,
    )
    .join("");
}

async function load() {
  const tg = localStorage.getItem("quant_tg");
  if (!tg) {
    $("gate").hidden = false;
    $("desk").hidden = true;
    $("listPanel").hidden = true;
    $("wdPanel").hidden = true;
    return;
  }
  $("gate").hidden = true;
  try {
    const res = await fetch(cfg.apiBase + "/api/affiliate?tg_id=" + encodeURIComponent(tg));
    let data = await res.json();
    if (res.status === 404) {
      await fetch(cfg.apiBase + "/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tg_id: tg, parent_invite: localStorage.getItem("quant_ref") || "" }),
      });
      const res2 = await fetch(cfg.apiBase + "/api/affiliate?tg_id=" + encodeURIComponent(tg));
      data = await res2.json();
      if (!res2.ok) throw new Error(data.error || "載入失敗");
    } else if (!res.ok) {
      throw new Error(data.error || "載入失敗");
    }
    $("meLine").textContent =
      `我的節點：${data.me.masked} · 邀請碼 ${data.me.invite_code} · ${data.me.paid ? "機構 VIP" : "免費節點"}`;
    renderTree(data);
    renderRows(data);
    $("avail").textContent = Number(data.withdrawable || 0).toFixed(2) + " USDT";
    $("pend").textContent = Number(data.pending || 0).toFixed(2) + " USDT";
    $("prog").textContent = `${data.me.invite_count || 0} / 2`;
    if (data.withdraw_address) $("trc20").value = data.withdraw_address;
    window.__aff = data;
  } catch (e) {
    $("meLine").textContent = e.message;
    renderTree({ parent: null, me: { masked: tg }, l1: [], l2: [] });
  }
}

$("btnWd").addEventListener("click", async () => {
  const tg = localStorage.getItem("quant_tg");
  const address = $("trc20").value.trim();
  const amount = Number($("amt").value);
  $("wdStatus").textContent = "送出中…";
  try {
    const res = await fetch(cfg.apiBase + "/api/withdraw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tg_id: tg, address, amount }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "提現失敗");
    $("wdStatus").textContent = data.message;
    toast(data.message);
    $("avail").textContent = Number(data.withdrawable || 0).toFixed(2) + " USDT";
    $("pend").textContent = Number(data.pending || 0).toFixed(2) + " USDT";
  } catch (e) {
    $("wdStatus").textContent = e.message;
  }
});

load();
