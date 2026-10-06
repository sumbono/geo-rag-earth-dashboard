"""Tests for etl/embed_remoteclip.py (Task 13) — chips_manifest.jsonl → tiles.

The ``db``-marked tests seed the compose Postgres **geo_test** (never the dev
``geo`` database) and run the embed job with ``ENCODER=fake`` — the model is
never downloaded in the committed suite.  Contract under test:

 1. brief Step 1: 3 fake chip ``.npy`` files + manifest → 3 ``tiles`` rows,
    L2-normalized 512-dim embeddings, relative ``thumb_path``,
    WKT polygon bbox (SRID 4326), ``captured_at`` from ``scene_datetime``;
    a re-run adds nothing new (idempotent);
 2. the RGB band recipe the encoder receives (B04/B03/B02, no NIR) plus the
    ``embedded N/M`` batch progress log;
 3. already-embedded chips are skipped *before* encoding unless ``--force``;
 4. malformed manifest records are skipped with WARNINGs, never a crash
    (spec §7).

Run from ``etl/``::

    ../.venv/bin/pytest -v tests/test_embed_upsert.py   # needs: docker compose up -d db
"""
import json
import logging
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest
import sqlalchemy as sa

# Tests target the dedicated geo_test database — NEVER the dev/prod `geo` db.
TEST_DATABASE_URL = (
    "postgresql+psycopg://postgres:postgres@localhost:5432/geo_test"
)

_CHIP_NS = uuid.NAMESPACE_URL
CHIP_IDS = [
    str(uuid.uuid5(_CHIP_NS, f"https://geo.sumbono.dev/task13-test/chip-{i}"))
    for i in range(3)
]
# (w, s, e, n) per chip — distinct so a swapped/rotated bbox would be caught.
BBOXES = [
    (35.0, 20.0, 35.05, 20.05),
    (35.1, 20.0, 35.15, 20.05),
    (35.2, 20.0, 35.25, 20.05),
]
# PostGIS canonicalises ST_AsText (35.0 → 35, no space after ',').
EXPECTED_WKT = [
    "POLYGON((35 20,35.05 20,35.05 20.05,35 20.05,35 20))",
    "POLYGON((35.1 20,35.15 20,35.15 20.05,35.1 20.05,35.1 20))",
    "POLYGON((35.2 20,35.25 20,35.25 20.05,35.2 20.05,35.2 20))",
]
SCENE_DT = "2026-10-04T08:15:28.769000Z"
EXPECTED_CAPTURED_AT = datetime(2026, 10, 4, 8, 15, 28, 769000, tzinfo=timezone.utc)


def _chip_patterns() -> np.ndarray:
    """(4, 8, 8) float32 with a distinct gradient per band (B02,B03,B04,B08).

    Non-affine shapes so any channel swap fails the recipe pin (Task 12's
    review lesson: constant bands collapse under percentile stretch).
    """
    row = np.arange(8, dtype=np.float32)[:, None]
    col = np.arange(8, dtype=np.float32)[None, :]
    b02 = 100.0 + col * 7.0            # column ramp
    b03 = 400.0 + row * 11.0           # row ramp
    b04 = 900.0 + row * 3.0 + col * 5.0  # diagonal
    b08 = 5000.0 + row * 13.0 * col     # NIR — must never enter the model
    return np.stack(
        [np.broadcast_to(b, (8, 8)).astype(np.float32) for b in (b02, b03, b04, b08)]
    )


def _seed_manifest(tmp_path: Path) -> list[dict]:
    """3 fake Task 12 records + their ``.npy`` archives (jpgs not read here)."""
    records = []
    npy = _chip_patterns()
    for i, chip_id in enumerate(CHIP_IDS):
        npy_path = tmp_path / f"{chip_id}.npy"
        np.save(npy_path, npy)
        records.append(
            {
                "chip_id": chip_id,
                "chip_path": str(tmp_path / f"{chip_id}.jpg"),
                "npy_path": str(npy_path),
                "bbox": list(BBOXES[i]),
                "scene_datetime": SCENE_DT,
            }
        )
    manifest = tmp_path / "chips_manifest.jsonl"
    manifest.write_text(
        "".join(json.dumps(r) + "\n" for r in records), encoding="utf-8"
    )
    return records


def _delete_chips(engine, ids) -> None:
    """Remove only this suite's rows (geo_test is shared with apps/api tests)."""
    with engine.begin() as conn:
        conn.execute(
            sa.text("DELETE FROM tiles WHERE id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": list(ids)},
        )


def _fetch_rows(engine, ids) -> dict:
    with engine.connect() as conn:
        result = conn.execute(
            sa.text(
                "SELECT id::text AS id, thumb_path, captured_at, "
                "embedding::text AS embedding FROM tiles "
                "WHERE id = ANY(CAST(:ids AS uuid[]))"
            ),
            {"ids": list(ids)},
        )
        return {r["id"]: dict(r) for r in result.mappings()}


