"""Sentinel-2 chip extractor — 512px georeferenced chips from scenes (Task 12).

Turns one scene (local TIFFs or remote COG URLs) into three per-chip
artifacts plus ``chips_manifest.jsonl`` (the file Task 13 consumes):

  1. ``{chip_id}.jpg``   — true-color preview (B04/B03/B02 -> R/G/B),
  2. ``{chip_id}_fc.jpg`` — false-color preview (B08/B04/B03 -> NIR-R-G,
     the Option B composite that gives NIR its visible job),
  3. ``{chip_id}.npy``   — 4-band float32 array, band order **B02,B03,B04,B08**,
     shape ``(4, H, W)``, written to the *sibling cache dir* ``<out_dir>/../chips``
     (kept out of the served thumbs directory).

**Band contract (Option B, binding for Task 13):** the ``.npy`` is 4-band for
archival and false-color, but ``RemoteCLIPEncoder.encode_image`` (Task 13)
consumes ONLY the 3-channel RGB view — slice ``npy[[2, 1, 0]].transpose(1, 2, 0)``
to get ``(H, W, 3)`` B04/B03/B02; NIR never enters the model. The true-color
JPG is what the UI shows (``GET /thumbs/{tile_id}``), its ``_fc`` sibling the
NIR view (``?fc=1``, Task 9). ``chips_manifest.jsonl`` records absolute
``chip_path``/``npy_path``; tiles.thumb_path stores ONLY the relative filename
``{chip_id}.jpg`` (Task 13's rule).

**Read paths.** Primary: windowed reads via ``rasterio.open("/vsicurl/" + href)``
— the 2026-10-06 probe proved the Earth Search COG bucket serves
``Accept-Ranges: bytes`` (HEAD 200 / range-GET 206), so one 512-px window is a
few hundred KB of range traffic instead of ~450 MB/scene. Fallback: local
per-band ``B02.tif..B08.tif`` files when ``scene_dir`` is given (Task 11's
cache layout, with ``scene.json`` for scene_id/datetime).

**MPC caveat (carried from Task 11's review):** manifests from an MPC-primary
run may hold UNSIGNED ``blob.core.windows.net`` hrefs (direct GET -> HTTP 409).
Before any rasterio call the extractor gates on that host lacking ``sig=`` and
logs a clear ERROR pointing at re-signing (``download_sentinel2.sign_href()``),
rather than failing cryptically inside /vsicurl/. No signing client lives here.

**Errors (spec §7):** a scene missing any of B02/B03/B04/B08 is skipped with
a WARNING log line (never a crash); so is a CRS-less scene (SRID 4326 bbox is
a hard contract) or any per-scene read failure.

Chip identity: ``chip_id = uuid5(CHIP_NAMESPACE, f"{scene_id}:{row}:{col}")`` —
deterministic across runs/machines (golden test pins it). bbox per chip derives
from the scene geotransform (``rasterio.windows.Window`` +
``rasterio.windows.transform``), reprojected to SRID 4326 as ``(w, s, e, n)``.

Run tests from ``etl/``: ``../.venv/bin/pytest -v`` (offline, deterministic).
"""
from __future__ import annotations

import contextlib
import json
import logging
import re
import uuid
import warnings
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import rasterio
from rasterio.errors import NotGeoreferencedWarning
from rasterio.warp import transform as warp_transform
from rasterio.windows import Window
from rasterio.windows import transform as window_transform

logger = logging.getLogger("extract_chips")

BANDS = ("B02", "B03", "B04", "B08")  # npy archive order (4-band float)
# ChipRecord shape: {chip_id, chip_path, npy_path, bbox, scene_datetime}
ChipRecord = dict
DEFAULT_OUT_DIR = Path("data/thumbs")  # == Settings.thumbs_dir (Task 9)
DEFAULT_CHIP_SIZE = 512
DEFAULT_STRIDE = 128
JPEG_QUALITY = 95
# Fixed namespace: chip ids depend only on (scene_id, row, col) — never on
# time, path or process — so re-runs and other machines agree.
CHIP_NAMESPACE = uuid.uuid5(
    uuid.NAMESPACE_URL, "https://geo.sumbono.dev/geo-rag-earth-dashboard/chips"
)
MPC_BLOB_HOST = "blob.core.windows.net"

# scene-id day (reuses download_sentinel2's id conventions): Earth Search
# "S2A_37QDD_20261004_0_L2A" / MPC "..._T37QDD_20261004T110813"-style ids.
_ES_DAY_RE = re.compile(r"^S2[A-Z]_(?:\d{2}[A-Z]{3})_(\d{8})_")
_MPC_DAY_RE = re.compile(r"_T\d{2}[A-Z]{3}_(\d{8})")


