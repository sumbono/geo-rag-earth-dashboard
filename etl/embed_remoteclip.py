"""RemoteCLIP embedding job — ``chips_manifest.jsonl`` → ``tiles`` (pgvector).

Consumes Task 12's ``chips_manifest.jsonl`` (records: ``chip_id``,
``chip_path``, ``npy_path``, ``bbox``, ``scene_datetime``) and upserts one
``tiles`` row per chip (Task 2 schema):

  * ``id``          = ``chip_id`` (uuid5, deterministic — ``ON CONFLICT (id)
    DO UPDATE`` so re-runs are idempotent),
  * ``embedding``   = RemoteCLIP ViT-B/32 512-dim L2-normalized vector,
  * ``bbox``        = SRID 4326 WKT polygon, ring (w,s)-(e,s)-(e,n)-(w,n)-(w,s)
    (Task 7 fixture convention),
  * ``thumb_path``  = relative filename ``{chip_id}.jpg`` ONLY — resolved
    against ``Settings.thumbs_dir`` at serve time (Task 9), never an
    absolute path,
  * ``captured_at`` = the record's ``scene_datetime``.

**Single source of truth for the model:** ``apps/api`` is inserted on
``sys.path`` and the job calls ``app.encoder.get_encoder`` (Task 6) —
``ENCODER=fake`` selects FakeEncoder (tests/CI), ``ENCODER=remoteclip``
(the default) the real RemoteCLIPEncoder.  This module defines no encoder of
its own; torch/open_clip stay lazy inside ``RemoteCLIPEncoder.__init__``, so
importing this job is ML-free.

**Band contract (Option B):** ``RemoteCLIPEncoder.encode_image`` consumes
ONLY the 3-channel RGB view.  ``rgb_view()`` slices the 4-band
(B02,B03,B04,B08) ``.npy`` exactly per Task 12's recipe —
``npy[[2, 1, 0]].transpose(1, 2, 0)`` → B04/B03/B02 → R/G/B — applies the
same per-band 2/98-percentile uint8 stretch as the true-color preview
(``extract_chips.to_uint8``) and hands the model encoder-native
``(H, W, 3) uint8``.  Raw 16-bit reflectance therefore never reaches
``RemoteCLIPEncoder._to_uint8_rgb``'s silent [0,1]/[0,255] heuristic (the
Task 6 deferred pointer), and NIR/B08 — false-color preview only — never
enters the model.

**Idempotency:** chips whose embedding is already non-NULL are skipped
*before encoding* (no wasted inference) unless ``--force``; the write itself
is ``INSERT ... ON CONFLICT (id) DO UPDATE`` guarded by
``WHERE tiles.embedding IS NULL OR :force`` — the race-safe restatement of
the same rule.  Each batch commits, so an interrupted run resumes where it
stopped (PLAN §5: ETL resumable and idempotent).  Progress logs
``embedded N/M`` per batch (N = embedded this run, M = valid manifest
records) and the final line carries the row count of ``tiles``.

Usage::

    python etl/embed_remoteclip.py --manifest data/thumbs/chips_manifest.jsonl \
        --batch 16 [--force]

``DATABASE_URL`` (repo ``.env`` → ``.env.example`` default, dev ``geo``
database) picks the target; tests point it at ``geo_test``.  Malformed
manifest records (bad uuid/path/bbox/datetime) and unreadable chips are
skipped with WARNINGs — never a crash (spec §7), never a non-zero exit.

Run tests from ``etl/``: ``../.venv/bin/pytest -v`` (the ``db``-marked
tests need ``docker compose up -d db``).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import NamedTuple

import numpy as np
import sqlalchemy as sa
from geoalchemy2.elements import WKTElement
from sqlalchemy.dialects.postgresql import insert as pg_insert

# Single source of truth for the model (Task 6): reuse apps/api's encoder.
_API_ROOT = Path(__file__).resolve().parent.parent / "apps" / "api"
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.encoder import get_encoder  # noqa: E402  (sys.path insert above)
from app.models import Tile  # noqa: E402  (Task 2 schema — the rows we write)
from extract_chips import to_uint8  # noqa: E402  (the preview's stretch, reused)

logger = logging.getLogger("embed_remoteclip")

DEFAULT_BATCH = 16
# .env.example's DATABASE_URL — the ETL target (dev `geo`; tests use geo_test)
DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://postgres:postgres@localhost:5432/geo"
)
DEFAULT_ENCODER = "remoteclip"  # app.config.Settings default / .env.example
THUMB_PATH_MAX = 512  # tiles.thumb_path is String(512)


class _Chip(NamedTuple):
    """One manifest record prepared for insert."""

    id: uuid.UUID
    npy_path: str
    thumb_path: str
    wkt: str
    captured_at: datetime


# --------------------------------------------------------------------------
# Manifest / record preparation
# --------------------------------------------------------------------------


def load_manifest(path: Path | str) -> list[dict]:
    """Parse chips_manifest.jsonl (Task 12); malformed lines → WARNING + skip.

    First occurrence wins for duplicate chip_ids (the extractor's append
    dedupe keeps its own file unique; a hand-merged manifest must not
    double-count a chip).
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"chips manifest not found: {path}")
    records: list[dict] = []
    seen: set = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
            if not isinstance(rec, dict):
                raise ValueError("not a JSON object")
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "ignoring malformed chips manifest line in %s (%s)", path, exc
            )
            continue
        chip_id = rec.get("chip_id")
        if chip_id is not None:
            if chip_id in seen:
                continue
            seen.add(chip_id)
        records.append(rec)
    return records