def _bbox_row(engine, chip_id: str):
    with engine.connect() as conn:
        return conn.execute(
            sa.text(
                "SELECT ST_AsText(bbox) AS wkt, ST_SRID(bbox) AS srid "
                "FROM tiles WHERE id = CAST(:id AS uuid)"
            ),
            {"id": chip_id},
        ).one()


@pytest.fixture()
def embed_env(tmp_path, monkeypatch):
    """geo_test ready + 3 fake chips + chips_manifest.jsonl (Task 12 shape)."""
    assert "geo_test" in TEST_DATABASE_URL  # never touch the dev `geo` db
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("ENCODER", "fake")

    engine = sa.create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS postgis"))
        conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
    # apps/api owns the schema — same sys.path convention embed_remoteclip uses.
    api_root = Path(__file__).resolve().parents[2] / "apps" / "api"
    if str(api_root) not in sys.path:
        sys.path.insert(0, str(api_root))
    from app.db import Base
    import app.models  # noqa: F401 — registers mappers

    Base.metadata.create_all(engine)
    # Clean slate: "tiles rows: T" logs the whole table count, so any leftover
    # from an earlier/crashed suite (geo_test is shared with apps/api) would
    # break the assertions.  geo_test is a test-only db — apps' own conftest
    # drop_all's it wholesale at session end.
    with engine.begin() as conn:
        conn.execute(sa.text("DELETE FROM tiles"))
    records = _seed_manifest(tmp_path)
    yield {
        "manifest": tmp_path / "chips_manifest.jsonl",
        "engine": engine,
        "records": records,
    }
    _delete_chips(engine, CHIP_IDS)
    engine.dispose()


@pytest.mark.db
def test_embed_three_fake_chips_upsert_idempotent(embed_env, caplog):
    """Brief Step 1: ENCODER=fake → 3 normalized tiles rows; re-run adds none."""
    import embed_remoteclip

    with caplog.at_level(logging.INFO, logger="embed_remoteclip"):
        rc = embed_remoteclip.main(
            ["--manifest", str(embed_env["manifest"]), "--batch", "2"]
        )
    assert rc == 0

    engine = embed_env["engine"]
    rows = _fetch_rows(engine, CHIP_IDS)
    assert len(rows) == 3, "all 3 fake chips must be embedded into tiles"
    for i, chip_id in enumerate(CHIP_IDS):
        row = rows[chip_id]
        emb = np.array(json.loads(row["embedding"]), dtype=np.float64)
        assert emb.shape == (512,)
        assert abs(float(np.linalg.norm(emb)) - 1.0) < 1e-5  # L2-normalized
        # thumb_path = relative filename only (Task 9 resolves thumbs_dir)
        assert row["thumb_path"] == f"{chip_id}.jpg"
        assert Path(row["thumb_path"]).name == row["thumb_path"]
        assert row["captured_at"] == EXPECTED_CAPTURED_AT
        wkt, srid = _bbox_row(engine, chip_id)
        assert srid == 4326
        assert wkt == EXPECTED_WKT[i]  # (w,s)-(e,s)-(e,n)-(w,n)-(w,s) ring
    assert "embedded 2/3" in caplog.text and "embedded 3/3" in caplog.text

    # Re-run: idempotent — nothing new inserted, nothing re-embedded.
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="embed_remoteclip"):
        rc = embed_remoteclip.main(
            ["--manifest", str(embed_env["manifest"]), "--batch", "2"]
        )
    assert rc == 0
    assert len(_fetch_rows(engine, CHIP_IDS)) == 3
    assert "embedded 0/3" in caplog.text
    assert "tiles rows: 3" in caplog.text


@pytest.mark.db
def test_embed_rgb_recipe_and_batch_progress(embed_env, caplog, monkeypatch):
    """Band contract (Option B): encoder gets B04/B03/B02 uint8, never NIR."""
    import embed_remoteclip
    from extract_chips import to_uint8

    seen: list[np.ndarray] = []
    real_factory = embed_remoteclip.get_encoder

    def spy_factory(settings):
        # ENCODER=fake from the environment must be what reaches Task 6's factory.
        assert settings.encoder == "fake", f"got encoder {settings.encoder!r}"
        inner = real_factory(settings)

        class SpyEncoder:
            def encode_image(self, arr):
                seen.append(np.asarray(arr).copy())
                return inner.encode_image(arr)

        return SpyEncoder()

    monkeypatch.setattr(embed_remoteclip, "get_encoder", spy_factory)

    with caplog.at_level(logging.INFO, logger="embed_remoteclip"):
        rc = embed_remoteclip.main(
            ["--manifest", str(embed_env["manifest"]), "--batch", "2"]
        )
    assert rc == 0
    assert len(seen) == 3
    for i, arr in enumerate(seen):
        assert arr.ndim == 3 and arr.shape[-1] == 3  # (H, W, 3) — not 4-band
        assert arr.dtype == np.uint8  # encoder-native (bypasses [0,1] heuristic)
        npy = np.load(embed_env["records"][i]["npy_path"])
        # npy[[2,1,0]] → B04→R, B03→G, B02→B; B08 (NIR) never enters.
        expected = np.stack(
            [to_uint8(npy[2]), to_uint8(npy[1]), to_uint8(npy[0])], axis=-1
        )
        assert np.array_equal(arr, expected), f"chip {i}: wrong RGB view"
    # batch=2 over 3 records → per-batch progress, then the final count.
    assert "embedded 2/3" in caplog.text
    assert "embedded 3/3" in caplog.text
    assert "tiles rows: 3" in caplog.text


