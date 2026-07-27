#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow"]
# ///
"""Re-crush saved model output to the phosphor palette.

    uv run tools/posterise.py                      # tools/species-raw -> public/species
    uv run tools/posterise.py --size 64 --tones 3  # try something else
    uv run tools/posterise.py --contact-sheet /tmp/sheet.png

Split out of generate-species.py so the look can be iterated without a GPU:
this loads pillow and nothing else, so a full re-crush of 256 portraits takes
a second or two, where regenerating them takes hours. Tuning the palette is
the part you actually want to do twenty times.
"""

from __future__ import annotations

import argparse
import math
import pathlib
import sys

from PIL import Image, ImageOps

#: the game's greens, from src/style.css
DARK = (0x00, 0x08, 0x02)
DIM = (0x1D, 0x6B, 0x26)
BRIGHT = (0x4D, 0xFF, 0x5C)


def ramp(tones: int) -> list[tuple[int, int, int]]:
    """`tones` steps from the CRT at rest up to full phosphor."""
    if tones < 2:
        raise ValueError("need at least two tones")
    stops = [DARK, DIM, BRIGHT]
    out = []
    for i in range(tones):
        t = i / (tones - 1) * (len(stops) - 1)
        lo, hi = stops[int(t)], stops[min(int(t) + 1, len(stops) - 1)]
        f = t - int(t)
        out.append(tuple(round(lo[c] + (hi[c] - lo[c]) * f) for c in range(3)))
    return out


def bayer_matrix(n: int = 4) -> list[list[float]]:
    """Recursive Bayer threshold matrix, normalised to 0..1."""
    m = [[0]]
    size = 1
    while size < n:
        m = [[4 * v for v in row] + [4 * v + 2 for v in row] for row in m] + \
            [[4 * v + 3 for v in row] + [4 * v + 1 for v in row] for row in m]
        size *= 2
    return [[v / (size * size) for v in row] for row in m]


def posterise(img: Image.Image, size: int, tones: int, dither: str) -> Image.Image:
    palette = ramp(tones)
    g = ImageOps.autocontrast(img.convert("L").resize((size, size), Image.LANCZOS), cutoff=2)

    if dither == "bayer":
        # Ordered dithering: the cross-hatch reads as scanline texture, where
        # error diffusion can look like compression noise at this resolution.
        bm = bayer_matrix(4)
        n = len(bm)
        out = Image.new("RGB", (size, size))
        px, op = g.load(), out.load()
        levels = tones - 1
        for y in range(size):
            for x in range(size):
                v = px[x, y] / 255 * levels + (bm[y % n][x % n] - 0.5)
                op[x, y] = palette[max(0, min(levels, int(round(v))))]
        return out

    pal_img = Image.new("P", (1, 1))
    flat = [c for rgb in palette for c in rgb]
    # pad by repeating the darkest colour: zero-padding leaves the quantiser
    # 250-odd free pure-black entries and it will use them
    pal_img.putpalette(flat + list(palette[0]) * ((768 - len(flat)) // 3))
    rgb = Image.merge("RGB", (g, g, g))
    mode = Image.FLOYDSTEINBERG if dither == "floyd" else Image.NONE
    return rgb.quantize(palette=pal_img, dither=mode).convert("RGB")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="tools/species-raw")
    ap.add_argument("--out", default="public/species")
    ap.add_argument("--size", type=int, default=96)
    ap.add_argument("--tones", type=int, default=4, help="how many phosphor levels")
    ap.add_argument("--dither", default="floyd", choices=["floyd", "bayer", "none"])
    ap.add_argument("--contact-sheet", default="",
                    help="also write one image with every portrait, for judging the set")
    ap.add_argument("--scale", type=int, default=1, help="nearest-neighbour upscale of the output")
    args = ap.parse_args()

    raw = pathlib.Path(args.raw)
    if not raw.is_dir():
        print(f"no raw images in {raw} — run generate-species.py first", file=sys.stderr)
        return 1
    files = sorted(raw.glob("*.png"))
    if not files:
        print(f"{raw} is empty", file=sys.stderr)
        return 1

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    done = []
    for f in files:
        img = posterise(Image.open(f), args.size, args.tones, args.dither)
        if args.scale > 1:
            img = img.resize((args.size * args.scale,) * 2, Image.NEAREST)
        img.save(out / f.name, optimize=True)
        done.append((f.stem, img))

    total = sum((out / f.name).stat().st_size for f in files)
    print(f"{len(done)} portraits -> {out}  "
          f"({total / 1024:.0f} KB total, {total / len(done):.0f} bytes each)", file=sys.stderr)

    if args.contact_sheet:
        cols = math.ceil(math.sqrt(len(done)))
        rows = math.ceil(len(done) / cols)
        cell = done[0][1].width
        sheet = Image.new("RGB", (cols * cell, rows * cell), DARK)
        for i, (_, img) in enumerate(done):
            sheet.paste(img, ((i % cols) * cell, (i // cols) * cell))
        sheet.save(args.contact_sheet)
        print(f"contact sheet -> {args.contact_sheet} ({cols}x{rows})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
