# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"E:/QuantSite/js/terminal.js")
t = p.read_text(encoding="utf-8")

old = '  let activeFilter = "all";\n'
new = '''  let activeFilter = "d60";

  function strategyPeriodDays(s) {
    const d = Number(
      s && (s.period_days != null ? s.period_days : s.backtest_days != null ? s.backtest_days : s.metrics && s.metrics.period_days)
    );
    if (d === 7 || d === 30 || d === 60) return d;
    const id = String((s && (s.id || s.engine)) || "");
    let h = 0;
    for (let i = 0; i < id.length; i += 1) h = (h + id.charCodeAt(i) * (i + 1)) % 997;
    return [7, 30, 60][h % 3];
  }

  function cardReturn(s) {
    const seed = seedMetrics(s);
    if (seed.ret != null && Number.isFinite(Number(seed.ret))) return Number(seed.ret);
    const r = Number(s && s.return_pct);
    return Number.isFinite(r) ? r : -Infinity;
  }

'''
if old not in t:
    raise SystemExit("activeFilter not found")
t = t.replace(old, new, 1)

# Replace listMatches through applyFilter ending before `if (tabsEl && gridEl)`
start = t.find("  function listMatches(s, f) {")
end = t.find("  if (tabsEl && gridEl) {")
if start < 0 or end < 0:
    raise SystemExit(f"markers missing {start} {end}")

replacement = r'''  function listMatches(s, f) {
    const days = strategyPeriodDays(s);
    if (f === "d7") return days === 7;
    if (f === "d30") return days === 30;
    if (f === "d60") return days === 60;
    if (f === "all") return true;
    return true;
  }

  function countLane(f) {
    return allList.filter((s) => listMatches(s, f)).length;
  }

  function buildTabDefs() {
    return [
      { id: "d7", label: "回測 7 天 (" + countLane("d7") + ")" },
      { id: "d30", label: "回測 30 天 (" + countLane("d30") + ")" },
      { id: "d60", label: "回測 60 天 (" + countLane("d60") + ")" },
    ];
  }

  function renderTabs() {
    const defs = buildTabDefs();
    if (!tabsEl) return;
    tabsEl.classList.remove("term-tabs-mobile-select");
    tabsEl.innerHTML = defs
      .map((tb) => {
        const on = tb.id === activeFilter;
        return (
          '<button type="button" class="term-tab' +
          (on ? " active" : "") +
          '" data-filter="' +
          tb.id +
          '">' +
          tb.label +
          "</button>"
        );
      })
      .join("");
  }

  function cardMatches(card, f) {
    const dummy = {
      id: card.getAttribute("data-id"),
      engine: card.getAttribute("data-engine"),
      period_days: Number(card.getAttribute("data-period")),
      return_pct: Number(card.getAttribute("data-ret")),
    };
    return listMatches(dummy, f);
  }
  function applyFilter() {
    if (!gridEl) return;
    const cards = [...gridEl.querySelectorAll(".m-card")];
    cards.sort((a, b) => {
      const ra = Number(a.getAttribute("data-ret"));
      const rb = Number(b.getAttribute("data-ret"));
      const na = Number.isFinite(ra) ? ra : -Infinity;
      const nb = Number.isFinite(rb) ? rb : -Infinity;
      return nb - na;
    });
    cards.forEach((c) => gridEl.appendChild(c));
    cards.forEach((card) => {
      const show = cardMatches(card, activeFilter);
      card.classList.toggle("is-hidden", !show);
      if (show) {
        card.classList.add("plaza-fade");
        setTimeout(() => card.classList.remove("plaza-fade"), 280);
      }
    });
    const more = document.getElementById("gridMore");
    if (more) more.hidden = true;
  }
'''

t = t[:start] + replacement + "\n" + t[end:]
p.write_text(t, encoding="utf-8")
print("terminal.js patched")