@pytest.mark.db
def test_embed_force_reembeds_otherwise_skips(embed_env, caplog, monkeypatch):
    """Skip-before-encode for non-NULL embeddings; --force re-embeds."""
    import embed_remoteclip

    calls: list[int] = []
    real_factory = embed_remoteclip.get_encoder

    def counting_factory(settings):
        inner = real_factory(settings)

        class SpyEncoder:
            def encode_image(self, arr):
                calls.append(1)
                return inner.encode_image(arr)

        return SpyEncoder()

    monkeypatch.setattr(embed_remoteclip, "get_encoder", counting_factory)
    args = ["--manifest", str(embed_env["manifest"])]

    with caplog.at_level(logging.INFO, logger="embed_remoteclip"):
        assert embed_remoteclip.main(args) == 0
    assert len(calls) == 3

    # Re-run without --force: embedding IS NOT NULL → skip before encoding.
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="embed_remoteclip"):
        assert embed_remoteclip.main(args) == 0
    assert len(calls) == 3, "already-embedded chips must never reach the encoder"
    assert "embedded 0/3" in caplog.text

    # --force: re-embeds all 3 through the ON CONFLICT DO UPDATE path.
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="embed_remoteclip"):
        assert embed_remoteclip.main(args + ["--force"]) == 0
    assert len(calls) == 6
    assert "embedded 3/3" in caplog.text
    assert len(_fetch_rows(embed_env["engine"], CHIP_IDS)) == 3  # still 3 rows


@pytest.mark.db
def test_embed_skips_malformed_records_without_crash(embed_env, caplog, tmp_path):
    """spec §7: bad records (missing npy / bad uuid / no datetime) → WARNING."""
    import embed_remoteclip

    good = dict(embed_env["records"][0])
    bad_missing_npy = dict(good, chip_id=CHIP_IDS[1], npy_path=str(tmp_path / "nope.npy"))
    bad_uuid = dict(good, chip_id="not-a-uuid")
    bad_datetime = dict(embed_env["records"][2], scene_datetime=None)
    manifest = tmp_path / "broken_manifest.jsonl"
    manifest.write_text(
        "".join(
            json.dumps(r) + "\n"
            for r in (good, bad_missing_npy, bad_uuid, bad_datetime)
        ),
        encoding="utf-8",
    )

    # INFO level so the final "embedded N/M" progress line is captured too.
    with caplog.at_level(logging.INFO, logger="embed_remoteclip"):
        embedded = embed_remoteclip.embed_chips(manifest, batch=2)

    assert embedded == 1  # only the good record survives
    assert len(_fetch_rows(embed_env["engine"], CHIP_IDS)) == 1
    assert "nope.npy" in caplog.text  # missing npy named
    assert "not-a-uuid" in caplog.text  # bad uuid named
    assert "scene_datetime" in caplog.text  # missing datetime named
    assert "embedded 1/1" in caplog.text  # M counts valid records only


def test_rgb_view_band_recipe_and_shape_guard():
    """Pure band-contract test (no db): RGB slice + 4-band shape guard."""
    import embed_remoteclip
    from extract_chips import to_uint8

    npy = _chip_patterns()
    rgb = embed_remoteclip.rgb_view(npy)
    assert rgb.dtype == np.uint8
    assert rgb.shape == (8, 8, 3)
    assert np.array_equal(rgb[..., 0], to_uint8(npy[2]))  # B04 → R
    assert np.array_equal(rgb[..., 1], to_uint8(npy[1]))  # B03 → G
    assert np.array_equal(rgb[..., 2], to_uint8(npy[0]))  # B02 → B
    with pytest.raises(ValueError, match="4-band"):
        embed_remoteclip.rgb_view(npy[:3])  # 3-band input rejected
    with pytest.raises(ValueError, match="4-band"):
        embed_remoteclip.rgb_view(npy[0])  # 2-D input rejected
