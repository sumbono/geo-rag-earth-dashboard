"""fix-improve Task 4: GET /coverage — footprint of every indexed tile.

DB-truth counts (not len(seeded_tiles)): conftest's `seeded_tiles` is a dict
of keys (len 1) while appending 50 rows per call, so the feature count is
read back from the `tiles` table itself.
"""
import pytest
from app.models import Tile
from sqlalchemy import func, select

from tests.helpers import login


@pytest.mark.db
def test_coverage_returns_one_feature_per_tile(create_client, seeded_tiles, engine_session):
    login(create_client)
    resp = create_client.get("/coverage")
    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "FeatureCollection"
    expected = engine_session.execute(select(func.count()).select_from(Tile)).scalar_one()
    assert len(body["features"]) == expected  # DB-truth count (seeded: 50)
    f0 = body["features"][0]
    assert f0["geometry"]["type"] == "Polygon"
    assert set(f0["properties"]) == {"id", "captured_at"}


@pytest.mark.db
def test_coverage_requires_auth(create_client):
    assert create_client.get("/coverage").status_code == 401