# --------------------------------------------------------------------------
# Chip identity / scene metadata
# --------------------------------------------------------------------------


def chip_id_for(scene_id: str, row: int, col: int) -> str:
    """Deterministic uuid5(scene_id + row + col) — stable across runs."""
    return str(uuid.uuid5(CHIP_NAMESPACE, f"{scene_id}:{row}:{col}"))


def _datetime_from_scene_id(scene_id: str) -> str | None:
    """Day-precision fallback (``YYYY-MM-DDT00:00:00Z``) parsed from the id.

    Used when no scene.json is available (URL mode). Real sensing time lives
    in the manifest/scene.json; this is the honest day-granularity stand-in.
    """
    for pattern in (_ES_DAY_RE, _MPC_DAY_RE):
        match = pattern.search(scene_id or "")
        if match:
            day = match.group(1)
            return f"{day[0:4]}-{day[4:6]}-{day[6:8]}T00:00:00Z"
    return None


def _read_scene_meta(scene_dir: Path) -> dict:
    """scene.json written by Task 11's downloader (scene_id, datetime)."""
    path = scene_dir / "scene.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning(
            "could not read %s (%s) — falling back to directory name", path, exc
        )
        return {}


def _unsigned_mpc_href(href: str) -> bool:
    """MPC blob URL without a SAS signature — direct GET answers HTTP 409."""
    return MPC_BLOB_HOST in href and "sig=" not in href


def _scene_id_from_href(href: str) -> str:
    """Scene id = parent directory of the band file (both catalogs' layout)."""
    path = urlparse(href).path
    parsed = Path(path)
    return parsed.parent.name or parsed.stem


# --------------------------------------------------------------------------
# Scene sources — local files (fallback) or /vsicurl/ hrefs (primary)
# --------------------------------------------------------------------------


def _local_sources(scene_dir: Path):
    meta = _read_scene_meta(scene_dir)
    scene_id = str(meta.get("scene_id") or scene_dir.name)
    scene_dt = meta.get("datetime") or _datetime_from_scene_id(scene_id)
    sources = {band: str(scene_dir / f"{band}.tif") for band in BANDS}
    missing = [band for band in BANDS if not Path(sources[band]).is_file()]
    return sources, scene_id, scene_dt, missing, []


def _url_sources(scene_urls: dict[str, str]):
    present = {
        band: scene_urls[band] for band in BANDS if scene_urls.get(band)
    }
    missing = [band for band in BANDS if band not in present]
    unsigned = [band for band, href in present.items() if _unsigned_mpc_href(href)]
    # scene id from the canonical band's URL directory (B02 preferred)
    href = present.get("B02") or next(iter(present.values()), "")
    scene_id = _scene_id_from_href(href)
    scene_dt = _datetime_from_scene_id(scene_id)
    sources = {band: "/vsicurl/" + href for band, href in present.items()}
    return sources, scene_id, scene_dt, missing, unsigned


def open_band(path: str):
    """Open one band dataset for windowed reads (local path or /vsicurl/ URL).

    Seam: the deterministic URL-mode tests monkeypatch this to serve local
    fixture data instead of hitting the network.
    """
    return rasterio.open(path)


# --------------------------------------------------------------------------
# Pixel -> preview / bbox helpers
# --------------------------------------------------------------------------


def to_uint8(arr) -> np.ndarray:
    """2/98-percentile linear stretch -> uint8 (deterministic per input).

    Sentinel-2 L2A bands are uint16 reflectance; previews need 8-bit. A
    constant (nodata) chip cannot be stretched: it maps to a constant output
    (mid-gray, black when the constant is zero) instead of dividing by zero.
    """
    a = np.asarray(arr, dtype=np.float32)
    if a.size == 0:
        return np.zeros(a.shape, dtype=np.uint8)
    lo, hi = np.percentile(a, (2.0, 98.0))
    if not hi > lo:
        return np.full(a.shape, 128 if float(a.max()) > 0 else 0, dtype=np.uint8)
    scaled = (a - float(lo)) * (255.0 / float(hi - lo))
    return np.clip(scaled, 0, 255).astype(np.uint8)


def true_color(r, g, b) -> np.ndarray:
    """B04/B03/B02 -> (3, H, W) uint8 RGB (the UI's default preview)."""
    return np.stack([to_uint8(r), to_uint8(g), to_uint8(b)])


