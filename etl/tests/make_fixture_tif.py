"""Synthetic Sentinel-2-like scene generator for the chip-extractor tests.

Decision (task brief): **no binary GeoTIFFs in git** — tests call
``make_fixture_tif()`` into pytest's ``tmp_path``. Also runnable standalone::

    python etl/tests/make_fixture_tif.py /tmp/scene --size 1024

Layout mirrors what ``etl/download_sentinel2.py`` writes to its cache:
one directory per scene with ``B02.tif``/``B03.tif``/``B04.tif``/``B08.tif``
(single-band uint16, georeferenced) plus a ``scene.json`` carrying
``scene_id`` and ``datetime``.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

BANDS = ("B02", "B03", "B04", "B08")
DEFAULT_DATETIME = "2026-10-04T08:04:23.747000Z"
# Golden transform the bbox test pins: 39E/22N origin, 0.0001 deg/px (~11 m).
DEFAULT_TRANSFORM = from_origin(39.0, 22.0, 0.0001, 0.0001)

# Distinct base levels + a *different gradient shape* per band. Shapes must
# not be affine-related (col vs row vs diagonal vs V): the previews apply a
# per-channel percentile stretch, which is invariant to a*x+b — only content
# shape distinguishes the channels in tests. Gradients also keep the stretch
# non-degenerate (a constant chip would collapse).
_BASE = {"B02": 500.0, "B03": 2000.0, "B04": 4000.0, "B08": 8000.0}


def _band_pattern(band: str, size: int) -> np.ndarray:
    """Deterministic uint16 pattern: unique base + unique gradient shape."""
    row = np.arange(size, dtype=np.float32)[:, None] / size
    col = np.arange(size, dtype=np.float32)[None, :] / size
    ramp = {
        "B02": col,             # horizontal
        "B03": row,             # vertical
        "B04": (col + row) / 2,  # diagonal
        "B08": np.abs(col - row),  # V
    }[band]
    return (_BASE[band] + ramp * 6000.0).astype(np.uint16)


def make_fixture_tif(
    scene_dir: Path,
    *,
    size: int = 1024,
    crs: str | None = "EPSG:4326",
    transform=None,
    bands: tuple[str, ...] = BANDS,
    scene_id: str | None = None,
    scene_datetime: str | None = DEFAULT_DATETIME,
) -> Path:
    """Write a synthetic single-band-per-file scene into ``scene_dir``.

    Returns the scene directory. Omitting a band from ``bands`` exercises the
    spec §7 missing-band skip; ``crs=None`` exercises the no-CRS guard.
    """
    scene_dir = Path(scene_dir)
    scene_dir.mkdir(parents=True, exist_ok=True)
    if transform is None:
        transform = DEFAULT_TRANSFORM
    for band in bands:
        if band not in BANDS:
            raise ValueError(f"unknown band {band!r}; expected one of {BANDS}")
        with rasterio.open(
            scene_dir / f"{band}.tif",
            "w",
            driver="GTiff",
            width=size,
            height=size,
            count=1,
            dtype="uint16",
            crs=crs,
            transform=transform,
            compress="deflate",
        ) as dst:
            dst.write(_band_pattern(band, size), 1)
    (scene_dir / "scene.json").write_text(
        json.dumps(
            {"scene_id": scene_id or scene_dir.name, "datetime": scene_datetime}
        )
        + "\n",
        encoding="utf-8",
    )
    return scene_dir


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out_dir", type=Path, help="scene directory to create")
    parser.add_argument("--size", type=int, default=1024, help="square px size")
    parser.add_argument("--crs", default="EPSG:4326", help="fixture CRS")
    args = parser.parse_args(argv)
    make_fixture_tif(args.out_dir, size=args.size, crs=args.crs)
    print(f"wrote fixture scene to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
