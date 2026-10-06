"""Synthetic buoy telemetry seeder — Red Sea timeseries for the ``telemetry``
table (Task 14).

Produces the rows the TelemetryChart (Task 18) renders, with zero network and
full determinism::

    python etl/seed_telemetry.py --buoys 5 --days 7 --freq 10min

  * **buoy ids**  ``buoy-rs-1`` .. ``buoy-rs-N`` (the chart's default buoy is
    ``buoy-rs-1``),
  * **values**    a 12 h-period sinusoid (per-buoy phase) + seeded noise —
    ``random.Random(f"{seed}:{buoy_id}")`` per buoy, so the same arguments
    reproduce the same rows on any machine, in any order,
  * **timestamps** UTC ``timestamptz`` grid: epoch-aligned ``--freq`` ticks
    ending at ``floor(now_utc, freq)`` — every ``ts`` is tz-aware with a zero
    offset (PLAN data model: UTC everywhere), and two back-to-back runs
    generate the identical grid,
  * **insert**    ``INSERT … ON CONFLICT (buoy_id, ts) DO NOTHING`` — re-runs
    add zero rows (brief Step 1) and any overlapping window keeps the
    first-write value.

Defaults insert 5 buoys x 7 days x 144 samples/day = **5040 rows** (the M2
milestone's ``≈5040``).  The API's default 24 h query window then sees 720
points — under the 5,000-point Global Constraint cap.

``DATABASE_URL`` (repo ``.env`` → ``.env.example`` default, dev ``geo``)
picks the target; tests point it at ``geo_test``.  The table must already
exist (apps/api's ``init_db`` creates it on first boot; compose ``geo`` has
it).  Bad arguments (unknown freq unit, ``--buoys 0``) exit 2 with an error
line, never a traceback.

Run tests from ``etl/``: ``../.venv/bin/pytest -v tests/test_seed_telemetry.py``
(the ``db``-marked tests need ``docker compose up -d db``).
"""
from __future__ import annotations

import argparse
import logging
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

# Single source of truth for the schema (Task 2): reuse apps/api's model.
_API_ROOT = Path(__file__).resolve().parent.parent / "apps" / "api"
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.models import Telemetry  # noqa: E402  (sys.path insert above)

logger = logging.getLogger("seed_telemetry")

DEFAULT_BUOYS = 5
DEFAULT_DAYS = 7.0
DEFAULT_FREQ = "10min"
DEFAULT_UNIT = "m"  # wave height in metres (chart y-axis)
DEFAULT_SEED = 20261006
# .env.example's DATABASE_URL — the ETL target (dev `geo`; tests use geo_test)
DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://postgres:postgres@localhost:5432/geo"
)

PERIOD_S = 12 * 3600  # semidiurnal sinusoid
AMPLITUDE = 0.4
BASELINE = 1.0
NOISE = 0.05
INSERT_CHUNK = 1000  # rows per INSERT (keeps us far under the 65 535-param limit)

_UNIT_SECONDS = {
    "s": 1.0, "sec": 1.0, "secs": 1.0, "second": 1.0, "seconds": 1.0,
    "min": 60.0, "mins": 60.0, "minute": 60.0, "minutes": 60.0,
    "h": 3600.0, "hr": 3600.0, "hour": 3600.0, "hours": 3600.0,
    "d": 86400.0, "day": 86400.0, "days": 86400.0,
}


def parse_freq(text: str) -> float:
    """``'10min' | '30s' | '1h' | '1d'`` → seconds (float).

    Case-insensitive; a missing/unknown unit or a non-positive number raises
    ``ValueError`` (CLI → exit 2).
    """
    s = str(text).strip().lower()
    i = 0
    while i < len(s) and (s[i].isdigit() or s[i] == "."):
        i += 1
    number, unit = s[:i], s[i:].strip()
    if not number or unit not in _UNIT_SECONDS:
        raise ValueError(
            f"invalid freq {text!r} — expected e.g. 30s, 10min, 1h, 1d"
        )
    try:
        seconds = float(number) * _UNIT_SECONDS[unit]
    except ValueError as exc:  # '.' alone / '1.2.3min'
        raise ValueError(
            f"invalid freq {text!r} — expected e.g. 30s, 10min, 1h, 1d"
        ) from exc
    if not seconds > 0:
        raise ValueError(f"freq must be positive (got {text!r})")
    return seconds


def _grid_end(now: datetime, freq_s: float) -> datetime:
    """``floor(now, freq)`` on the UTC epoch grid — two runs in the same tick
    produce the identical window, so seeding twice is a no-op."""
    return datetime.fromtimestamp(
        math.floor(now.timestamp() / freq_s) * freq_s, tz=timezone.utc
    )


def _value(ts: datetime, phase: float, rng: random.Random) -> float:
    """Sinusoid + seeded noise, rounded to milli-unit precision."""
    wave = AMPLITUDE * math.sin(
        2.0 * math.pi * ts.timestamp() / PERIOD_S + phase
    )
    return round(BASELINE + wave + rng.uniform(-NOISE, NOISE), 3)