def false_color(nir, red, green) -> np.ndarray:
    """B08/B04/B03 -> (3, H, W) uint8 NIR-R-G (Option B false-color preview)."""
    return np.stack([to_uint8(nir), to_uint8(red), to_uint8(green)])


def chip_bbox(window: Window, transform, crs) -> tuple[float, float, float, float]:
    """(w, s, e, n) in SRID 4326 for one pixel window of the scene."""
    win_transform = window_transform(window, transform)
    corners_px = (
        (0, 0),
        (window.width, 0),
        (window.width, window.height),
        (0, window.height),
    )
    # `@` (matmul): affine `*` on a point tuple is PendingDeprecationWarning
    corners = [win_transform @ point for point in corners_px]
    xs = [float(p[0]) for p in corners]
    ys = [float(p[1]) for p in corners]
    if crs is not None and crs.to_epsg() != 4326:
        xs, ys = warp_transform(crs, "EPSG:4326", xs, ys)
        xs = [float(x) for x in xs]
        ys = [float(y) for y in ys]
    return (min(xs), min(ys), max(xs), max(ys))


def _chip_starts(size: int, chip_size: int, stride: int) -> list[int]:
    """Window start offsets along one axis; edge remainder is dropped."""
    if size < chip_size:
        return []
    return list(range(0, size - chip_size + 1, stride))


def _write_jpeg(path: Path, rgb: np.ndarray) -> None:
    """Write a (3, H, W) uint8 RGB preview via GDAL's JPEG driver.

    Thumbnails carry no georeference, so the writer legitimately warns
    NotGeoreferencedWarning — suppressed here (and PAM disabled so no
    .aux.xml sidecars ever pollute the served thumbs dir).
    """
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=NotGeoreferencedWarning)
        with rasterio.Env(GDAL_PAM_ENABLED="NO"):
            with rasterio.open(
                path,
                "w",
                driver="JPEG",
                width=rgb.shape[2],
                height=rgb.shape[1],
                count=3,
                dtype="uint8",
                quality=JPEG_QUALITY,
            ) as dst:
                dst.write(rgb)


def _append_manifest(path: Path, records: list[dict]) -> None:
    """Append chip records to chips_manifest.jsonl, deduped by chip_id.

    Append semantics (Task 13's index): re-running the same scene must not
    duplicate lines — chip_ids are deterministic, so only genuinely new chips
    are appended; existing lines are left untouched.
    """
    existing: set[str] = set()
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                existing.add(json.loads(line)["chip_id"])
            except (json.JSONDecodeError, KeyError):
                logger.warning("ignoring malformed chips manifest line in %s", path)
    new = [record for record in records if record["chip_id"] not in existing]
    if not new:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for record in new:
            handle.write(json.dumps(record) + "\n")


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def _extract_scene(sources, scene_id, scene_dt, out_dir, chip_size, stride, url_mode):
    """Open the scene's bands, write every full-size chip + manifest lines."""
    datasets: dict = {}
    env = (
        rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR")
        if url_mode
        else contextlib.nullcontext()
    )
    try:
        with env:
            for band, path in sources.items():
                datasets[band] = open_band(path)
        reference = datasets[BANDS[0]]
        width, height = reference.width, reference.height
        transform, crs = reference.transform, reference.crs
        if crs is None:
            # SRID 4326 is a contract: without a CRS no bbox can be derived.
            logger.warning(
                "scene %s: no CRS on its band rasters — cannot derive an "
                "SRID 4326 bbox, scene skipped (spec §7)",
                scene_id,
            )
            return []
        rows = _chip_starts(height, chip_size, stride)
        cols = _chip_starts(width, chip_size, stride)
        if not rows or not cols:
            logger.warning(
                "scene %s: %dx%d smaller than chip_size=%d — no chips extracted",
                scene_id, width, height, chip_size,
            )
            return []
        out_dir.mkdir(parents=True, exist_ok=True)
        npy_dir = out_dir.parent / "chips"  # sibling cache dir (out of thumbs)
        npy_dir.mkdir(parents=True, exist_ok=True)

        records: list[dict] = []
        for row in rows:
            for col in cols:
                window = Window(col, row, chip_size, chip_size)
                band_px = {
                    band: datasets[band].read(1, window=window) for band in BANDS
                }
                chip_id = chip_id_for(scene_id, row, col)
                # 4-band float archive: B02,B03,B04,B08 (Task 13 slices the
                # RGB view itself — see module docstring band contract).
                npy = np.stack([band_px[band] for band in BANDS]).astype(np.float32)
                np.save(npy_dir / f"{chip_id}.npy", npy)
                _write_jpeg(
                    out_dir / f"{chip_id}.jpg",
                    true_color(band_px["B04"], band_px["B03"], band_px["B02"]),
                )
                _write_jpeg(
                    out_dir / f"{chip_id}_fc.jpg",
                    false_color(band_px["B08"], band_px["B04"], band_px["B03"]),
                )
                records.append(
                    {
                        "chip_id": chip_id,
                        "chip_path": str(out_dir / f"{chip_id}.jpg"),
                        "npy_path": str(npy_dir / f"{chip_id}.npy"),
                        "bbox": chip_bbox(window, transform, crs),
                        "scene_datetime": scene_dt,
                    }
                )
        _append_manifest(out_dir / "chips_manifest.jsonl", records)
        logger.info(
            "scene %s: %d chips extracted (chip_size=%d stride=%d) -> %s",
            scene_id, len(records), chip_size, stride, out_dir,
        )
        return records
    finally:
        for dataset in datasets.values():
            dataset.close()


