"""Task 8: POST /search/bbox — PostGIS envelope filter, optional vector rank.

Fixture geometry (conftest::seeded_tiles): tile i spans lon
[35.0 + i*0.01, 35.01 + i*0.01] x lat [20.0, 20.01] for i in 0..49; tile 7
("coral") is rank-1 for "turquoise coral reef". Every envelope edge below sits
strictly between tile edges, so boundary touch never decides a hit — the Python
ground truth and ST_Intersects must agree exactly.
"""
import json
import uuid
from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy import func, select

from app.encoder import FakeEncoder
from app.models import Tile
from tests.helpers import login

BBOX_TILES_0_9 = [[34.99, 19.99], [35.095, 20.02]]      # 10 tiles, coral (i=7) inside
BBOX_TILES_20_29 = [[35.205, 19.99], [35.2999, 20.02]]  # 10 tiles, coral outside
BBOX_ALL = [[34.99, 19.99], [35.505, 20.02]]            # all 50 tiles
BBOX_NONE = [[0.0, 0.0], [1.0, 1.0]]                    # no tiles at all


@pytest.fixture(autouse=True)
def isolate_tiles(engine_session):
    """Wipe `tiles` before and after every test in this file.

    conftest's `seeded_tiles` APPENDS 50 rows per call (no wipe), so repeated
    seeded tests would accumulate duplicates: exact-count/set assertions here
    would break, and leftover coral rows (identical embedding = distance ties)
    would make test_search_vector's rank-1 assertion ambiguous — that file
    sorts alphabetically after this one. Autouse resolves before explicitly
    requested same-scope fixtures, so the wipe precedes `seeded_tiles`.
    """
    engine_session.execute(sa.delete(Tile))
    engine_session.commit()
    yield
    engine_session.execute(sa.delete(Tile))
    engine_session.commit()