def bbox_wkt(bbox) -> str:
    """``(w, s, e, n)`` → SRID 4326 polygon WKT (Task 7 fixture ring order)."""
    w, s, e, n = (float(v) for v in bbox)
    if not (w < e and s < n):
        raise ValueError(
            f"bbox must be (w, s, e, n) with w < e and s < n, got {(w, s, e, n)}"
        )
    return f"POLYGON(({w} {s}, {e} {s}, {e} {n}, {w} {n}, {w} {s}))"


def rgb_view(npy: np.ndarray) -> np.ndarray:
    """4-band (4, H, W) B02,B03,B04,B08 → (H, W, 3) uint8 RGB for the model.

    Band contract (Option B): ``npy[[2, 1, 0]].transpose(1, 2, 0)`` keeps only
    B04/B03/B02 (R/G/B) — NIR never enters RemoteCLIP.  The per-band 2/98
    percentile stretch is ``extract_chips.to_uint8`` (the true-color
    preview's), so the model sees the same RGB the UI thumbnail shows, as
    encoder-native uint8.
    """
    arr = np.asarray(npy)
    if arr.ndim != 3 or arr.shape[0] != 4:
        raise ValueError(
            "expected a 4-band (4, H, W) chip array from chips_manifest, "
            f"got shape {arr.shape}"
        )
    rgb = arr[[2, 1, 0]].transpose(1, 2, 0)  # B04,B03,B02 → R,G,B
    return np.stack([to_uint8(rgb[..., i]) for i in range(3)], axis=-1)


def _prepare(rec: dict) -> _Chip:
    """Manifest record → insert-ready fields; raises on anything uninsertable.

    The caller turns each exception into a spec §7 WARNING skip (bad uuid,
    missing/absent npy file, missing/invalid bbox or scene_datetime —
    ``tiles.captured_at`` is NOT NULL, so a record without a datetime cannot
    be inserted honestly).
    """
    try:
        chip_id = uuid.UUID(str(rec["chip_id"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError(f"invalid chip_id {rec.get('chip_id')!r}") from exc

    thumb_path = Path(str(rec.get("chip_path") or "")).name
    if not thumb_path:
        raise ValueError("chip_path missing/empty — cannot derive thumb filename")
    if len(thumb_path) > THUMB_PATH_MAX:
        raise ValueError(
            f"thumb_path longer than {THUMB_PATH_MAX} chars: {thumb_path[:64]!r}"
        )

    raw_bbox = rec.get("bbox")
    if raw_bbox is None:
        raise ValueError("bbox missing")
    wkt = bbox_wkt(raw_bbox)

    raw_dt = rec.get("scene_datetime")
    if not raw_dt:
        raise ValueError("scene_datetime missing — captured_at is NOT NULL")
    try:
        captured_at = datetime.fromisoformat(str(raw_dt))
    except ValueError as exc:
        raise ValueError(f"invalid scene_datetime {raw_dt!r}") from exc
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=timezone.utc)  # naive = UTC

    npy_path = str(rec.get("npy_path") or "")
    if not npy_path:
        raise ValueError("npy_path missing")
    if not Path(npy_path).is_file():
        raise FileNotFoundError(f"npy file not found: {npy_path}")

    return _Chip(chip_id, npy_path, thumb_path, wkt, captured_at)


# --------------------------------------------------------------------------
# Upsert
# --------------------------------------------------------------------------


def _already_embedded(conn, chips: list[_Chip]) -> set[uuid.UUID]:
    """Chip ids whose embedding is already non-NULL (skip before encoding)."""
    if not chips:
        return set()
    stmt = sa.select(Tile.id).where(
        Tile.id.in_([chip.id for chip in chips]),
        Tile.embedding.isnot(None),
    )
    return set(conn.execute(stmt).scalars())


def _upsert(conn, encoded: list[tuple[_Chip, np.ndarray]], force: bool) -> None:
    """``INSERT … ON CONFLICT (id) DO UPDATE`` — update only if embedding IS
    NULL or ``--force`` (the SQL-side restatement of the skip rule)."""
    rows = [
        {
            "id": chip.id,
            "bbox": WKTElement(chip.wkt, srid=4326),
            "embedding": emb,
            "thumb_path": chip.thumb_path,
            "captured_at": chip.captured_at,
        }
        for chip, emb in encoded
    ]
    stmt = pg_insert(Tile).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "bbox": stmt.excluded.bbox,
            "embedding": stmt.excluded.embedding,
            "thumb_path": stmt.excluded.thumb_path,
            "captured_at": stmt.excluded.captured_at,
        },
        where=sa.or_(Tile.embedding.is_(None), sa.literal(force)),
    )
    conn.execute(stmt)


