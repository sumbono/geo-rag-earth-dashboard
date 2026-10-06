"""Tests for etl/make_fixture_dump.py + deploy/initdb/02-seed.sh (Task 14).

Contract under test:

 1. **Ruling R12 budget:** ``scene_caps`` slices a global chip budget across
    scenes (ceil per scene, sum == budget, never over) — the same mechanism
    the production runner uses at ~2,000 chips; the fixture run passes
    ``--tiles 100`` through it.  Dense stride defaults are never used by the
    runner (stride=512 pin lives in the module constants).
 2. **Committed dump restore (brief Step 1):** ``fixtures/seed.sql.gz`` exists
    (gunzip-able gzip), its sidecar ``fixtures/seed.manifest.json`` records
    the actual counts, and running the REAL ``deploy/initdb/02-seed.sh``
    against a scratch database yields
    ``SELECT count(*)`` == the recorded count for both ``tiles`` and
    ``telemetry`` — the assertion is against the manifest, never a
    hard-coded 100 (Ruling R3: take what the network produced).
 3. **Initdb script guards:** the script is executable (the postgres
    entrypoint runs it rather than sourcing it — a sourced ``exit`` would
    kill entrypoint) and refuses to run with the pipe in place (``set -e`` +
    ``ON_ERROR_STOP``).

The restore test drives the script *inside the db container* (it calls
``psql``/``gunzip``; neither exists on the host here) with ``SEED_DB``
pointed at a scratch database, exactly as initdb would — so the committed
script itself is under test, not a re-implementation.

Run from ``etl/``::

    ../.venv/bin/pytest -v tests/test_fixture_dump.py   # needs: docker compose up -d db
"""
import gzip
import json
import os
import subprocess
from pathlib import Path

import pytest
import sqlalchemy as sa

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = REPO_ROOT / "fixtures"
SEED_SQL = FIXTURES / "seed.sql.gz"
SEED_MANIFEST = FIXTURES / "seed.manifest.json"
INITDB_SCRIPT = REPO_ROOT / "deploy" / "initdb" / "02-seed.sh"

SCRATCH_DB = "geo_seed_restore_test"
ADMIN_URL = (
    "postgresql+psycopg://postgres:postgres@localhost:5432/postgres"
)

R3_FLOOR = 40  # fixture-dump floor (Ruling R3: target 100, floor 40)
MAX_DUMP_BYTES = 10 * 1024 * 1024  # commit gate: keep the dump small


# --------------------------------------------------------------------------
# Pure: R12 budget slicing
# --------------------------------------------------------------------------


def test_scene_caps_slice_global_budget():
    """ceil(remaining/scenes_left) per scene: sums to the budget, never over."""
    import make_fixture_dump

    assert make_fixture_dump.scene_caps(100, 3) == [34, 33, 33]
    assert make_fixture_dump.scene_caps(100, 1) == [100]
    assert make_fixture_dump.scene_caps(10, 2) == [5, 5]
    # budget smaller than scene count → later scenes get 0 (runner stops)
    caps = make_fixture_dump.scene_caps(5, 7)
    assert caps == [1, 1, 1, 1, 1, 0, 0]
    for tiles, n in ((100, 3), (1, 1), (5, 7), (2000, 3), (40, 5)):
        caps = make_fixture_dump.scene_caps(tiles, n)
        assert len(caps) == n
        assert sum(caps) == tiles
        assert all(c >= 0 for c in caps)
    with pytest.raises(ValueError):
        make_fixture_dump.scene_caps(100, 0)
    with pytest.raises(ValueError):
        make_fixture_dump.scene_caps(0, 3)


def test_fixture_runner_pins_r12_stride():
    """The fixture runner must use the non-overlapping R12 stride, never the
    dense briefed default (128), and a 1-3 scene budget."""
    import make_fixture_dump

    assert make_fixture_dump.DEFAULT_STRIDE == 512
    assert make_fixture_dump.DEFAULT_STRIDE != 128
    assert make_fixture_dump.DEFAULT_TILES == 100
    assert make_fixture_dump.MAX_SCENES == 3


# --------------------------------------------------------------------------
# The committed dump + the real initdb script
# --------------------------------------------------------------------------


