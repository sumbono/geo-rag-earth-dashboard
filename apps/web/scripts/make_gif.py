#!/usr/bin/env python
"""Assemble an ordered screenshot sequence into docs/demo.gif (Task 24).

Usage::

    .venv/bin/python apps/web/scripts/make_gif.py \
        apps/web/test-results/gif-frames docs/demo.gif

Reads ``f000.jpg, f001.jpg, …`` (produced by ``e2e/recording.spec.ts``),
resizes to 800 px wide, quantizes every frame to ONE shared adaptive
palette (no per-frame palette flicker, Floyd–Steinberg dither), and writes
an infinitely-looping GIF.

Why this exists instead of ``ffmpeg -i video.webm`` (the brief's first
choice): Playwright's ``video: "on"`` output could not be verified
reliably in this environment — frame-order probes of the webm disagreed
with each other, and the one recording that decoded cleanly still
truncated the settled chart out of its tail (the GIF ended on
"Loading telemetry…"). A screenshot per beat is ordered by construction
and needs no decoder.

Requires Pillow (``uv pip install --python .venv/bin/python pillow`` —
already present in this repo's .venv from the R13 thumbnail tooling).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image


def build(
    frames_dir: Path,
    out: Path,
    width: int = 800,
    colors: int = 128,
    duration_ms: int = 300,
) -> int:
    paths = sorted(frames_dir.glob("f*.jpg"))
    if not paths:
        print(f"no f*.jpg frames in {frames_dir}", file=sys.stderr)
        return 2

    frames: list[Image.Image] = []
    for p in paths:
        with Image.open(p) as im:
            rgb = im.convert("RGB")
            h = round(rgb.height * width / rgb.width)
            frames.append(rgb.resize((width, h), Image.LANCZOS))

    # One shared palette (from a mid-flow frame) + fixed dither: stable
    # colors across the GIF, no shimmer between per-frame palettes.
    palette_src = frames[len(frames) // 2].quantize(
        colors=colors, method=Image.Quantize.MEDIANCUT
    )
    quantized = [
        f.quantize(palette=palette_src, dither=Image.Dither.FLOYDSTEINBERG)
        for f in frames
    ]

    out.parent.mkdir(parents=True, exist_ok=True)
    quantized[0].save(
        out,
        save_all=True,
        append_images=quantized[1:],
        duration=duration_ms,
        loop=0,
        optimize=True,
    )
    size_kb = out.stat().st_size // 1024
    print(f"{out}: {len(quantized)} frames, {width}px, {size_kb} KiB")
    if size_kb > 5 * 1024:
        print(
            "WARNING: over the ~5 MB plan budget — lower --colors or "
            "drop frames (raise --duration / fewer captures)",
            file=sys.stderr,
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("frames_dir", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--width", type=int, default=800)
    ap.add_argument("--colors", type=int, default=128)
    ap.add_argument(
        "--duration",
        type=int,
        default=300,
        help="ms per frame (default 300 ≈ the capture interval)",
    )
    args = ap.parse_args(argv)
    return build(args.frames_dir, args.out, args.width, args.colors, args.duration)


if __name__ == "__main__":
    raise SystemExit(main())
