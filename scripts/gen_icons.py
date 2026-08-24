"""Generate site favicons and apple-touch-icon for iOS Safari."""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BG = (9, 9, 11)  # #09090b
GOLD = (212, 175, 55)
EMERALD = (16, 185, 129)
GOLD_DIM = (120, 98, 32)


def _font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def _draw_bolt(draw: ImageDraw.ImageDraw, cx: float, cy: float, scale: float) -> None:
    pts = [
        (cx + 2 * scale, cy - 10 * scale),
        (cx - 1 * scale, cy - 1 * scale),
        (cx + 4 * scale, cy - 1 * scale),
        (cx - 2 * scale, cy + 11 * scale),
        (cx + 1 * scale, cy + 2 * scale),
        (cx - 3 * scale, cy + 2 * scale),
    ]
    draw.polygon(pts, fill=EMERALD)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    pad = max(2, size // 36)
    radius = max(4, size // 7)
    draw.rounded_rectangle(
        [pad, pad, size - pad - 1, size - pad - 1],
        radius=radius,
        outline=GOLD_DIM,
        width=max(1, size // 90),
    )

    if size >= 64:
        label_font = _font(max(10, size // 11))
        label = "ALPHA"
        bbox = draw.textbbox((0, 0), label, font=label_font)
        lw = bbox[2] - bbox[0]
        lx = (size - lw) // 2 - bbox[0]
        ly = size * 0.18 - bbox[1]
        draw.text((lx, ly), label, fill=GOLD_DIM, font=label_font)

        q_font = _font(int(size * 0.34), bold=True)
        q = "Q"
        qb = draw.textbbox((0, 0), q, font=q_font)
        qw, qh = qb[2] - qb[0], qb[3] - qb[1]
        qx = (size - qw) // 2 - qb[0]
        qy = (size - qh) // 2 - qb[1] + size * 0.04
        draw.text((qx, qy), q, fill=GOLD, font=q_font)
        _draw_bolt(draw, size * 0.68, size * 0.34, size / 36.0)
    else:
        q_font = _font(max(8, int(size * 0.62)), bold=True)
        q = "Q"
        qb = draw.textbbox((0, 0), q, font=q_font)
        qw, qh = qb[2] - qb[0], qb[3] - qb[1]
        qx = (size - qw) // 2 - qb[0]
        qy = (size - qh) // 2 - qb[1]
        draw.text((qx, qy), q, fill=GOLD, font=q_font)
        if size >= 24:
            _draw_bolt(draw, size * 0.72, size * 0.22, size / 20.0)

    return img


def main() -> None:
    specs = [
        ("apple-touch-icon.png", 180),
        ("favicon-32x32.png", 32),
        ("favicon-16x16.png", 16),
    ]
    for name, px in specs:
        out = ROOT / name
        draw_icon(px).save(out, format="PNG", optimize=True)
        print(f"wrote {out} ({px}x{px})")


if __name__ == "__main__":
    main()
