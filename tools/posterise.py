#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow"]
# ///
"""Re-crush saved model output to the phosphor palette.

    uv run tools/posterise.py                          # species-raw -> public/species
    uv run tools/posterise.py --tones 3 --dither bayer
    uv run tools/posterise.py --size 256 --invert off
    uv run tools/posterise.py --contact-sheet /tmp/sheet.png --scale 2

Where the line between model and post now sits: the MODEL owns lighting,
background and rendering style (see the STYLES table in species-prompts.ts),
because Z-Image is good enough to render the era itself and does it better
than any filter. This step owns only the two things a generator cannot be
trusted with — the exact palette, and the resolution. Both are hard
requirements: 256 portraits ship in a static site and must land on the game's
three greens to the byte.

PNG. At four tones this was not even close — a dithered four-tone image is
the pathological case for JPEG, because the dither is high-frequency noise,
exactly what DCT spends its bits on, where PNG stores four colours at 2 bits
a pixel and runs the black background to almost nothing. Measured at 256px:
PNG 8.5 KB against JPEG q92's 21.9 KB, and JPEG turned 4 colours into 6397
with every pixel off-palette.

At sixteen tones that argument weakens and the numbers deserve re-running,
because sixteen levels barely need dithering at all — and undithered PNG is
much cheaper than the 23 KB measured with Floyd-Steinberg. Compare
--dither none against floyd before reaching for JPEG; the palette guarantee
is worth real bytes, and losing it is what JPEG actually costs.

Between those, one repair remains: --invert. A studio portrait is a dark
subject on a bright wall, which crushes to a glowing rectangle with a hole in
it, because a CRT means the opposite by "bright". Auto-detected per image
rather than flagged, since the model is not consistent about it.

The boundary was learned the hard way. An early prompt asked for "stark high
contrast, simple bold shapes, minimal detail" so the output would survive the
crush, and got a flat white silhouette — 2 distinct grey levels against 210
for a normally-lit portrait, nothing for four tones to dither into. Telling a
generator to REMOVE information destroys what the crush needs; telling it to
RESTRUCTURE information (dramatic key light, engraved linework) puts that
information into edges and tonal masses, which is exactly what survives.

Iteration here is free — pillow and nothing else, so re-crushing 256 portraits
takes a second where regenerating them takes hours. Tune the look here first.
"""

from __future__ import annotations

import argparse
import math
import pathlib
import sys

from PIL import Image, ImageFilter, ImageOps

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


def border_brighter(g: Image.Image) -> bool:
    """True if the frame's edge is lighter than its middle — i.e. a lit backdrop.

    Cheap, and it has to be automatic: the model is not consistent about this.
    Of the first three raws, two came back as a dark subject on a bright studio
    wall and one as a lit subject on black. A fixed --invert would have been
    wrong for one of them either way.
    """
    from PIL import ImageStat
    w, h = g.size
    edge = ImageStat.Stat(g.crop((0, 0, w, h // 8))).mean[0]
    middle = ImageStat.Stat(g.crop((w // 4, h // 4, 3 * w // 4, 3 * h // 4))).mean[0]
    return edge > middle


def posterise(
    img: Image.Image,
    size: int,
    tones: int,
    dither: str,
    gamma: float = 1.0,
    sharpen: float = 1.6,
    cutoff: int = 2,
    invert: str = "auto",
) -> Image.Image:
    """All of the look lives here.

    The generator is asked for nothing but a good image — no palette, no
    contrast, no era — because a model told to pre-empt this step produces
    something with no tonal range left to work with. So this is where the era
    is applied, and why it is worth having real controls.

    Order matters: sharpen at full resolution BEFORE downsampling. A face that
    is 512px of soft gradient becomes 96px of mush; unsharp masking first keeps
    the features that survive the quantiser.
    """
    palette = ramp(tones)
    g = img.convert("L")

    # A phosphor CRT is light drawn on darkness: bright means lit. A studio
    # portrait is the opposite — a dark subject against a bright wall — and
    # crushing that straight maps THE WALL to full phosphor, so the frame
    # glows and the subject reads as a hole in it. Flipping it is the single
    # biggest improvement available in post.
    #
    # It is a repair, not the ideal. Inverting also makes the darkest things
    # brightest, so a black leather jerkin out-glows a lit face — tonally
    # backwards. The real fix is a raw that is already lit-subject-on-black,
    # which is what the `crt` and `lit` prompt styles ask for; on those this
    # correctly does nothing.
    if invert == "on" or (invert == "auto" and border_brighter(g)):
        g = ImageOps.invert(g)

    if sharpen > 0:
        g = g.filter(ImageFilter.UnsharpMask(radius=2, percent=int(sharpen * 100), threshold=2))
    g = g.resize((size, size), Image.LANCZOS)
    g = ImageOps.autocontrast(g, cutoff=cutoff)
    if gamma != 1.0:
        # <1 lifts the shadows (more phosphor lit), >1 deepens them
        lut = [min(255, int(((i / 255) ** gamma) * 255 + 0.5)) for i in range(256)]
        g = g.point(lut)

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
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--tones", type=int, default=16, help="how many phosphor levels")
    ap.add_argument("--dither", default="floyd", choices=["floyd", "bayer", "none"])
    ap.add_argument("--gamma", type=float, default=1.0,
                    help="<1 lifts shadows (more lit phosphor), >1 deepens them")
    ap.add_argument("--sharpen", type=float, default=1.6,
                    help="unsharp before downsampling; 0 disables")
    ap.add_argument("--cutoff", type=int, default=2, help="autocontrast percentile clip")
    ap.add_argument("--invert", default="auto", choices=["auto", "on", "off"],
                    help="auto flips dark-subject-on-bright-wall raws; see border_brighter()")
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
        img = posterise(Image.open(f), args.size, args.tones, args.dither,
                        args.gamma, args.sharpen, args.cutoff, args.invert)
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
