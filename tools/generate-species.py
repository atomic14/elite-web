#!/usr/bin/env python3
"""Generate inhabitant portraits for every system, then crush them to phosphor.

    node --experimental-strip-types tools/species-prompts.ts 1 --json > /tmp/g1.json
    python3 tools/generate-species.py /tmp/g1.json --out public/species

Python rather than TypeScript because that is where the model lives; nothing
here runs at build time or in the browser. The game deploys as a static site,
so images are generated offline and committed.

Model: Tongyi-MAI/Z-Image-Turbo (Apache 2.0 — outputs are ours to ship).

The posterise step is the point, not an afterthought. Straight model output
would look nothing like this game: it is wireframes on a phosphor CRT. Crushing
to a handful of greens at low resolution makes the portraits look like
something the era could have displayed, and it hides the tells — six fingers
and melted features stop mattering at 96 pixels and four tones.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

# The game's palette, from src/style.css.
PHOSPHOR = [
    (0x00, 0x08, 0x02),  # near-black, the CRT at rest
    (0x1D, 0x6B, 0x26),  # --hud-dim
    (0x35, 0xB0, 0x40),  # midtone, interpolated
    (0x4D, 0xFF, 0x5C),  # --hud-green
]


def posterise(img, size: int, palette=PHOSPHOR):
    """Downsample, flatten to `palette`, and dither.

    Ordered (Bayer) dithering rather than Floyd-Steinberg: the cross-hatch
    artefacts read as scanline texture on a CRT, where diffusion noise just
    looks like a dirty JPEG.
    """
    from PIL import Image

    img = img.convert("L").resize((size, size), Image.LANCZOS)

    # autocontrast first — the model's output is rarely using the full range,
    # and without this most portraits collapse into two tones
    from PIL import ImageOps
    img = ImageOps.autocontrast(img, cutoff=2)

    pal_img = Image.new("P", (1, 1))
    flat = [c for rgb in palette for c in rgb]
    pal_img.putpalette(flat + [0] * (768 - len(flat)))

    # quantize() with dithering, via an RGB round-trip so the palette applies
    rgb = Image.merge("RGB", (img, img, img))
    return rgb.quantize(palette=pal_img, dither=Image.FLOYDSTEINBERG).convert("RGB")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", help="JSON from tools/species-prompts.ts --json")
    ap.add_argument("--out", default="public/species")
    ap.add_argument("--size", type=int, default=96, help="output edge in pixels")
    ap.add_argument("--gen-size", type=int, default=512, help="what to ask the model for")
    ap.add_argument("--steps", type=int, default=8, help="Z-Image-Turbo is a few-step model")
    ap.add_argument("--limit", type=int, default=0, help="stop after N (for a trial run)")
    ap.add_argument("--only", default="", help="comma-separated system names, for a trial run")
    args = ap.parse_args()

    data = json.loads(pathlib.Path(args.manifest).read_text())
    prompts = data["prompts"]
    if args.only:
        want = {n.strip().lower() for n in args.only.split(",")}
        prompts = [p for p in prompts if p["system"].lower() in want]
    if args.limit:
        prompts = prompts[: args.limit]

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    try:
        import torch
        from diffusers import DiffusionPipeline
    except ImportError:
        print("needs torch + diffusers + pillow:\n"
              "  pip install torch diffusers transformers accelerate pillow", file=sys.stderr)
        return 1

    device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"loading Z-Image-Turbo on {device} ...", file=sys.stderr)
    pipe = DiffusionPipeline.from_pretrained(
        "Tongyi-MAI/Z-Image-Turbo",
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
    ).to(device)

    for i, p in enumerate(prompts, 1):
        dest = out / f"{p['index']:03d}-{p['system'].lower()}.png"
        if dest.exists():
            continue
        gen = torch.Generator(device=device).manual_seed(p["seed"] % (2**31))
        image = pipe(
            prompt=p["prompt"],
            negative_prompt=p["negative"],
            num_inference_steps=args.steps,
            width=args.gen_size,
            height=args.gen_size,
            generator=gen,
        ).images[0]
        posterise(image, args.size).save(dest, optimize=True)
        print(f"[{i}/{len(prompts)}] {p['system']:<10} {p['species']}", file=sys.stderr)

    print(f"\nwrote {len(prompts)} to {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
