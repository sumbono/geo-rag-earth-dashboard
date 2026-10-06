"""Task 10: idempotent telemetry ingest + windowed, capped timeseries query.

PK is composite `(buoy_id, ts)` (Task 2), so ingest must be
`INSERT ... ON CONFLICT DO NOTHING`: the same payload posted twice is 200 with
no second row. The query window defaults to the last 24 h and never returns
more than the 5,000 newest points. The 64 KB body cap is one global middleware
in `main.py`, exercised here through the ingest route it was specified for.
"""
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.models import Telemetry
from tests.helpers import login


@pytest.fixture(autouse=True)
def isolate_telemetry(engine_session):
    """Wipe `telemetry` before and after every test.

    Rows persist in the shared geo_test DB, so exact-count / window assertions
    would otherwise see leftovers from earlier tests (same pattern as
    test_search_bbox's `isolate_tiles`).
    """
    engine_session.execute(sa.delete(Telemetry))
    engine_session.commit()
    yield
    engine_session.execute(sa.delete(Telemetry))
    engine_session.commit()


def _payload(ts: datetime, buoy_id: str = "buoy-rs-1", value: float = 1.5, unit: str = "m") -> dict:
    return {"buoy_id": buoy_id, "ts": ts.isoformat(), "value": value, "unit": unit}


@pytest.mark.db
def test_telemetry_requires_auth(create_client):
    """Both paths sit behind verify_jwt (test_auth's sweep covers them too)."""
    r = create_client.get("/telemetry/query", params={"buoy_id": "buoy-rs-1"})
    assert r.status_code == 401
    r = create_client.post("/telemetry/ingest", json=_payload(datetime.now(timezone.utc)))
    assert r.status_code == 401


@pytest.mark.db
def test_ingest_then_query_roundtrip(create_client):
    login(create_client)
    ts = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=30)
    r = create_client.post("/telemetry/ingest", json=_payload(ts, value=2.25))
    assert r.status_code == 200

    r = create_client.get("/telemetry/query", params={"buoy_id": "buoy-rs-1"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"points", "count"}
    assert body["count"] == len(body["points"]) == 1
    point = body["points"][0]
    assert set(point) == {"ts", "value"}
    assert point["value"] == 2.25
    parsed = datetime.fromisoformat(point["ts"])
    assert parsed.utcoffset() == timedelta(0), "ts must be UTC (timestamptz)"
    assert parsed == ts, "ingest ts must round-trip unchanged"


@pytest.mark.db
def test_ingest_duplicate_is_idempotent(create_client, engine_session):
    login(create_client)
    ts = datetime.now(timezone.utc).replace(microsecond=0)
    payload = _payload(ts, value=4.0)
    assert create_client.post("/telemetry/ingest", json=payload).status_code == 200
    assert create_client.post("/telemetry/ingest", json=payload).status_code == 200
    rows = engine_session.scalar(
        sa.select(sa.func.count()).select_from(Telemetry).where(Telemetry.buoy_id == "buoy-rs-1")
    )
    assert rows == 1, "duplicate (buoy_id, ts) must not create a second row"
    r = create_client.get("/telemetry/query", params={"buoy_id": "buoy-rs-1", "hours": 100000})
    assert r.status_code == 200
    assert r.json()["count"] == 1


@pytest.mark.db
def test_ingest_empty_buoy_id_422(create_client):
    login(create_client)
    r = create_client.post("/telemetry/ingest", json=_payload(datetime.now(timezone.utc), buoy_id=""))
    assert r.status_code == 422


@pytest.mark.db
def test_oversize_body_413_and_normal_passes(create_client):
    """Global body cap: > 64 KB → 413 everywhere, normal traffic untouched."""
    login(create_client)
    big = _payload(datetime.now(timezone.utc))
    big["unit"] = "x" * 70_000  # JSON body strictly over 65536 bytes
    r = create_client.post("/telemetry/ingest", json=big)
    assert r.status_code == 413
    assert r.json() == {"detail": "payload too large"}
    # the cap must not disturb a normal-sized request on the same route
    r = create_client.post("/telemetry/ingest", json=_payload(datetime.now(timezone.utc)))
    assert r.status_code == 200


@pytest.mark.db
def test_query_default_window_and_buoy_filter(create_client, engine_session):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    engine_session.execute(
        sa.insert(Telemetry),
        [
            {"buoy_id": "b1", "ts": now - timedelta(hours=1), "value": 1.0, "unit": "m"},
            {"buoy_id": "b1", "ts": now - timedelta(hours=30), "value": 2.0, "unit": "m"},
            {"buoy_id": "b2", "ts": now - timedelta(minutes=5), "value": 3.0, "unit": "m"},
        ],
    )
    engine_session.commit()
    login(create_client)

    # default window: last 24 h — b1's 30 h-old point is out, b2's recent one irrelevant
    body = create_client.get("/telemetry/query", params={"buoy_id": "b1"}).json()
    assert body["count"] == 1, "default window is 24 h"
    assert body["points"][0]["value"] == 1.0

    # explicit hours widen the window (30 h-old point comes back)
    body = create_client.get("/telemetry/query", params={"buoy_id": "b1", "hours": 36}).json()
    assert body["count"] == 2

    # buoy filter: b2's recent point never leaks into b1's results (and vice versa)
    body = create_client.get("/telemetry/query", params={"buoy_id": "b2"}).json()
    assert body["count"] == 1
    assert body["points"][0]["value"] == 3.0

    # no buoy_id: the whole window (any buoy) — this is what keeps the auth
    # sweep's bare GET /telemetry/query at 200
    body = create_client.get("/telemetry/query").json()
    assert body["count"] == 2

    # unknown buoy: well-formed empty result, not an error
    assert create_client.get("/telemetry/query", params={"buoy_id": "nope"}).json() == {
        "points": [],
        "count": 0,
    }


@pytest.mark.db
def test_query_hours_clamp_keeps_newest_5000(create_client, engine_session):
    login(create_client)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    total = 5005
    engine_session.execute(
        sa.insert(Telemetry),
        [
            {"buoy_id": "buoy-clamp", "ts": now - timedelta(hours=total - i),
             "value": float(i), "unit": "m"}
            for i in range(total)
        ],
    )
    engine_session.commit()

    r = create_client.get("/telemetry/query", params={"buoy_id": "buoy-clamp", "hours": 100000})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 5000
    assert len(body["points"]) == 5000

    # newest kept: the five oldest rows (i=0..4) are dropped, i=5 becomes first
    first, last = body["points"][0], body["points"][-1]
    assert first["value"] == 5.0
    assert last["value"] == float(total - 1)
    assert datetime.fromisoformat(first["ts"]) == now - timedelta(hours=total - 5)
    assert datetime.fromisoformat(last["ts"]) == now - timedelta(hours=1)

    # chronological order for charting (Task 21 draws a line over points)
    stamps = [datetime.fromisoformat(p["ts"]) for p in body["points"]]
    assert stamps == sorted(stamps)
