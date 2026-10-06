"""Fixture dump runner — STAC query → budgeted extract → embed → ``pg_dump``
→ ``fixtures/seed.sql.gz`` (Task 14).

The pipeline behind spec success criterion 4 ("clone → search in under 10
minutes"): this committed dump is what ``deploy/initdb/02-seed.sh`` restores
on first ``docker compose up``, so a fresh stack is search-ready with **zero
network calls** (Task 22 offline CI and Task 25 prod consume the same file).

Run::

    python etl/make_fixture_dump.py --tiles 100

Pipeline (all stages idempotent — re-running converges to the same dump):

 1. **STAC query** (network): 1–3 scenes near the Red Sea, cloud < 20 —
    ``download_sentinel2.search_scenes`` (Earth Search, the ladder's
    primary), records via ``process_scenes`` manifest-only mode (no TIFFs).
 2. **Extract** (network, windowed COG reads): ``extract_chips`` with
    **stride=512** — the Ruling R12 production budget, never the dense
    briefed default (stride=128 would project ~6 700 chips/scene).  The
    global ``--tiles`` budget is sliced per scene by :func:`scene_caps`
    (ceil(remaining/scenes_left), sum == budget) and passed as
    ``max_chips``; the runner stops early if the budget is exhausted —
    production runs use the same mechanisms with a ~2 000-chip budget.
 3. **Embed** (model, cached checkpoint): ``embed_remoteclip.embed_chips``
    over the accumulated ``chips_manifest.jsonl`` — real RemoteCLIP unless
    ``ENCODER=fake``; already-embedded chips are skipped, so a re-run costs
    no inference (Ruling R3: REAL chips and REAL embeddings only, no
    synthetic jitter).
 4. **Telemetry**: ``seed_telemetry.seed()`` defaults (buoy-rs-1..5,
    ≈5 040 rows, ON CONFLICT DO NOTHING) unless ``--no-telemetry``.
 5. **Dump**: ``pg_dump --data-only --table=tiles --table=telemetry`` piped
    through gzip (deterministic ``mtime=0``) to ``fixtures/seed.sql.gz``,
    plus the sidecar ``fixtures/seed.manifest.json`` recording the actual
    ``tiles_count`` / ``telemetry_count`` — the restore test asserts against
    *those* numbers, never a hard-coded 100 (Ruling R3: network/CPU limits
    may leave fewer than the target; floor 40, record what you got).

``pg_dump`` comes from PATH when installed; otherwise (this environment has
no host client) via ``sudo docker compose exec -T db pg_dump`` — only valid
for a localhost ``DATABASE_URL``, which the default is.

Run tests from ``etl/``: ``../.venv/bin/pytest -v tests/test_fixture_dump.py``
(the ``db``-marked restore test needs ``docker compose up -d db``).
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import math
import os
import shutil
import subprocess
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import sqlalchemy as sa

from download_sentinel2 import (  # local module (Task 11)
    DEFAULT_BBOX,
    DEFAULT_CLOUD_COVER,
    LadderError,
    process_scenes,
    search_scenes,
)
from embed_remoteclip import DEFAULT_DATABASE_URL, embed_chips
from extract_chips import extract_chips
import seed_telemetry

logger = logging.getLogger("make_fixture_dump")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "fixtures" / "seed.sql.gz"
DEFAULT_MANIFEST = REPO_ROOT / "fixtures" / "seed.manifest.json"
DEFAULT_OUT_DIR = Path("data/thumbs")  # == Settings.thumbs_dir (Task 9)
SCENE_CACHE_DIR = Path("data/fixture_scenes")  # manifest-only: never written
DEFAULT_TILES = 100  # Ruling R3: fixture target 100 (floor 40)
MIN_SCENES, MAX_SCENES = 1, 3  # brief: 1–3 scenes near the Red Sea
DEFAULT_SCENES = 3
DEFAULT_STRIDE = 512  # Ruling R12: non-overlapping ≈441 chips/scene @ 10980²
DEFAULT_CHIP_SIZE = 512
DEFAULT_BATCH = 16
R3_FLOOR = 40
DUMP_TABLES = ("tiles", "telemetry")
MANIFEST_VERSION = 1


# --------------------------------------------------------------------------
# Ruling R12 budget: global chips → per-scene max_chips slices
# --------------------------------------------------------------------------


def scene_caps(tiles: int, n_scenes: int) -> list[int]:
    """Slice a global chip budget across scenes: ceil(remaining/scenes_left).

    ``scene_caps(100, 3) → [34, 33, 33]`` (sums to exactly ``tiles``), so
    even three full extractions can never exceed the runner-level budget —
    the same mechanism a production run uses with ~2 000 chips.  A budget
    smaller than the scene count yields trailing zeros (the runner stops).
    """
    if n_scenes < 1:
        raise ValueError(f"n_scenes must be >= 1 (got {n_scenes})")
    if tiles < 1:
        raise ValueError(f"tiles must be >= 1 (got {tiles})")
    caps: list[int] = []
    remaining = tiles
    for i in range(n_scenes):
        cap = math.ceil(remaining / (n_scenes - i))
        caps.append(cap)
        remaining -= cap
    return caps


# --------------------------------------------------------------------------
# Stage 1 — STAC query
# --------------------------------------------------------------------------


def query_scenes(bbox, cloud_cover: float, max_scenes: int) -> list[dict]:
    """1–3 usable scene records (assets for all 4 bands) near the Red Sea.

    Manifest-only mode: per-band COG URLs, no TIFF downloads (the extractor
    reads windows via ``/vsicurl/``).  Scenes with missing bands are dropped
    (recorded as skipped by ``process_scenes``, spec §7).
    """
    items, catalog = search_scenes(bbox, cloud_cover, max_scenes)
    records = process_scenes(items, catalog, SCENE_CACHE_DIR, False)
    usable = [
        rec for rec in records
        if not rec.get("missing_bands") and rec.get("assets", {}).get("B02")
    ][:max_scenes]
    if not usable:
        raise RuntimeError(
            f"no usable scenes for bbox={tuple(bbox)} cloud_cover<={cloud_cover} "
            f"in {catalog} — cannot build a fixture dump"
        )
    logger.info(
        "STAC query: %d usable scene(s): %s",
        len(usable),
        ", ".join(
            f"{rec['scene_id']} (cloud {rec.get('cloud_cover')}%)" for rec in usable
        ),
    )
    return usable


# --------------------------------------------------------------------------
# Stage 5 — pg_dump
# --------------------------------------------------------------------------


def pg_dump_argv(database_url: str) -> list[str]:
    """argv for ``pg_dump --data-only --table=tiles --table=telemetry``.

    Uses PATH's ``pg_dump`` when present; otherwise falls back to the compose
    ``db`` container (no host client in this environment) — which is only
    correct for a localhost URL, checked here rather than silently dumping
    the wrong server.
    """
    parsed = urllib.parse.urlparse(database_url)
    db = (parsed.path or "/").lstrip("/") or "postgres"
    user = parsed.username or "postgres"
    host = parsed.hostname or "localhost"
    tail: list[str] = ["--data-only"]
    for table in DUMP_TABLES:
        tail += ["--table", table]
    if shutil.which("pg_dump"):
        return [
            "pg_dump",
            "-h", host,
            "-p", str(parsed.port or 5432),
            "-U", user,
            "-d", db,
            *tail,
        ]
    if host not in ("localhost", "127.0.0.1"):
        raise RuntimeError(
            f"pg_dump not on PATH and DATABASE_URL host {host!r} is not the "
            "local compose db — install postgresql-client (postgresql-client-16)"
        )
    compose = REPO_ROOT / "docker-compose.yml"
    return [
        "sudo", "-n", "docker", "compose",
        "-f", str(compose),
        "exec", "-T", "db",
        "pg_dump", "-U", user, "-d", db,
        *tail,
    ]


def pg_dump_sql(database_url: str) -> bytes:
    """Run the dump; returns the raw (uncompressed) SQL bytes."""
    argv = pg_dump_argv(database_url)
    env = dict(os.environ)
    password = urllib.parse.urlparse(database_url).password
    if password:
        env["PGPASSWORD"] = password
    logger.info("dumping: %s", " ".join(argv))
    proc = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if proc.returncode != 0:
        raise RuntimeError(
            f"pg_dump failed rc={proc.returncode}: "
            + proc.stderr.decode("utf-8", "replace")[-2000:]
        )
    if not proc.stdout.startswith(b"--\n-- PostgreSQL database dump"):
        raise RuntimeError("pg_dump output is not a SQL dump (header missing)")
    return proc.stdout


def _counts(database_url: str) -> tuple[int, int]:
    """(tiles_count, telemetry_count) of the target DB — what the dump holds."""
    engine = sa.create_engine(database_url)
    try:
        with engine.connect() as conn:
            tiles = conn.execute(sa.text("SELECT count(*) FROM tiles")).scalar_one()
            telemetry = conn.execute(
                sa.text("SELECT count(*) FROM telemetry")
            ).scalar_one()
        return tiles, telemetry
    finally:
        engine.dispose()


# --------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------


def run(
    *,
    tiles: int,
    scenes: int,
    bbox,
    cloud_cover: float,
    stride: int,
    chip_size: int,
    out_dir: Path,
    batch: int,
    database_url: str,
    telemetry: bool,
    out_path: Path,
    manifest_path: Path,
) -> dict:
    """Execute stages 1–5; write dump + sidecar manifest; returns the manifest."""
    scene_records = query_scenes(bbox, cloud_cover, scenes)
    caps = scene_caps(tiles, len(scene_records))

    manifest_file = Path(out_dir) / "chips_manifest.jsonl"
    extracted = 0
    scene_ids: list[str] = []
    for rec, cap in zip(scene_records, caps):
        if cap <= 0 or extracted >= tiles:
            break  # runner-level budget exhausted (Ruling R12)
        got = extract_chips(
            scene_urls=rec["assets"],
            out_dir=out_dir,
            chip_size=chip_size,
            stride=stride,
            max_chips=cap,
        )
        extracted += len(got)
        scene_ids.append(rec["scene_id"])
        logger.info(
            "scene %s: %d/%d budgeted chips (stride=%d)",
            rec["scene_id"], len(got), cap, stride,
        )
    if extracted < R3_FLOOR:
        logger.warning(
            "only %d chips extracted — below the Ruling R3 floor of %d; "
            "proceeding (network/CPU limits intervene → record what you got)",
            extracted, R3_FLOOR,
        )

    # Stage 3 — real RemoteCLIP (ENCODER env overrides), idempotent skips.
    embedded = embed_chips(manifest_file, batch=batch, database_url=database_url)

    # Stage 4 — synthetic buoy series (idempotent).
    seeded = seed_telemetry.seed(database_url=database_url) if telemetry else 0

    tiles_count, telemetry_count = _counts(database_url)

    # Stage 5 — data-only dump → gzip (mtime=0: byte-stable across runs).
    sql = pg_dump_sql(database_url)
    gz_bytes = gzip.compress(sql, compresslevel=9, mtime=0)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(gz_bytes)

    encoder = os.environ.get("ENCODER", "").strip() or "remoteclip"
    sidecar = {
        "version": MANIFEST_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool": "etl/make_fixture_dump.py",
        "database": (urllib.parse.urlparse(database_url).path or "").lstrip("/"),
        "encoder": encoder,
        "tables": list(DUMP_TABLES),
        "tiles_requested": tiles,
        "stride": stride,
        "chip_size": chip_size,
        "max_chips_per_scene": caps,
        "scenes": scene_ids,
        "extracted_chips": extracted,
        "embedded_chips": embedded,
        "telemetry_inserted": seeded,
        "tiles_count": tiles_count,
        "telemetry_count": telemetry_count,
        "gz_bytes": len(gz_bytes),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(sidecar, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    logger.info(
        "wrote %s (%d bytes gz) and %s — tiles_count=%d telemetry_count=%d",
        out_path, len(gz_bytes), manifest_path, tiles_count, telemetry_count,
    )
    return sidecar


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _load_env_file(path: Path) -> None:
    """KEY=VALUE lines → os.environ, never overriding live variables."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip("'\"")