def build_rows(
    buoys: int = DEFAULT_BUOYS,
    days: float = DEFAULT_DAYS,
    freq: str | float = DEFAULT_FREQ,
    *,
    unit: str = DEFAULT_UNIT,
    seed: int = DEFAULT_SEED,
    now: datetime | None = None,
) -> list[dict]:
    """The full grid as insert dicts (chronological, buoy by buoy).

    Pure function of the arguments (``now`` defaults to the current UTC
    instant) — deterministic, which is what makes a re-run conflict on every
    ``(buoy_id, ts)`` instead of inserting new rows.
    """
    if buoys < 1:
        raise ValueError(f"buoys must be >= 1 (got {buoys})")
    if days <= 0:
        raise ValueError(f"days must be positive (got {days})")
    freq_s = parse_freq(freq) if isinstance(freq, str) else float(freq)
    if not freq_s > 0:
        raise ValueError(f"freq must be positive (got {freq!r})")

    now_utc = now if now is not None else datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    end = _grid_end(now_utc, freq_s)
    steps = int(round(days * 86400.0 / freq_s))
    if steps < 1:
        raise ValueError(
            f"window too small: days={days} at freq={freq_s:g}s → 0 samples"
        )

    rows: list[dict] = []
    for i in range(buoys):
        buoy_id = f"buoy-rs-{i + 1}"
        rng = random.Random(f"{seed}:{buoy_id}")
        phase = 2.0 * math.pi * i / buoys
        for step in range(steps):
            ts = end - timedelta(seconds=freq_s * (steps - 1 - step))
            rows.append(
                {
                    "buoy_id": buoy_id,
                    "ts": ts,
                    "value": _value(ts, phase, rng),
                    "unit": unit,
                }
            )
    return rows


def seed(
    buoys: int = DEFAULT_BUOYS,
    days: float = DEFAULT_DAYS,
    freq: str | float = DEFAULT_FREQ,
    *,
    unit: str = DEFAULT_UNIT,
    seed: int = DEFAULT_SEED,
    database_url: str | None = None,
    now: datetime | None = None,
) -> int:
    """Insert the grid with ``ON CONFLICT DO NOTHING``; returns rows inserted.

    ``database_url`` — defaults to ``$DATABASE_URL``, else the .env.example
                       default (dev ``geo``).  ``now`` — override the window
                       end (deterministic tests); defaults to current UTC.
    """
    rows = build_rows(
        buoys, days, freq, unit=unit, seed=seed, now=now
    )
    url = database_url or os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL
    engine = sa.create_engine(url)
    inserted = 0
    try:
        with engine.begin() as conn:
            for start in range(0, len(rows), INSERT_CHUNK):
                # RETURNING, not rowcount: psycopg3 reports rowcount -1 for
                # row-shaping statements, so the returned rows are the only
                # trustworthy count of "actually inserted" (conflicts omitted).
                stmt = (
                    pg_insert(Telemetry)
                    .values(rows[start : start + INSERT_CHUNK])
                    .on_conflict_do_nothing()
                    .returning(Telemetry.buoy_id)
                )
                inserted += len(conn.execute(stmt).fetchall())
        with engine.connect() as conn:
            total = conn.execute(
                sa.select(sa.func.count()).select_from(Telemetry)
            ).scalar_one()
        logger.info(
            "seeded %d/%d rows (%d already present); telemetry rows: %d",
            inserted,
            len(rows),
            len(rows) - inserted,
            total,
        )
        return inserted
    finally:
        engine.dispose()


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _load_env_file(path: Path) -> None:
    """KEY=VALUE lines → os.environ, never overriding live variables
    (same semantics as ``embed_remoteclip``'s loader, kept local so this job
    has no dependency on the ML/ETL stack)."""
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
        prog="seed_telemetry",
        description=(
            "Seed the telemetry table with deterministic buoy-rs-N timeseries "
            "(sinusoid + seeded noise, UTC grid, ON CONFLICT DO NOTHING)."
        ),
    )
    parser.add_argument(
        "--buoys", type=int, default=DEFAULT_BUOYS,
        help=f"number of buoys: buoy-rs-1..N (default {DEFAULT_BUOYS})",
    )
    parser.add_argument(
        "--days", type=float, default=DEFAULT_DAYS,
        help=f"days of history ending at floor(now, freq) (default {DEFAULT_DAYS:g})",
    )
    parser.add_argument(
        "--freq", default=DEFAULT_FREQ,
        help=f"sample spacing: 30s, 10min, 1h, 1d (default {DEFAULT_FREQ})",
    )
    parser.add_argument(
        "--unit", default=DEFAULT_UNIT,
        help=f"unit column value (default {DEFAULT_UNIT!r})",
    )
    parser.add_argument(
        "--seed", type=int, default=DEFAULT_SEED,
        help="noise seed — same seed + args → same rows (default fixed)",
    )
    parser.add_argument(
        "--database-url", default=None,
        help="target DB (default: $DATABASE_URL, else dev geo)",
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
        seed(
            buoys=args.buoys,
            days=args.days,
            freq=args.freq,
            unit=args.unit,
            seed=args.seed,
            database_url=args.database_url,
        )
    except ValueError as exc:
        logger.error("%s", exc)  # bad freq/buoys/days — no traceback
        return 2
    except sa.exc.SQLAlchemyError as exc:
        logger.error("database error: %s", exc)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