def extract_chips(
    scene_dir: Path | None = None,
    scene_urls: dict[str, str] | None = None,
    out_dir: Path | None = None,
    chip_size: int = DEFAULT_CHIP_SIZE,
    stride: int = DEFAULT_STRIDE,
) -> list[ChipRecord]:
    """Extract every full-size chip of one scene; returns the ChipRecords.

    ``scene_dir``   — local scene directory (Task 11 cache layout:
                      ``B02.tif..B08.tif`` + ``scene.json``); the fallback path.
    ``scene_urls``  — ``{band: https COG href}`` (Task 11 manifest's
                      ``assets`` dict); the primary path, read windowed via
                      ``/vsicurl/``. When both are given, ``scene_dir`` wins.
    ``out_dir``     — defaults to ``data/thumbs`` (the directory
                      ``Settings.thumbs_dir`` serves; Task 9). Per chip it
                      receives ``{chip_id}.jpg`` + ``{chip_id}_fc.jpg``; the
                      4-band ``{chip_id}.npy`` goes to the sibling
                      ``../chips/`` cache dir; ``chips_manifest.jsonl`` lands
                      in ``out_dir`` (appended, deduped by chip_id).

    ChipRecord: ``{chip_id, chip_path, npy_path, bbox (w,s,e,n) SRID 4326,
    scene_datetime}``. Skipped scenes (missing band, unsigned MPC blob URL,
    no CRS, read failure) log WARNING/ERROR and return ``[]`` — never crash
    (spec §7).
    """
    if scene_dir is None and scene_urls is None:
        raise ValueError(
            "extract_chips needs scene_dir (local TIFFs) or scene_urls (band hrefs)"
        )
    if chip_size <= 0 or stride <= 0:
        raise ValueError(f"chip_size and stride must be positive (got {chip_size}, {stride})")
    out_dir = (Path(out_dir) if out_dir is not None else DEFAULT_OUT_DIR).resolve()

    url_mode = scene_dir is None
    if not url_mode and scene_urls is not None:
        logger.info("both scene_dir and scene_urls given — using scene_dir")
    if url_mode:
        sources, scene_id, scene_dt, missing, unsigned = _url_sources(scene_urls)
    else:
        sources, scene_id, scene_dt, missing, unsigned = _local_sources(Path(scene_dir))

    if missing:
        # spec §7: missing band -> scene skipped with a WARNING, never a crash
        logger.warning(
            "scene %s: missing band(s) %s — scene skipped (spec §7)",
            scene_id, ", ".join(missing),
        )
        return []
    if unsigned:
        # MPC-primary manifests can hold UNSIGNED blob hrefs (Task 11 review):
        # fail loudly and actionably BEFORE rasterio produces a cryptic error.
        logger.error(
            "scene %s: unsigned Planetary Computer blob URL for %s — direct "
            "GET answers HTTP 409; re-sign via "
            "etl/download_sentinel2.sign_href() (or re-run the downloader's "
            "MPC rung) before extracting; scene skipped",
            scene_id, ", ".join(unsigned),
        )
        return []

    try:
        return _extract_scene(
            sources, scene_id, scene_dt, out_dir, chip_size, stride, url_mode
        )
    except Exception as exc:  # noqa: BLE001 — per-scene failure skips, not crashes
        logger.warning(
            "scene %s skipped: %s: %s — no crash (spec §7)",
            scene_id, type(exc).__name__, exc,
        )
        return []