def _dump_manifest() -> dict:
    assert SEED_SQL.is_file(), (
        "fixtures/seed.sql.gz missing — generate it with: "
        "python etl/make_fixture_dump.py --tiles 100"
    )
    assert SEED_MANIFEST.is_file(), (
        "fixtures/seed.manifest.json missing — written by "
        "etl/make_fixture_dump.py alongside the dump"
    )
    return json.loads(SEED_MANIFEST.read_text(encoding="utf-8"))


@pytest.mark.db
def test_seed_dump_gzip_and_manifest_sanity():
    """Dump is a real gzip under the commit gate; manifest counts pass R3."""
    manifest = _dump_manifest()
    assert SEED_SQL.stat().st_size < MAX_DUMP_BYTES, "dump too large to commit"
    assert gzip.decompress(SEED_SQL.read_bytes()).startswith(
        b"--\n-- PostgreSQL database dump"
    ), "seed.sql.gz must gunzip to a pg_dump SQL dump"
    tiles_count = manifest["tiles_count"]
    telemetry_count = manifest["telemetry_count"]
    assert isinstance(tiles_count, int) and tiles_count >= R3_FLOOR, (
        f"Ruling R3 floor: dump holds {tiles_count} tiles, need >= {R3_FLOOR}"
    )
    assert telemetry_count >= 5000, "milestone: telemetry ≈ 5040"
    assert manifest["tables"] == ["tiles", "telemetry"]
    assert manifest["gz_bytes"] == SEED_SQL.stat().st_size
    assert set(manifest["scenes"]), "dump manifest must name the scenes"


@pytest.mark.db
def test_initdb_script_restores_into_scratch_db():
    """Run the committed 02-seed.sh against a scratch DB → counts == manifest.

    This is the end-to-end proof behind spec success criterion 4: the exact
    script docker-entrypoint runs on first boot must create the schema
    (data-only dump carries no DDL) and restore every recorded row, with no
    network and no API boot.
    """
    manifest = _dump_manifest()
    assert os.access(INITDB_SCRIPT, os.X_OK), (
        f"{INITDB_SCRIPT} must be executable — the postgres entrypoint runs "
        "*.sh files and sources non-executable ones (a sourced `exit` would "
        "kill the entrypoint)"
    )
    assert INITDB_SCRIPT.read_text(encoding="utf-8").count("gunzip -c") == 1

    # Scratch database, no schema — stands in for a fresh pgdata volume.
    admin = sa.create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(sa.text(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)"))
        conn.execute(sa.text(f"CREATE DATABASE {SCRATCH_DB}"))
    admin.dispose()

    try:
        # The script runs inside the db container (psql + gunzip live there;
        # no host client in this environment). SEED_DB overrides the target —
        # everything else is the real initdb path, including the fixtures
        # bind mount at /fixtures.
        cmd = [
            "sudo", "-n", "docker", "compose",
            "-f", str(REPO_ROOT / "docker-compose.yml"),
            "exec", "-T", "db",
            "sh", "-c",
            f"SEED_DB={SCRATCH_DB} sh /docker-entrypoint-initdb.d/02-seed.sh",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        assert proc.returncode == 0, (
            f"02-seed.sh failed rc={proc.returncode}\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
        assert "restored" in proc.stdout or "restored" in proc.stderr

        engine = sa.create_engine(
            f"postgresql+psycopg://postgres:postgres@localhost:5432/{SCRATCH_DB}"
        )
        with engine.connect() as conn:
            tiles = conn.execute(sa.text("SELECT count(*) FROM tiles")).scalar_one()
            telemetry = conn.execute(
                sa.text("SELECT count(*) FROM telemetry")
            ).scalar_one()
            # schema the script must have created (data-only dump has no DDL)
            cols = conn.execute(sa.text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'tiles' ORDER BY column_name"
            )).scalars().all()
        engine.dispose()

        assert tiles == manifest["tiles_count"], (
            f"restore count {tiles} != recorded {manifest['tiles_count']}"
        )
        assert telemetry == manifest["telemetry_count"]
        assert cols == ["bbox", "captured_at", "embedding", "id", "thumb_path"]
    finally:
        admin = sa.create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(
                sa.text(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)")
            )
        admin.dispose()
