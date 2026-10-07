import pytest
import sqlalchemy as sa
from app.models import Tile

from tests.helpers import login


@pytest.mark.db
def test_vector_search_ranked_and_protected(create_client, seeded_tiles):
    assert create_client.post("/search/vector", json={"query": "x"}).status_code == 401
    login(create_client)
    r = create_client.post("/search/vector", json={"query": "turquoise coral reef"})
    assert r.status_code == 200
    results = r.json()["results"]
    assert 0 < len(results) <= 12
    # `seeded_tiles["coral"]` is the Tile ORM object (fixture is verbatim from
    # the brief); its id is a UUID, the response id a uuid str.
    assert results[0]["id"] == str(seeded_tiles["coral"].id)
    assert results[0]["score"] >= results[-1]["score"]
    assert results[0]["thumb_url"] == f"/api/thumbs/{results[0]['id']}"


@pytest.mark.db
def test_vector_search_empty_query_422(create_client):
    login(create_client)
    r = create_client.post("/search/vector", json={"query": ""})
    assert r.status_code == 422


@pytest.mark.db
def test_vector_search_no_matches_returns_empty_list(create_client, engine_session):
    # Runs after the ranked test in file order and clears the tiles table, so
    # the no-matches contract is observed against an empty corpus.
    login(create_client)
    engine_session.execute(sa.delete(Tile))
    engine_session.commit()
    r = create_client.post("/search/vector", json={"query": "no tiles exist here"})
    assert r.status_code == 200
    assert r.json() == {"results": []}
