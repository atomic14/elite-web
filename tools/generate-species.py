#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow"]
# ///
"""Generate inhabitant portraits for every system, then crush them to phosphor.

    node --experimental-strip-types tools/species-prompts.ts 1 --json > /tmp/g1.json

    # fast path: 4-bit quantised Z-Image, model loaded ONCE (default)
    uv run tools/generate-species.py /tmp/g1.json --repo ../ultra-fast-image-gen

    # same model, but a fresh process per image — only for a one-off
    uv run tools/generate-species.py /tmp/g1.json --backend cli

    # built-in path: full-precision diffusers, needs its own dependencies
    uv run --with torch --with diffusers --with transformers --with accelerate \
        tools/generate-species.py /tmp/g1.json --backend diffusers

Three backends, and the difference between the first two is the whole ball
game for a 256-system run:

  server (default)  POST to the local FastAPI in newideas99/ultra-fast-image-gen.
                    Z-Image Turbo quantised to 4 bits (~8 GB resident against
                    ~30 GB for fp16), and the model is loaded ONCE and stays
                    resident across every request.
  cli               the same repo's generate.py, one process per image. It
                    loads and unloads the model every single time — for 256
                    portraits that is 256 cold starts, which dwarfs the actual
                    inference. Kept for a single test image.
  diffusers         the original in-process path, for full precision or when
                    you do not want a second checkout.

The server is started automatically if it is not already up, and left running
afterwards so a second pass is instant. Neither of the first two backends
needs anything in *this* environment: that process owns torch, so this script
declares only pillow, and the heavy dependencies are passed on the command
line for the one backend that actually needs them in-process.

One real difference between the backends: the ultra-fast repo takes no
negative prompt, so the manifest's negative is dropped for server and cli.
Expect slightly more lettering and watermark-ish artefacts; the posterise
mostly eats them.

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

from PIL import Image

# The look lives in tools/posterise.py — imported, not copied. This script used
# to carry its own posterise() and its own copy of the palette, which is the
# same shape as every other bug this project has had: two definitions of one
# thing, drifting apart. It had already happened — that copy never gained the
# invert step, so images crushed on the way out looked different from the same
# images re-crushed later from the raws.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from posterise import posterise  # noqa: E402


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
    ap.add_argument("--size", type=int, default=256, help="output edge in pixels")
    ap.add_argument("--tones", type=int, default=4, help="how many phosphor levels")
    ap.add_argument("--dither", default="floyd", choices=["floyd", "bayer", "none"])
    # 256, not 512. The output is posterised down to 96px anyway, so asking
    # for 512 spends four times the memory and time on detail that is thrown
    # away by the quantiser. This is the single biggest lever if you are
    # running out of memory.
    # The posterised output only needs 96px, but this is also the resolution of
    # the raw you keep — so if you want the unposterised images to be worth
    # looking at, raise it. 512 is comfortable now that MPS runs in bfloat16.
    ap.add_argument("--gen-size", type=int, default=512,
                    help="model resolution; also the size of the kept raw (512 for nicer raws)")
    ap.add_argument("--steps", type=int, default=8, help="Z-Image-Turbo is a few-step model")
    ap.add_argument("--limit", type=int, default=0, help="stop after N (for a trial run)")
    ap.add_argument("--only", default="", help="comma-separated system names, for a trial run")
    # server, not cli: the cli backend reloads ~8 GB of weights per image, so
    # for 256 systems the model loads dwarf the inference. Same model either way.
    ap.add_argument("--backend", default="server", choices=["server", "cli", "diffusers"],
                    help="server = quantised, model stays resident (default)")
    ap.add_argument("--repo", default="../ultra-fast-image-gen",
                    help="clone of ultra-fast-image-gen (server and cli backends)")
    ap.add_argument("--server", default="http://127.0.0.1:7860",
                    help="where that repo's server.py listens; started if not already up")
    ap.add_argument("--server-wait", type=int, default=900,
                    help="seconds to wait for the server (first run downloads the model)")
    ap.add_argument("--job-timeout", type=int, default=600,
                    help="seconds to wait for one image")
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

    gen_image = {
        "server": make_server_backend,
        "cli": make_cli_backend,
        "diffusers": make_diffusers_backend,
    }[args.backend](args)

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
        posterise(image, args.size, args.tones, args.dither).save(dest, optimize=True)
        print(f"[{i}/{len(prompts)}] {p['system']:<10} {p['species']}", file=sys.stderr)

    print(f"\nwrote to {out}" + (f" (raws in {raw_out})" if raw_out else ""), file=sys.stderr)
    return 0


def find_repo(args):
    """Locate the ultra-fast-image-gen clone, or explain how to get one."""
    repo = pathlib.Path(args.repo).expanduser().resolve()
    if not (repo / "generate.py").is_file():
        raise SystemExit(
            f"no generate.py in {repo}\n"
            f"  git clone https://github.com/newideas99/ultra-fast-image-gen\n"
            f"then point --repo at it.")
    import shutil
    if not shutil.which("uv"):
        raise SystemExit("uv not found; it runs the other repo's dependencies")
    return repo


def make_server_backend(args):
    """Drive the ultra-fast repo's FastAPI server, keeping the model resident.

    This exists because of an easy and expensive mistake. The obvious way to
    use that repo is to shell out to its generate.py per image — which works,
    and is what --backend cli still does. But generate.py loads the model,
    generates, and exits. Z-Image quantised is ~8 GB of weights; paying that
    load 256 times costs far more than the 256 inferences it wraps.

    server.py holds the same model in memory and takes jobs over HTTP, so the
    load is paid once. The protocol is submit-then-poll: POST /api/generate
    returns a job id, GET /api/jobs/<id> reports progress and finally the
    image URLs, GET /api/files/<id>/<name> is the PNG.

    Only stdlib here — urllib, not requests — so the pillow-only dependency
    line stays true.
    """
    import subprocess
    import time
    import urllib.error
    import urllib.request

    base = args.server.rstrip("/")

    def api(path: str, payload=None, timeout=30):
        req = urllib.request.Request(f"{base}{path}")
        if payload is not None:
            req.data = json.dumps(payload).encode()
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    def up() -> bool:
        try:
            api("/api/status", timeout=3)
            return True
        except (urllib.error.URLError, OSError, ValueError):
            return False

    proc = None
    if up():
        print(f"server backend: reusing {base}", file=sys.stderr)
    else:
        repo = find_repo(args)
        print(f"starting {repo}/server.py (first run downloads the model) ...", file=sys.stderr)
        # Left running deliberately: the next pass then starts instantly, and
        # a run that dies halfway does not take the loaded weights with it.
        proc = subprocess.Popen(
            ["uv", "run", "--with-requirements", "requirements.txt", "python", "server.py"],
            cwd=repo, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        for _ in range(args.server_wait):
            if up():
                break
            if proc.poll() is not None:
                raise SystemExit(
                    f"server.py exited with {proc.returncode}. Try running it by hand:\n"
                    f"  cd {repo} && uv run --with-requirements requirements.txt python server.py")
            time.sleep(1)
        else:
            raise SystemExit(f"server did not come up at {base} within {args.server_wait}s")
        print(f"server backend: {args.model} via {base}", file=sys.stderr)

    def run(p):
        job = api("/api/generate", {
            "model": args.model,
            "prompt": p["prompt"],
            "width": args.gen_size, "height": args.gen_size,
            "steps": args.steps,
            "seed": p["seed"] % (2 ** 31),
            "count": 1,
            **({"device": args.device} if args.device else {}),
        })["job_id"]

        deadline = time.monotonic() + args.job_timeout
        while True:
            st = api(f"/api/jobs/{job}")
            if st["status"] == "error" or st["error"]:
                raise SystemExit(
                    f"{p['system']}: {st['error'] or 'job failed'}\n"
                    f"If the model is not downloaded yet, open {base} and pull "
                    f"'{args.model}' once — the picker shows download progress.")
            if st["images"]:
                break
            if time.monotonic() > deadline:
                raise SystemExit(f"{p['system']}: job {job} still {st['status']} after "
                                 f"{args.job_timeout}s")
            time.sleep(0.4)

        url = st["images"][0]["url"]
        if not url.startswith("http"):
            url = base + ("" if url.startswith("/") else "/") + url
        with urllib.request.urlopen(url, timeout=60) as r:
            from io import BytesIO
            return Image.open(BytesIO(r.read())).copy()

    return run


def make_cli_backend(args):
    """Drive the same repo's generate.py, one process per image.

    Correct but slow at scale: it reloads the model every invocation. Use it
    for a single test image; use the server backend for a real run.

    Its CLI takes a seed and an output path, so per-system reproducibility is
    the same either way.
    """
    import subprocess
    import tempfile

    repo = find_repo(args)
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

    print(f"cli backend: {args.model} via {repo} "
          f"(reloads the model per image — --backend server is far quicker)",
          file=sys.stderr)
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
