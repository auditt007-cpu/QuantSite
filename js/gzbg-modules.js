/* ============================================================
   gzbg-modules.js · 广州表哥 GZBG QUANT 数据代理层 + 7 模块渲染
   数据源契约（VPS 生成标准 JSON）：
     data/small_fund.json   百U翻仓计划
     data/tp3_tracker.json  TP3 极值追踪
     data/alt_signals.json  山寨爆点专线
     data/whale_radar.json  主力异动雷达
   取数策略：同源 JSON 优先 → api.quantalpha.space 远端回退
   ============================================================ */
(function (root) {
  "use strict";

  var HUB = "https://api.quantalpha.space";
  var CFG = (root.QUANT_CONFIG || {});

  /* ---------- 数据代理层 ---------- */
  function remote(src) {
    return fetch(HUB + "/" + src + "?_t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); });
  }
  function load(src) {
    return fetch("./" + src + "?_t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () { return remote(src); });
  }
  root.GZBGData = { load: load, HUB: HUB };

  /* ---------- 工具 ---------- */
  function el(id) { return root.document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtPx(x) {
    if (x == null || isNaN(x)) return "—";
    return Number(x) >= 1000 ? Number(x).toLocaleString("en-US", { maximumFractionDigits: 1 }) : Number(x).toFixed(4);
  }
  function empty(msg) {
    return '<div class="bz-empty"><b>' + esc(msg || "数据同步中") + "</b></div>";
  }

  /* ---------- 模块 06 · 百U翻仓计划 ---------- */
  function renderSmallFund(card) {
    var steps = el("sfSteps"), mult = el("sfMult"), win = el("sfWin"), days = el("sfDays");
    if (!card) return;
    load("data/small_fund.json").then(function (d) {
      d = d || {};
      var plan = d.plan || [];
      if (plan.length) {
        steps.innerHTML = plan.slice(0, 5).map(function (s, i) {
          var done = s.done || s.achieved;
          return '<div class="bz-step' + (done ? " done" : "") + '">' +
            '<span class="bz-step-i">' + (done ? "✓" : (i + 1)) + "</span>" +
            '<span class="bz-step-body">' + esc(s.label || "") +
            (s.val ? " · <b>" + esc(s.val) + "</b>" : "") + "</span></div>";
        }).join("");
      }
      var k = d.kpi || {};
      if (mult && k.current_mult != null) mult.textContent = "+" + k.current_mult + "x";
      if (win && k.win_rate != null) win.textContent = k.win_rate + "%";
      if (days && k.days != null) days.textContent = k.days + " 天";
      if (card) card.classList.add("is-live");
    }).catch(function () {
      if (!steps) return;
      steps.innerHTML =
        '<div class="bz-step"><span class="bz-step-i">1</span><span class="bz-step-body">建仓 <b>100U</b> 纪律仓位，单笔风控 ≤5%</span></div>' +
        '<div class="bz-step"><span class="bz-step-i">2</span><span class="bz-step-body">TP1 减仓 <b>30%</b> 并自动保本移位</span></div>' +
        '<div class="bz-step"><span class="bz-step-i">3</span><span class="bz-step-body">复利滚仓，向 <b>1000U</b> 进发</span></div>';
    });
  }

  /* ---------- 模块 02 · TP3 极值追踪 ---------- */
  function renderTp3(card) {
    var box = el("tp3List");
    if (!box) return;
    load("data/tp3_tracker.json").then(function (d) {
      var sigs = (d && d.signals) || [];
      if (!sigs.length) { box.innerHTML = empty("暂无进行中的长波段"); return; }
      box.innerHTML = sigs.slice(0, 4).map(function (s) {
        var dirCls = s.dir === "SHORT" ? "bz-dir-short" : "bz-dir-long";
        var dirTxt = s.dir === "SHORT" ? "空" : "多";
        var prog = Math.max(0, Math.min(100, Number(s.prog) || 0));
        var hit = s.hit || "";
        var hitTxt = hit ? '<span class="bz-tp-hit">✓ ' + esc(hit.toUpperCase()) + " 已达成</span>" : "";
        return '<div class="bz-tp-row">' +
          '<div class="bz-tp-top"><span class="bz-tp-sym">' + esc(s.sym) + " · " + esc(s.tf || "") + ' <span class="' + dirCls + '">' + dirTxt + "</span></span>" +
          '<span>' + hitTxt + '<span class="bz-meta">' + fmtPx(s.px) + "</span></span></div>" +
          '<div class="bz-tp-track">' +
          '<span class="bz-tp-mark" style="left:33%"><span class="bz-tp-tag">TP1</span></span>' +
          '<span class="bz-tp-mark" style="left:66%"><span class="bz-tp-tag">TP2</span></span>' +
          '<span class="bz-tp-fill" style="width:' + prog + '%"></span></div>' +
          '<div class="bz-tp-top" style="margin-top:4px"><span class="bz-meta">距 TP3 目标 +' + esc(fmtPx(s.tp3)) + '%</span></div>' +
          "</div>";
      }).join("");
      if (card) card.classList.add("is-live");
    }).catch(function () {
      box.innerHTML = empty("TP3 战报同步中 · 数据将在连接后自动载入");
    });
  }

  /* ---------- 模块 01 · 山寨爆点专线 ---------- */
  function renderAlt(card) {
    var box = el("altList");
    if (!box) return;
    load("data/alt_signals.json").then(function (d) {
      var sigs = (d && d.signals) || [];
      if (!sigs.length) { box.innerHTML = empty("暂无高波动标的"); return; }
      box.innerHTML = sigs.slice(0, 8).map(function (s, i) {
        var open = i < 2;
        var up = Number(s.chg) >= 0;
        var conf = Math.max(0, Math.min(100, Number(s.conf) || 0));
        var body = open
          ? '<div class="bz-px">' + fmtPx(s.px) + ' <span class="' + (up ? "bz-chg-up" : "bz-chg-down") + '">' + (up ? "▲" : "▼") + " " + esc(fmtPx(Math.abs(s.chg))) + "%</span></div>" +
            '<div class="bz-conf"><div class="bz-conf-top"><span>突破置信度</span><span>' + conf + "%</span></div>" +
            '<div class="bz-conf-track"><i class="bz-conf-fill" style="width:' + conf + '%"></i></div></div>'
          : '<div class="bz-px bz-vip-mask">🔒 VIP 专享点位</div><div class="bz-conf"><div class="bz-conf-top"><span>突破置信度</span><span>🔒</span></div>' +
            '<div class="bz-conf-track"><i class="bz-conf-fill" style="width:30%;background:var(--bz-gold)"></i></div></div>';
        var dirCls = s.dir === "SHORT" ? "bz-dir-short" : "bz-dir-long";
        var dirTxt = s.dir === "SHORT" ? "做空" : "做多";
        return '<article class="bz-signal"><div class="bz-sig-top"><span class="bz-sym">' + esc(s.sym) +
          '</span><span class="bz-dir ' + dirCls + '">' + dirTxt + "</span></div>" + body + "</article>";
      }).join("");
      if (card) card.classList.add("is-live");
    }).catch(function () {
      box.innerHTML =
        '<article class="bz-signal"><div class="bz-sig-top"><span class="bz-sym">PEPE</span><span class="bz-dir bz-dir-long">做多</span></div>' +
        '<div class="bz-px">0.0000123 <span class="bz-chg-up">▲ 38.6%</span></div>' +
        '<div class="bz-conf"><div class="bz-conf-top"><span>突破置信度</span><span>87%</span></div><div class="bz-conf-track"><i class="bz-conf-fill" style="width:87%"></i></div></div></article>' +
        '<article class="bz-signal"><div class="bz-sig-top"><span class="bz-sym">WIF</span><span class="bz-dir bz-dir-short">做空</span></div>' +
        '<div class="bz-px bz-vip-mask">🔒 VIP 专享点位</div>' +
        '<div class="bz-conf"><div class="bz-conf-top"><span>突破置信度</span><span>🔒</span></div><div class="bz-conf-track"><i class="bz-conf-fill" style="width:30%;background:var(--bz-gold)"></i></div></div></article>';
    });
  }

  /* ---------- 模块 03 · 主力异动雷达 ---------- */
  function renderWhale(card) {
    var box = el("whalePanel");
    if (!box) return;
    load("data/whale_radar.json").then(function (d) {
      var flows = (d && d.flows) || [];
      if (!flows.length) { box.innerHTML = empty("暂无异动流 · 雷达待机"); return; }
      box.innerHTML = flows.slice(0, 6).map(function (f) {
        var inSide = f.side !== "out";
        var pct = Math.max(2, Math.min(100, Number(f.pct) || 0));
        return '<div class="bz-heat-row"><span class="bz-heat-sym">' + esc(f.sym) + "</span>" +
          '<div class="bz-heat-bar"><i class="' + (inSide ? "bz-heat-in" : "bz-heat-out") + '" style="display:block;width:' + pct + '%;height:100%"></i></div>' +
          '<span class="bz-heat-amt">' + esc(f.amt || "—") + " U</span>" +
          '<span class="bz-heat-side ' + (inSide ? "bz-side-in" : "bz-side-out") + '">' + (inSide ? "流入" : "流出") + "</span></div>";
      }).join("");
      if (card) card.classList.add("is-live");
    }).catch(function () {
      box.innerHTML =
        '<div class="bz-heat-row"><span class="bz-heat-sym">BTC</span><div class="bz-heat-bar"><i class="bz-heat-in" style="display:block;width:76%;height:100%"></i></div><span class="bz-heat-amt">2.4M U</span><span class="bz-heat-side bz-side-in">流入</span></div>' +
        '<div class="bz-heat-row"><span class="bz-heat-sym">ETH</span><div class="bz-heat-bar"><i class="bz-heat-out" style="display:block;width:58%;height:100%"></i></div><span class="bz-heat-amt">1.1M U</span><span class="bz-heat-side bz-side-out">流出</span></div>';
    });
  }

  /* ---------- 启动 ---------- */

  /* ---------- 模块 04 · 极简API跟单 ---------- */
  function renderApiCopy(card) {
    var box = el("apiCopyPanel");
    if (!box) return;
    load("data/api_copy.json").then(function (d) {
      d = d || {};
      var st = d.status || {};
      var status =
        '<div class="bz-tool-status">' +
        '<span class="bz-live-tag">● ' + esc(st.mode || "信号同步中") + "</span>" +
        '<span class="bz-tool-stat">跟随中 <b>' + esc(st.followers || 0) + "</b> 人</span>" +
        '<span class="bz-tool-stat">同步胜率 <b>' + esc(st.sync_win_rate || "—") + '%</b></span></div>';
      var steps = (d.steps || []).map(function (s) {
        return '<div class="bz-tool-step"><span class="bz-step-i">' + (s.n || "") + "</span>" +
          '<span class="bz-tool-step-body"><b>' + esc(s.title || "") + "</b><span>" + esc(s.desc || "") +
          "</span></span></div>";
      }).join("");
      var chips = '<div class="bz-tool-chips">' + (d.exchanges || []).map(function (x) {
        return '<span class="bz-chip">' + esc(x) + "</span>";
      }).join("") + "</div>";
      box.innerHTML = status + '<div class="bz-tool-steps">' + steps + "</div>" + chips +
        '<div class="bz-tool-cta"><a class="bz-cta" href="#" data-community-open="1">联系 GZBG 开通跟单 →</a></div>';
      if (card) card.classList.add("is-live");
    }).catch(function () { box.innerHTML = empty("API 跟单配置加载中"); });
  }

  /* ---------- 模块 05 · 回本解套助手 ---------- */
  function renderRecover(card) {
    var box = el("recoverPanel");
    if (!box) return;
    load("data/recover_plan.json").then(function (d) {
      d = d || {};
      var k = d.kpi || {};
      var kpi =
        '<div class="bz-tool-kpi">' +
        '<span>解套策略 <b>' + esc(k.strategies) + "</b></span>" +
        '<span>目标降本 <b>' + esc(k.avg_cover) + "</b></span>" +
        '<span>参考周期 <b>' + esc(k.days) + "</b></span>" +
        '<span>实盘均盈亏 <b class="bz-chg-up">' + esc(k.live_avg_pnl || "—") + "</b></span></div>";
      var steps = (d.plan || []).map(function (s, i) {
        var done = s.done;
        return '<div class="bz-step' + (done ? " done" : "") + '">' +
          '<span class="bz-step-i">' + (done ? "✓" : (i + 1)) + "</span>" +
          '<span class="bz-step-body">' + esc(s.label || "") +
          (s.val ? " · <b>" + esc(s.val) + "</b>" : "") + "</span></div>";
      }).join("");
      box.innerHTML = kpi + '<div class="bz-steps">' + steps + "</div>" +
        '<div class="bz-tool-cta"><a class="bz-cta" href="#" data-community-open="1">生成专属解套计划 →</a></div>';
      if (card) card.classList.add("is-live");
    }).catch(function () { box.innerHTML = empty("解套计划生成中"); });
  }

  /* ---------- 模块 07 · 风控补贴权益 ---------- */
  function renderShield(card) {
    var box = el("shieldPanel");
    if (!box) return;
    load("data/risk_shield.json").then(function (d) {
      d = d || {};
      var k = d.kpi || {};
      var kpi =
        '<div class="bz-tool-kpi">' +
        '<span>首单补贴 <b class="bz-chg-up">' + esc(k.coverage) + "</b></span>" +
        '<span>已补贴 <b>' + esc(k.applied) + "</b> 笔</span>" +
        '<span>返还池 <b class="bz-locked">' + esc(k.pool) + "</b></span></div>";
      var rules = (d.rules || []).map(function (r) {
        return '<div class="bz-rule"><span class="bz-rule-i">✦</span>' +
          '<span class="bz-rule-body"><b>' + esc(r.title || "") + "</b><span>" + esc(r.desc || "") +
          "</span></span></div>";
      }).join("");
      box.innerHTML = kpi + '<div class="bz-rules">' + rules + "</div>" +
        '<div class="bz-tool-cta"><span class="bz-invite">邀请码 <b class="bz-locked">' +
        esc(d.invite || "pw1m") + '</b></span>' +
        '<a class="bz-cta" href="#" data-community-open="1">领取补贴资格 →</a></div>';
      if (card) card.classList.add("is-live");
    }).catch(function () { box.innerHTML = empty("补贴权益加载中"); });
  }

  function boot() {
    renderSmallFund(el("smallFundCard"));
    renderTp3(el("tp3Card"));
    renderAlt(el("altSection"));
    renderWhale(el("whaleSection"));
    renderApiCopy(el("bzApiCopy"));
    renderRecover(el("bzRecover"));
    renderShield(el("bzShield"));
  }
  if (root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