def _expected_ids(engine_session, bbox) -> set[str]:
    """Expected tile ids, computed in Python from the stored GeoJSON rings.

    Deliberately not ST_Intersects: the test must not mirror the implementation
    it verifies. Strict overlap (touch excluded) agrees with ST_Intersects for
    these boxes because no envelope edge lands on a tile edge.
    """
    (w, s), (e, n) = bbox
    ids = set()
    stmt = select(Tile.id, func.ST_AsGeoJSON(Tile.bbox).label("bbox_json"))
    for row in engine_session.execute(stmt):
        ring = json.loads(row.bbox_json)["coordinates"][0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        if w < max(xs) and e > min(xs) and s < max(ys) and n > min(ys):
            ids.add(str(row.id))
    return ids


@pytest.mark.db
def test_bbox_search_requires_auth(create_client):
    r = create_client.post("/search/bbox", json={"bbox": BBOX_TILES_0_9})
    assert r.status_code == 401


@pytest.mark.db
def test_bbox_without_q_returns_only_intersecting(create_client, seeded_tiles, engine_session):
    login(create_client)
    expected = _expected_ids(engine_session, BBOX_TILES_0_9)
    assert len(expected) == 10  # fixture contract: exactly tiles 0..9 overlap
    assert str(seeded_tiles["coral"].id) in expected
    r = create_client.post("/search/bbox", json={"bbox": BBOX_TILES_0_9})
    assert r.status_code == 200
    results = r.json()["results"]
    ids = {row["id"] for row in results}
    # == asserts both brief directions: every returned id is in the expected
    # set (no false positives) AND none is missing (no false negatives).
    assert ids == expected
    for row in results:
        assert row["thumb_url"] == f"/api/thumbs/{row['id']}"
        assert isinstance(row["score"], float)
        assert isinstance(row["bbox"][0][0][0], float)  # GeoJSON number[][][]
        assert row["captured_at"]  # ISO-8601, same SearchResult shape as Task 7


@pytest.mark.db
def test_bbox_with_q_ranks_only_filtered_tiles(create_client, seeded_tiles, engine_session):
    login(create_client)
    expected = _expected_ids(engine_session, BBOX_TILES_0_9)
    r = create_client.post(
        "/search/bbox", json={"bbox": BBOX_TILES_0_9, "q": "turquoise coral reef"}
    )
    assert r.status_code == 200
    results = r.json()["results"]
    assert {row["id"] for row in results} == expected  # filtered by ST_Intersects
    assert results[0]["id"] == str(seeded_tiles["coral"].id)  # ranked by cosine distance
    scores = [row["score"] for row in results]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.db
def test_bbox_with_q_excludes_tiles_outside_bbox(create_client, seeded_tiles, engine_session):
    login(create_client)
    expected = _expected_ids(engine_session, BBOX_TILES_20_29)
    assert str(seeded_tiles["coral"].id) not in expected  # coral sits in tiles 0..9
    r = create_client.post(
        "/search/bbox", json={"bbox": BBOX_TILES_20_29, "q": "turquoise coral reef"}
    )
    assert r.status_code == 200
    results = r.json()["results"]
    ids = {row["id"] for row in results}
    assert ids == expected
    assert str(seeded_tiles["coral"].id) not in ids  # filter beats global rank-1
    scores = [row["score"] for row in results]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.db
@pytest.mark.parametrize(
    "payload",
    [
        # w >= e
        {"bbox": [[35.1, 20.0], [35.0, 20.02]]},
        {"bbox": [[35.0, 20.0], [35.0, 20.02]]},
        # s >= n
        {"bbox": [[35.0, 20.02], [35.1, 20.0]]},
        {"bbox": [[35.0, 20.0], [35.1, 20.0]]},
        # outside +/-180 longitude
        {"bbox": [[-180.5, 0.0], [10.0, 10.0]]},
        {"bbox": [[-10.0, 0.0], [180.5, 10.0]]},
        # outside +/-90 latitude
        {"bbox": [[0.0, -90.5], [10.0, 10.0]]},
        {"bbox": [[0.0, 0.0], [10.0, 90.5]]},
        # structural: missing or malformed corners
        {},
        {"bbox": [[35.0, 20.0]]},
        {"bbox": [[35.0, 20.0], [35.1]]},
    ],
)
def test_bbox_invalid_request_422(create_client, payload):
    login(create_client)
    assert create_client.post("/search/bbox", json=payload).status_code == 422


@pytest.mark.db
def test_bbox_limit_clamped_to_12(create_client, seeded_tiles):
    login(create_client)
    # Default limit over 50 intersecting tiles.
    r = create_client.post("/search/bbox", json={"bbox": BBOX_ALL})
    assert r.status_code == 200
    assert len(r.json()["results"]) == 12
    # Global Constraint: LIMIT 12 — a larger input clamps, never 422s.
    r = create_client.post("/search/bbox", json={"bbox": BBOX_ALL, "limit": 50})
    assert r.status_code == 200
    assert len(r.json()["results"]) == 12
    # A smaller explicit limit is honored as-is.
    r = create_client.post("/search/bbox", json={"bbox": BBOX_ALL, "limit": 3})
    assert r.status_code == 200
    assert len(r.json()["results"]) == 3


@pytest.mark.db
def test_bbox_no_tiles_in_region_returns_empty(create_client, seeded_tiles):
    login(create_client)
    r = create_client.post("/search/bbox", json={"bbox": BBOX_NONE})
    assert r.status_code == 200
    assert r.json() == {"results": []}


@pytest.mark.db
def test_bbox_without_q_orders_by_captured_at_desc(create_client, seeded_tiles, engine_session):
    # Fixture tiles all share captured_at, so a strictly-newer tile inside the
    # box must surface first; relative order among the ties is not asserted.
    # The `isolate_tiles` teardown drops this temporary tile afterwards.
    late = Tile(
        id=uuid.uuid4(),
        bbox="POLYGON((35.05 20.0, 35.06 20.0, 35.06 20.01, 35.05 20.01, 35.05 20.0))",
        embedding=FakeEncoder().encode_text("late arrival"),
        thumb_path=f"{uuid.uuid4()}.jpg",
        captured_at=datetime(2025, 7, 1, tzinfo=timezone.utc),
    )
    engine_session.add(late)
    engine_session.commit()
    login(create_client)
    r = create_client.post("/search/bbox", json={"bbox": BBOX_TILES_0_9})
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 11  # 10 fixture tiles + the late one
    assert results[0]["id"] == str(late.id)
    assert results[0]["captured_at"] == "2025-07-01T00:00:00Z"