# --------------------------------------------------------------------------
# Job
# --------------------------------------------------------------------------


def embed_chips(
    manifest: Path | str,
    *,
    batch: int = DEFAULT_BATCH,
    force: bool = False,
    database_url: str | None = None,
    encoder=None,
) -> int:
    """Embed every valid manifest record into ``tiles``; returns N embedded.

    ``manifest``    — Task 12's chips_manifest.jsonl.
    ``batch``       — rows per transaction/progress line (the model itself is
                      called per image — Task 6's API is single-image).
    ``force``       — re-embed chips whose embedding is already non-NULL.
    ``database_url``— defaults to ``$DATABASE_URL``, else the .env.example
                      default (dev ``geo``).
    ``encoder``     — Task 6 ``Encoder``; defaults to ``get_encoder`` over
                      ``$ENCODER`` (``fake`` | ``remoteclip``).

    Progress: ``embedded N/M`` after each batch (M = valid manifest records),
    then ``embedded N/M; tiles rows: T``.  Malformed records and unreadable
    chips log WARNINGs and are skipped (spec §7): they neither stop the run
    nor change its exit status.
    """
    if batch < 1:
        raise ValueError(f"batch must be >= 1 (got {batch})")

    chips: list[_Chip] = []
    skipped = 0
    for rec in load_manifest(manifest):
        try:
            chips.append(_prepare(rec))
        except Exception as exc:  # noqa: BLE001 — spec §7: skip, never crash
            skipped += 1
            logger.warning(
                "skipping manifest record %s: %s: %s",
                rec.get("chip_id", "?"),
                type(exc).__name__,
                exc,
            )

    url = database_url or os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL
    engine = sa.create_engine(url)
    try:
        with engine.connect() as conn:
            existing = set() if force else _already_embedded(conn, chips)
        pending = [chip for chip in chips if chip.id not in existing]

        if encoder is None and pending:
            # Built only when there is work: a fully-embedded re-run must not
            # pay the RemoteCLIP load. Task 6's factory reads Settings.encoder;
            # the ETL needs that one field, so a namespace over $ENCODER is
            # enough (Settings itself wants JWT/password env a batch job has
            # no business with).
            name = os.environ.get("ENCODER", "").strip().lower() or DEFAULT_ENCODER
            encoder = get_encoder(SimpleNamespace(encoder=name))

        embedded = 0
        total = len(chips)  # M — valid manifest records, not just pending
        for start in range(0, len(pending), batch):
            encoded: list[tuple[_Chip, np.ndarray]] = []
            for chip in pending[start : start + batch]:
                try:
                    rgb = rgb_view(np.load(chip.npy_path))
                    encoded.append((chip, encoder.encode_image(rgb)))
                except Exception as exc:  # noqa: BLE001 — one bad chip ≠ job
                    skipped += 1
                    logger.warning(
                        "skipping chip %s: %s: %s",
                        chip.id,
                        type(exc).__name__,
                        exc,
                    )
            if encoded:
                with engine.begin() as conn:
                    _upsert(conn, encoded, force)
                embedded += len(encoded)
            logger.info("embedded %d/%d", embedded, total)

        with engine.connect() as conn:
            rows = conn.execute(
                sa.select(sa.func.count()).select_from(Tile)
            ).scalar_one()
        if skipped:
            logger.warning("skipped %d malformed/unreadable chip(s)", skipped)
        logger.info("embedded %d/%d; tiles rows: %d", embedded, total, rows)
        return embedded
    finally:
        engine.dispose()


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _load_env_file(path: Path) -> None:
    """KEY=VALUE lines → os.environ, never overriding live variables.

    Same semantics as ``download_sentinel2``'s loader, kept local so this job
    does not import the downloader's STAC stack.
    """
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
        prog="embed_remoteclip",
        description=(
            "Embed chips_manifest.jsonl (Task 12) with RemoteCLIP and upsert "
            "idempotently into tiles (pgvector, 512-dim)."
        ),
    )
    parser.add_argument(
        "--manifest",
        required=True,
        help="path to chips_manifest.jsonl written by extract_chips",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=DEFAULT_BATCH,
        help=f"rows per transaction/progress line (default {DEFAULT_BATCH})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-embed chips whose embedding is already non-NULL "
        "(default: skip them before encoding)",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    _load_env_file(Path.cwd() / ".env")
    _load_env_file(Path(__file__).resolve().parent.parent / ".env")
    try:
        embed_chips(args.manifest, batch=args.batch, force=args.force)
    except (FileNotFoundError, ValueError) as exc:
        logger.error("%s", exc)  # bad manifest path / batch / encoder name
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
