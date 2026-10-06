"""Tests for etl/seed_telemetry.py (Task 14) — synthetic buoy timeseries.

Contract under test (brief Step 1):

 1. `python etl/seed_telemetry.py --buoys 5 --days 7 --freq 10min` (the
    defaults) inserts buoy ids ``buoy-rs-1..5`` on a 10-minute UTC grid —
    5 buoys x 7 days x 144 samples/day = **5040 rows** (the M2 milestone's
    ``≈5040``; the API's default 24 h window then sees 720 points, under the
    5,000-point Global Constraint cap);
 2. run twice → row count unchanged (``ON CONFLICT DO NOTHING`` idempotency);
 3. every ``ts`` is UTC (``tzinfo is not None``, zero offset) — timestamptz /
    UTC everywhere (PLAN data model);
 4. values are a sinusoid + seeded noise: deterministic across runs (same
    args → same rows, byte-for-byte), so the dump manifest and any chart
    demo are reproducible.

The ``db``-marked tests seed the compose Postgres **geo_test** (never the
dev ``geo`` database) and scope their cleanup to ``buoy-rs-%`` so the suite
coexists with apps/api's telemetry tests.

Run from ``etl/``::

    ../.venv/bin/pytest -v tests/test_seed_telemetry.py   # needs: docker compose up -d db
"""
from datetime import timedelta
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa

# Tests target the dedicated geo_test database — NEVER the dev/prod `geo` db.
TEST_DATABASE_URL = (
    "postgresql+psycopg://postgres:postgres@localhost:5432/geo_test"
)

BUOY_PREFIX = "buoy-rs-%"
DEFAULTS_TOTAL = 5040  # 5 buoys x 7 days x 144 samples/day (10 min freq)
EXPECTED_BUOYS = {f"buoy-rs-{i}" for i in range(1, 6)}


@pytest.fixture()
def seed_env(monkeypatch):
    """geo_test ready (schema + clean ``buoy-rs-%`` slate) → engine."""
    assert "geo_test" in TEST_DATABASE_URL  # never touch the dev `geo` db
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

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
    with engine.begin() as conn:
        conn.execute(
            sa.text("DELETE FROM telemetry WHERE buoy_id LIKE :prefix"),
            {"prefix": BUOY_PREFIX},
        )
    yield engine
    # Leave no fixture rows behind (geo_test is shared with apps/api tests).
    with engine.begin() as conn:
        conn.execute(
            sa.text("DELETE FROM telemetry WHERE buoy_id LIKE :prefix"),
            {"prefix": BUOY_PREFIX},
        )
    engine.dispose()


def _fetch(engine) -> list[tuple]:
    with engine.connect() as conn:
        return conn.execute(
            sa.text(
                "SELECT buoy_id, ts, value, unit FROM telemetry "
                "WHERE buoy_id LIKE :prefix ORDER BY buoy_id, ts"
            ),
            {"prefix": BUOY_PREFIX},
        ).all()


def _count(engine) -> int:
    with engine.connect() as conn:
        return conn.execute(
            sa.text(
                "SELECT count(*) FROM telemetry "
                "WHERE buoy_id LIKE :prefix"
            ),
            {"prefix": BUOY_PREFIX},
        ).scalar_one()


@pytest.mark.db
def test_seed_defaults_idempotent_twice(seed_env, caplog):
    """Brief Step 1: defaults → 5040 rows; a second run adds nothing."""
    import logging

    import seed_telemetry

    with caplog.at_level(logging.INFO, logger="seed_telemetry"):
        assert seed_telemetry.main([]) == 0
    first = _fetch(seed_env)
    assert len(first) == DEFAULTS_TOTAL, "5 buoys x 7 days x 144/day"
    assert f"seeded {DEFAULTS_TOTAL}/{DEFAULTS_TOTAL}" in caplog.text

    # Second run (back-to-back): ON CONFLICT DO NOTHING → count unchanged
    # and every stored value identical (same grid, same seeded noise).
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="seed_telemetry"):
        assert seed_telemetry.main([]) == 0
    second = _fetch(seed_env)
    assert len(second) == DEFAULTS_TOTAL
    assert second == first, "re-run must change no row (values included)"
    assert f"seeded 0/{DEFAULTS_TOTAL}" in caplog.text


@pytest.mark.db
def test_seed_ids_units_and_utc_timestamps(seed_env):
    """buoy-rs-1..5, non-empty unit, every ts a UTC (zero-offset) instant."""
    import seed_telemetry

    assert seed_telemetry.main([]) == 0
    rows = _fetch(seed_env)
    assert {row[0] for row in rows} == EXPECTED_BUOYS
    per_buoy = sum(1 for row in rows if row[0] == "buoy-rs-1")
    assert per_buoy == DEFAULTS_TOTAL // 5  # equal slices per buoy

    for buoy_id, ts, value, unit in rows:
        assert ts.tzinfo is not None, f"{buoy_id}@{ts} is naive — must be UTC"
        assert ts.utcoffset() == timedelta(0), f"{buoy_id}@{ts} not UTC"
        assert unit, "unit must be non-empty"
        assert isinstance(value, float)
    # Sinusoid + noise: no flat line (a constant series would mean the
    # sinusoid/noise never reached the rows).
    series_1 = [row[2] for row in rows if row[0] == "buoy-rs-1"]
    assert max(series_1) > min(series_1)


@pytest.mark.db
def test_seed_explicit_window_rowcount(seed_env):
    """--buoys 2 --days 1 --freq 30min → 2 x 48 = 96 rows, re-run unchanged."""
    import seed_telemetry

    argv = ["--buoys", "2", "--days", "1", "--freq", "30min"]
    assert seed_telemetry.main(argv) == 0
    assert _count(seed_env) == 96
    assert seed_telemetry.main(argv) == 0
    assert _count(seed_env) == 96


def test_parse_freq_contract():
    """Pure (no db): '10min' style spacing → seconds; junk rejected."""
    import seed_telemetry

    assert seed_telemetry.parse_freq("10min") == 600.0
    assert seed_telemetry.parse_freq("30s") == 30.0
    assert seed_telemetry.parse_freq("1h") == 3600.0
    assert seed_telemetry.parse_freq("15MIN") == 900.0  # case-insensitive
    for bad in ("", "10", "min", "0min", "-5min", "abc"):
        with pytest.raises(ValueError):
            seed_telemetry.parse_freq(bad)
