# apps/api/tests/test_search_polygon.py
import pytest
import sqlalchemy as sa
from app.models import Tile

from tests.helpers import login  # repo convention: a FUNCTION, not a fixture

pytestmark = pytest.mark.db


@pytest.fixture()
def isolate_tiles(engine_session):
    """Wipe `tiles` before and after every test in this file.

    conftest's `seeded_tiles` APPENDS 50 rows per call (no wipe), so repeated
    seeded tests would accumulate duplicates: exact-count/set assertions here
    would break, and leftover coral rows (identical embedding = distance ties)
    would make test_search_vector's rank-1 assertion ambiguous — that file
    sorts alphabetically after this one. Verbatim copy of the fixture in
    test_search_bbox.py:28-43 (finding 10). Autouse resolves before
    explicitly requested same-scope fixtures, so the wipe precedes
    `seeded_tiles`.
    """
    engine_session.execute(sa.delete(Tile))
    engine_session.commit()
    yield
    engine_session.execute(sa.delete(Tile))
    engine_session.commit()


def _polygon(n_extra=0):
    # non-degenerate triangle + optional extras (CCW, non-collinear)
    pts = [[39.0, 21.0], [39.2, 21.0], [39.1, 21.15]]
    return pts[: 3 + n_extra]

def test_polygon_requires_auth(create_client):
    assert create_client.post("/search/polygon", json={"polygon": _polygon()}).status_code == 401

@pytest.mark.parametrize("polygon, reason", [
    ([[39.0, 21.0], [39.1, 21.0]], "fewer than 3 points"),
    ([[39.0, 21.0], [39.1, 21.0], [39.2, 21.0]], "collinear zero area"),
    ([[181.0, 21.0], [181.1, 21.0], [181.05, 21.1]], "out of bounds"),
])
def test_polygon_validation_422(create_client, polygon, reason):
    # Repo convention: helpers.py login(client) is a FUNCTION, not a fixture —
    # call it explicitly; there is no pytest fixture named `login`.
    login(create_client)
    assert create_client.post("/search/polygon", json={"polygon": polygon}).status_code == 422, reason

def test_too_many_points_422(create_client):
    login(create_client)
    pts = [[39.0 + i * 0.001, 21.0 + (i % 2) * 0.001] for i in range(65)]
    assert create_client.post("/search/polygon", json={"polygon": pts}).status_code == 422

def test_closed_ring_normalized_and_returns_only_intersects(create_client, isolate_tiles, seeded_tiles):
    login(create_client)
    ring = _polygon() + [_polygon()[0]]  # duplicate closing vertex
    r = create_client.post("/search/polygon", json={"polygon": ring})
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()["results"]}
    # seeded tiles span 35.0–35.5E / 20.0–20.01N; this triangle (39E/21N) intersects none
    assert ids == set()

def test_polygon_with_q_ranks_within_filter(create_client, isolate_tiles, seeded_tiles):
    login(create_client)
    # a box-shaped ring around the seeded band, with the coral query
    ring = [[35.0, 19.99], [35.6, 19.99], [35.6, 20.02], [35.0, 20.02]]
    r = create_client.post("/search/polygon", json={"polygon": ring, "q": "turquoise coral reef"})
    assert r.status_code == 200
    results = r.json()["results"]
    assert 0 < len(results) <= 12
    # seeded_tiles is a dict {coral: Tile, ...} — index it, never iterate rows off it
    assert results[0]["id"] == str(seeded_tiles["coral"].id)
    scores = [row["score"] for row in results]
    assert scores == sorted(scores, reverse=True)

def test_non_point_entries_422(create_client):
    login(create_client)
    bad_shape = {"polygon": [[39.0, 21.0], [39.1, 21.0], "not-a-point"]}
    assert create_client.post("/search/polygon", json=bad_shape).status_code == 422

def test_self_intersecting_bowtie_422(create_client):
    # Asymmetric bow-tie (hourglass): the two diagonals cross, so the ring is
    # self-intersecting. Shoelace area is non-zero (area=5.0 — passes the
    # zero-area check), but GEOS/ST_IsValid rejects it — must be a 422 that
    # names self-intersection, never a 200, a 500, or the zero-area sibling.
    login(create_client)
    bowtie = [[39.0, 21.0], [44.0, 23.0], [44.0, 21.0], [39.0, 25.0]]
    r = create_client.post("/search/polygon", json={"polygon": bowtie})
    assert r.status_code == 422
    detail = str(r.json().get("detail", "")).lower()
    assert "self-intersect" in detail, detail
