#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow"]
# ///
"""Generate inhabitant portraits for every system, then crush them to phosphor.

    node --experimental-strip-types tools/species-prompts.ts 1 --json > /tmp/g1.json

    # fast path: 4-bit quantised Z-Image via newideas99/ultra-fast-image-gen
    uv run tools/generate-species.py /tmp/g1.json --repo ../ultra-fast-image-gen

    # built-in path: full-precision diffusers, needs its own dependencies
    uv run --with torch --with diffusers --with transformers --with accelerate \
        tools/generate-species.py /tmp/g1.json --backend diffusers

Two backends. `external` shells out to a separate clone that runs Z-Image
Turbo quantised to 4 bits (~8 GB resident against ~30 GB for fp16, and far
quicker) — that process owns its own environment, so this script needs
nothing but pillow. `diffusers` keeps the original in-process path for when
you want full precision or no second checkout.

This script therefore declares only pillow. The heavy dependencies are passed
on the command line for the backend that actually needs them, rather than
making everyone install three gigabytes of torch to shell out to another
process.

Python rather than TypeScript because that is where the model lives; nothing
here runs at build time or in the browser. The game deploys as a static site,
so images are generated offline and committed.

Model: Tongyi-MAI/Z-Image-Turbo (Apache 2.0 — outputs are ours to ship).

Running out of GPU memory? In order of how much they buy you:
  --gen-size 192      ask for less; it is posterised to 96 anyway
  --dtype bfloat16    if float16 gives you black or NaN images
  --cpu-offload       weights stay in system RAM; slow but it will finish
On Apple silicon the ceiling is a hard watermark rather than a swap, so a
float32 load fails outright where the same model in float16 fits.

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

from PIL import Image, ImageOps

# The game's palette, from src/style.css.
PHOSPHOR = [
    (0x00, 0x08, 0x02),  # near-black, the CRT at rest
    (0x1D, 0x6B, 0x26),  # --hud-dim
    (0x35, 0xB0, 0x40),  # midtone, interpolated
    (0x4D, 0xFF, 0x5C),  # --hud-green
]


def posterise(img, size: int, palette=PHOSPHOR):
    """Downsample, flatten to `palette`, and dither.

    Floyd-Steinberg, which is what Pillow's quantize offers for a custom
    palette. Ordered (Bayer) dithering would arguably read more like a CRT —
    its cross-hatch looks like scanline texture where diffusion noise can look
    like a dirty JPEG — but it needs hand-rolling. Worth trying if the output
    looks too speckly at 96px.
    """
    from PIL import Image

    img = img.convert("L").resize((size, size), Image.LANCZOS)

    # autocontrast first — the model's output is rarely using the full range,
    # and without this most portraits collapse into two tones
    from PIL import ImageOps
    img = ImageOps.autocontrast(img, cutoff=2)

    pal_img = Image.new("P", (1, 1))
    flat = [c for rgb in palette for c in rgb]
    # Pad by REPEATING the darkest colour, not with zeros. A PIL palette holds
    # 256 entries; zero-padding hands the quantiser 252 free pure-black slots
    # and it happily uses them — 11% of a test image came out (0,0,0), which is
    # not in the palette at all and reads as holes in the phosphor.
    pad = list(palette[0]) * ((768 - len(flat)) // 3)
    pal_img.putpalette(flat + pad)

    # quantize() with dithering, via an RGB round-trip so the palette applies
    rgb = Image.merge("RGB", (img, img, img))
    return rgb.quantize(palette=pal_img, dither=Image.FLOYDSTEINBERG).convert("RGB")


def looks_dead(img) -> bool:
    """True if the model handed back an empty frame.

    NaN latents cast to a uniform image, so the pipeline "succeeds" and writes
    a black square. Catching it here matters: without the check a 256-image run
    produces 256 black squares and only a RuntimeWarning to explain it.
    """
    lo, hi = img.convert("L").getextrema()
    return hi - lo < 8


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", help="JSON from tools/species-prompts.ts --json")
    ap.add_argument("--out", default="public/species")
    # Keep the model's own output. Re-crushing it takes seconds where
    # regenerating takes hours, so the posterise settings can be tuned without
    # touching the GPU again. Not committed — see .gitignore.
    ap.add_argument("--raw-out", default="tools/species-raw",
                    help="where to keep the unposterised output ('' to skip)")
    ap.add_argument("--size", type=int, default=96, help="output edge in pixels")
    # 256, not 512. The output is posterised down to 96px anyway, so asking
    # for 512 spends four times the memory and time on detail that is thrown
    # away by the quantiser. This is the single biggest lever if you are
    # running out of memory.
    # The posterised output only needs 96px, but this is also the resolution of
    # the raw you keep — so if you want the unposterised images to be worth
    # looking at, raise it. 512 is comfortable now that MPS runs in bfloat16.
    ap.add_argument("--gen-size", type=int, default=256,
                    help="model resolution; also the size of the kept raw (512 for nicer raws)")
    ap.add_argument("--steps", type=int, default=8, help="Z-Image-Turbo is a few-step model")
    ap.add_argument("--limit", type=int, default=0, help="stop after N (for a trial run)")
    ap.add_argument("--only", default="", help="comma-separated system names, for a trial run")
    ap.add_argument("--backend", default="external", choices=["external", "diffusers"],
                    help="external = quantised, via a clone of ultra-fast-image-gen")
    ap.add_argument("--repo", default="../ultra-fast-image-gen",
                    help="that clone's path (external backend)")
    ap.add_argument("--model", default="zimage-quant", help="model name to pass it")
    ap.add_argument("--device", default="", help="mps / cuda / cpu (default: let the backend decide)")
    ap.add_argument("--dtype", default="auto", choices=["auto", "float16", "bfloat16", "float32"],
                    help="auto = half precision on GPU, float32 on CPU (diffusers backend)")
    ap.add_argument("--cpu-offload", action="store_true",
                    help="keep the model in system RAM and page it in — slow, but survives a small GPU")
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
    raw_out = pathlib.Path(args.raw_out) if args.raw_out else None
    if raw_out:
        raw_out.mkdir(parents=True, exist_ok=True)

    if args.backend == "external":
        gen_image = make_external_backend(args)
    else:
        gen_image = make_diffusers_backend(args)

    for i, p in enumerate(prompts, 1):
        stem = f"{p['index']:03d}-{p['system'].lower()}.png"
        dest = out / stem
        raw_dest = raw_out / stem if raw_out else None
        # Resume must consider BOTH outputs. Testing only the posterised file
        # means that turning --raw-out on after a run skips every system and
        # silently produces no raws at all.
        if dest.exists() and (raw_dest is None or raw_dest.exists()):
            continue

        image = gen_image(p)
        if looks_dead(image):
            print(f"\n{p['system']}: the model returned an empty frame. With the "
                  f"diffusers backend this is float16 overflow — try --dtype bfloat16. "
                  f"Nothing was written.", file=sys.stderr)
            return 2
        if raw_dest:
            image.save(raw_dest)
        posterise(image, args.size).save(dest, optimize=True)
        print(f"[{i}/{len(prompts)}] {p['system']:<10} {p['species']}", file=sys.stderr)

    print(f"\nwrote to {out}" + (f" (raws in {raw_out})" if raw_out else ""), file=sys.stderr)
    return 0


def make_external_backend(args):
    """Drive a clone of newideas99/ultra-fast-image-gen.

    It runs Z-Image Turbo quantised to 4 bits, which is both far lighter and
    much quicker than the full-precision path. Its CLI takes a seed and an
    output path, so per-system reproducibility survives the switch.

    It has no negative-prompt flag, so the manifest's negative is dropped here.
    That is a real difference between the backends: expect slightly more
    lettering and watermark-ish artefacts, which the posterise mostly eats.
    """
    import shutil
    import subprocess
    import tempfile

    repo = pathlib.Path(args.repo).expanduser().resolve()
    if not (repo / "generate.py").is_file():
        raise SystemExit(
            f"no generate.py in {repo}\n"
            f"  git clone https://github.com/newideas99/ultra-fast-image-gen\n"
            f"then point --repo at it.")
    if not shutil.which("uv"):
        raise SystemExit("uv not found; it runs the other repo's dependencies")

    tmpdir = pathlib.Path(tempfile.mkdtemp(prefix="species-"))

    def run(p):
        target = tmpdir / "out.png"
        if target.exists():
            target.unlink()
        cmd = [
            "uv", "run", "--with-requirements", "requirements.txt",
            "python", "generate.py", args.model, p["prompt"],
            "--seed", str(p["seed"] % (2 ** 31)),
            "--output", str(target),
            "--width", str(args.gen_size), "--height", str(args.gen_size),
            "--steps", str(args.steps),
        ]
        if args.device:
            cmd += ["--device", args.device]
        res = subprocess.run(cmd, cwd=repo, capture_output=True, text=True)
        if res.returncode != 0 or not target.exists():
            raise SystemExit(
                f"{p['system']}: the external generator failed\n"
                f"{res.stdout[-2000:]}\n{res.stderr[-2000:]}")
        return Image.open(target).copy()

    print(f"external backend: {args.model} via {repo}", file=sys.stderr)
    return run


def make_diffusers_backend(args):
    """The original in-process path — full precision, no second checkout."""
    try:
        import torch
        from diffusers import DiffusionPipeline
    except ImportError:
        raise SystemExit(
            "the diffusers backend needs its own dependencies:\n"
            "  uv run --with torch --with diffusers --with transformers --with accelerate \\\n"
            "      tools/generate-species.py <manifest.json> --backend diffusers")

    device = args.device or (
        "cuda" if torch.cuda.is_available()
        else "mps" if torch.backends.mps.is_available() else "cpu")

    # bfloat16 rather than float16 on MPS: float16 overflows in this pipeline
    # on Apple silicon and the NaN latents cast to a solid black PNG.
    if args.dtype == "auto":
        dtype = {"cpu": torch.float32, "mps": torch.bfloat16, "cuda": torch.float16}[device]
    else:
        dtype = getattr(torch, args.dtype)

    print(f"loading Z-Image-Turbo on {device} ({dtype}) ...", file=sys.stderr)
    pipe = DiffusionPipeline.from_pretrained("Tongyi-MAI/Z-Image-Turbo", torch_dtype=dtype)
    if args.cpu_offload:
        pipe.enable_sequential_cpu_offload()
    else:
        pipe = pipe.to(device)
    for opt in ("enable_attention_slicing", "enable_vae_slicing", "enable_vae_tiling"):
        try:
            getattr(pipe, opt)()
        except (AttributeError, NotImplementedError):
            pass

    def run(p):
        gen_device = "cpu" if args.cpu_offload else device
        gen = torch.Generator(device=gen_device).manual_seed(p["seed"] % (2 ** 31))
        image = pipe(
            prompt=p["prompt"], negative_prompt=p["negative"],
            num_inference_steps=args.steps,
            width=args.gen_size, height=args.gen_size, generator=gen,
        ).images[0]
        # MPS holds every allocation until told, so a long run creeps up on the
        # watermark even when any single image fits
        if device == "mps" and hasattr(torch, "mps"):
            torch.mps.empty_cache()
        elif device == "cuda":
            torch.cuda.empty_cache()
        return image

    return run


if __name__ == "__main__":
    raise SystemExit(main())