def _parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="make_fixture_dump",
        description=(
            "Build fixtures/seed.sql.gz: STAC query → budgeted chip extract "
            "(stride 512, R12) → RemoteCLIP embed → telemetry seed → "
            "pg_dump --data-only (tiles + telemetry) + sidecar manifest."
        ),
    )
    parser.add_argument(
        "--tiles", type=int, default=DEFAULT_TILES,
        help=f"global chip budget for this run (R12); fixture target "
             f"{DEFAULT_TILES}, floor {R3_FLOOR} (default {DEFAULT_TILES})",
    )
    parser.add_argument(
        "--scenes", type=int, default=DEFAULT_SCENES,
        help=f"STAC scenes to query, near the Red Sea (default {DEFAULT_SCENES}, "
             f"max {MAX_SCENES})",
    )
    parser.add_argument(
        "--cloud-cover", type=float, default=DEFAULT_CLOUD_COVER,
        help=f"max eo:cloud_cover percent (default {DEFAULT_CLOUD_COVER:g})",
    )
    parser.add_argument(
        "--bbox", nargs=4, type=float,
        default=list(DEFAULT_BBOX), metavar=("W", "S", "E", "N"),
        help="west south east north (default: Saudi Red Sea window)",
    )
    parser.add_argument(
        "--stride", type=int, default=DEFAULT_STRIDE,
        help=f"extract stride — R12 production budget, keep {DEFAULT_STRIDE} "
             f"(default {DEFAULT_STRIDE}; dense 128 must not be used)",
    )
    parser.add_argument(
        "--chip-size", type=int, default=DEFAULT_CHIP_SIZE,
        help=f"chip edge in pixels (default {DEFAULT_CHIP_SIZE})",
    )
    parser.add_argument(
        "--out-dir", default=str(DEFAULT_OUT_DIR),
        help=f"thumbs/manifest directory (default {DEFAULT_OUT_DIR})",
    )
    parser.add_argument(
        "--out", default=str(DEFAULT_OUT),
        help=f"dump path (default {DEFAULT_OUT})",
    )
    parser.add_argument(
        "--manifest", default=str(DEFAULT_MANIFEST),
        help=f"sidecar manifest path (default {DEFAULT_MANIFEST})",
    )
    parser.add_argument(
        "--database-url", default=None,
        help="target DB (default: $DATABASE_URL, else dev geo)",
    )
    parser.add_argument(
        "--batch", type=int, default=DEFAULT_BATCH,
        help=f"embed rows per transaction (default {DEFAULT_BATCH})",
    )
    parser.add_argument(
        "--no-telemetry", action="store_true",
        help="skip the buoy-rs-N telemetry seed stage",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    _load_env_file(Path.cwd() / ".env")
    _load_env_file(REPO_ROOT / ".env")
    if not 1 <= args.scenes <= MAX_SCENES:
        logger.error("--scenes must be in 1..%d (got %d)", MAX_SCENES, args.scenes)
        return 2
    if args.tiles < 1:
        logger.error("--tiles must be >= 1 (got %d)", args.tiles)
        return 2
    db_url = args.database_url or os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL
    try:
        run(
            tiles=args.tiles,
            scenes=args.scenes,
            bbox=tuple(args.bbox),
            cloud_cover=args.cloud_cover,
            stride=args.stride,
            chip_size=args.chip_size,
            out_dir=Path(args.out_dir),
            batch=args.batch,
            database_url=db_url,
            telemetry=not args.no_telemetry,
            out_path=Path(args.out),
            manifest_path=Path(args.manifest),
        )
    except LadderError as exc:
        logger.error("unrecoverable: %s", exc)  # no catalog → no scene list
        return 2
    except (ValueError, RuntimeError) as exc:
        logger.error("%s", exc)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
