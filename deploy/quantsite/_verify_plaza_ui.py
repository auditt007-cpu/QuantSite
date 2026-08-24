# -*- coding: utf-8 -*-
"""Smoke-check plaza card HTML helpers + CSS breakpoints."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    css = (ROOT / "css/plaza-cards.css").read_text(encoding="utf-8")
    js = (ROOT / "js/plaza-ai.js").read_text(encoding="utf-8")
    term = (ROOT / "js/terminal.js").read_text(encoding="utf-8")
    html = (ROOT / "strategies.html").read_text(encoding="utf-8")

    assert "grid-template-columns: repeat(3" in css, "desktop 3-col missing"
    assert "max-width: 1199px" in css and "repeat(2" in css, "tablet 2-col missing"
    assert "max-width: 767px" in css and "grid-template-columns: 1fr" in css, "mobile 1-col missing"
    assert "max-height: 180px" in css, "svg max-height missing"
    assert "min-height: 44px" in css, "touch target missing"
    assert "overflow-x: hidden" in css, "overflow-x missing"

    for needle in (
        "mktBadgeClassic",
        "metricsBoardHtml",
        "equitySparkSvg",
        "data-plaza-detail",
        "data-get-strategy",
        "抗震穩健度",
        "歷史最大回跌",
    ):
        assert needle in js, "plaza-ai missing " + needle

    assert "fillStats" not in term or "fillStats removed" in term
    assert "pipe.cardHtml" in term or "QAPipeline" in term
    assert "打開回測" not in term and "打开回测" not in term
    assert "plaza-cards.css" in html
    assert "plaza-page" in html
    assert "marketplace.js" not in html

    print("desktop: 3-col >=1200px")
    print("tablet: 2-col 768-1199px")
    print("mobile: 1-col <=767px, svg max-h 180, btn min-h 44")
    print("cards: unified plaza-card + plain metrics + dual CTA")
    print("dead: marketplace.js removed; browser fillStats disabled")
    print("ACCEPT ok")


if __name__ == "__main__":
    main()
