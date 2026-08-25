# -*- coding: utf-8 -*-
"""Synthetic grid equity SVGs — random walk with drift (Bloomberg dark).

Produces stair-step upward curves with shallow sawtooth noise; no flat lines.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Union


def _seed_u32(*parts: object) -> int:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(h[:8], 16)


def _rng(state: int) -> tuple[int, float]:
    # LCG → [0, 1)
    state = (1664525 * state + 1013904223) & 0xFFFFFFFF
    return state, state / 4294967296.0


def synthesize_grid_equity(
    apy_pct: float,
    max_dd_pct: float,
    n: int = 100,
    seed: Optional[Union[int, str]] = None,
) -> List[float]:
    """100-point equity path: drift to ~APY over window, shallow grid sawtooth.

    max_dd_pct may be negative (e.g. -2.1) or positive; depth uses abs value.
    Returns equity starting at 1.0.
    """
    apy = max(8.0, float(apy_pct or 48.0))
    dd = abs(float(max_dd_pct or 2.5))
    dd = min(max(dd, 0.6), 8.0)
    target = 1.0 + apy / 100.0 * (60.0 / 365.0)  # ~60d window gain
    target = max(1.04, min(target, 1.0 + apy / 100.0 * 0.35))

    state = _seed_u32(seed if seed is not None else "grid", round(apy, 2), round(dd, 2), n)
    eq = 1.0
    peak = 1.0
    out: List[float] = [1.0]
    # Base drift so E[eq_n] ≈ target
    base_drift = (target - 1.0) / max(n - 1, 1)
    noise_amp = base_drift * 0.55
    step_every = 4  # stair / grid fill cadence

    for i in range(1, n):
        state, u1 = _rng(state)
        state, u2 = _rng(state)
        # Box-Muller-ish mild noise
        z = math.cos(2 * math.pi * u1) * math.sqrt(max(1e-9, -2.0 * math.log(max(u2, 1e-9))))
        micro = noise_amp * z * 0.35
        # Occasional grid fill pop (step up)
        fill = base_drift * (1.35 if (i % step_every == 0 and u1 > 0.35) else 0.55)
        # Shallow pullback capped by dd budget vs peak
        pull = 0.0
        if u2 < 0.18:
            pull = -min(dd / 100.0 * 0.22, eq * 0.0045) * (0.4 + u1)
        eq = eq + base_drift + fill * 0.25 + micro + pull
        # Enforce no deep drawdown from peak
        peak = max(peak, eq)
        floor = peak * (1.0 - dd / 100.0)
        if eq < floor:
            eq = floor + (peak - floor) * 0.15
        if eq < out[-1] * 0.992:
            eq = out[-1] * 0.992 + base_drift * 0.5
        out.append(eq)

    # Soft scale end toward target (keep shape)
    if out[-1] > 1e-9:
        scale = target / out[-1]
        scale = max(0.92, min(1.12, scale))
        out = [1.0 + (v - 1.0) * scale for v in out]
        out[0] = 1.0
    return out


def equity_to_svg(
    equity: Sequence[float],
    title: str,
    subtitle: str = "回測 60 日 · 網格合成曲線",
    width: int = 640,
    height: int = 260,
) -> str:
    vals = [float(v) for v in equity]
    if len(vals) < 2:
        vals = [1.0, 1.02]
    lo = min(vals)
    hi = max(vals)
    pad = max((hi - lo) * 0.12, 0.008)
    lo -= pad
    hi += pad
    span = hi - lo or 1.0
    left, right, top, bottom = 40, 600, 72, 230
    w = right - left
    h = bottom - top
    n = len(vals)

    def xy(i: int, v: float) -> tuple[float, float]:
        x = left + (w * i / max(n - 1, 1))
        y = bottom - ((v - lo) / span) * h
        return x, y

    pts = [xy(i, v) for i, v in enumerate(vals)]
    poly = " ".join("{0:.2f},{1:.2f}".format(x, y) for x, y in pts)
    # Area fill under curve
    area = (
        "{0:.2f},{1:.2f} ".format(pts[0][0], bottom)
        + " ".join("{0:.2f},{1:.2f}".format(x, y) for x, y in pts)
        + " {0:.2f},{1:.2f}".format(pts[-1][0], bottom)
    )
    safe_t = (
        str(title or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    safe_s = (
        str(subtitle or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    ret_pct = (vals[-1] / vals[0] - 1.0) * 100.0 if vals[0] else 0.0
    ret_lbl = "{0:+.1f}%".format(ret_pct)

    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
        '  <rect width="{w}" height="{h}" fill="#f8fafc"/>\n'
        '  <text x="24" y="28" fill="#0f172a" font-family="JetBrains Mono, Consolas, monospace" font-size="13">{t}</text>\n'
        '  <text x="24" y="48" fill="#64748b" font-family="JetBrains Mono, Consolas, monospace" font-size="11">{s}</text>\n'
        '  <text x="520" y="48" fill="#0f7b3a" font-family="JetBrains Mono, Consolas, monospace" font-size="12">{r}</text>\n'
        '  <polygon points="{area}" fill="#0f7b3a" fill-opacity="0.12"/>\n'
        '  <polyline points="{poly}" fill="none" stroke="#0f7b3a" stroke-width="2.1" stroke-linejoin="round"/>\n'
        "</svg>\n"
    ).format(w=width, h=height, t=safe_t, s=safe_s, r=ret_lbl, area=area, poly=poly)


def write_synthetic_grid_svg(
    path: Path,
    title: str,
    apy_pct: float,
    max_dd_pct: float,
    seed: Optional[Union[int, str]] = None,
    subtitle: str = "回測 60 日 · 網格合成曲線",
) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    eq = synthesize_grid_equity(apy_pct, max_dd_pct, n=100, seed=seed if seed is not None else path.stem)
    path.write_text(equity_to_svg(eq, title, subtitle=subtitle), encoding="utf-8")
    return path


def write_many(
    chart_dirs: Iterable[Path],
    stem: str,
    title: str,
    apy_pct: float,
    max_dd_pct: float,
) -> None:
    for d in chart_dirs:
        try:
            write_synthetic_grid_svg(Path(d) / "{0}.svg".format(stem), title, apy_pct, max_dd_pct, seed=stem)
        except OSError:
            continue
