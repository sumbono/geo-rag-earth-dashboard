from uuid import uuid4

import pytest

from tests.conftest import write_thumb
from tests.helpers import login


@pytest.mark.db
def test_thumb_requires_auth(create_client, tmp_thumbs):
    assert create_client.get(f"/thumbs/{uuid4()}").status_code == 401

@pytest.mark.db
def test_thumb_returns_jpeg_when_logged_in(create_client, tmp_thumbs):
    login(create_client); tid = write_thumb(tmp_thumbs, b"\xff\xd8fake")
    r = create_client.get(f"/thumbs/{tid}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"

@pytest.mark.db
def test_thumb_path_traversal_blocked(create_client, tmp_thumbs):
    login(create_client)
    assert create_client.get("/thumbs/..%2F..%2Fetc%2Fpasswd").status_code == 404


@pytest.mark.db
def test_thumb_false_color_variant(create_client, tmp_thumbs):
    """`?fc=1` serves the `{tile_id}_fc.jpg` sibling (Option B), same mime."""
    login(create_client)
    tid = str(uuid4())
    (tmp_thumbs / f"{tid}_fc.jpg").write_bytes(b"\xff\xd8fc")
    r = create_client.get(f"/thumbs/{tid}?fc=1")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert r.content == b"\xff\xd8fc"

@pytest.mark.db
def test_thumb_missing_file_and_non_uuid_404(create_client, tmp_thumbs):
    """Valid uuid, no file → 404; non-uuid single segment → 404 (never 422/500)."""
    login(create_client)
    assert create_client.get(f"/thumbs/{uuid4()}").status_code == 404
    assert create_client.get("/thumbs/not-a-uuid").status_code == 404
