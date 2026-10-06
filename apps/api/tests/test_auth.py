import pytest

from tests.helpers import login


@pytest.mark.db
def test_login_sets_cookies(create_client):
    r = create_client.post("/auth/token", data={"username": "demo", "password": "demo-pass-123"})
    assert r.status_code == 200
    assert "access_token" in r.cookies
    assert "refresh_token" in r.cookies


@pytest.mark.db
def test_login_bad_password_401(create_client):
    r = create_client.post("/auth/token", data={"username": "demo", "password": "wrong"})
    assert r.status_code == 401


@pytest.mark.db
def test_login_unknown_user_401(create_client):
    r = create_client.post("/auth/token", data={"username": "ghost", "password": "whatever"})
    assert r.status_code == 401
    assert r.json() == {"detail": "Incorrect username or password"}


@pytest.mark.db
def test_login_rate_limited(limited_client):
    for _ in range(5):
        assert limited_client.post("/auth/token", data={"username":"demo","password":"wrong"}).status_code == 401
    r = limited_client.post("/auth/token", data={"username":"demo","password":"wrong"})
    assert r.status_code == 429


@pytest.mark.db
def test_protected_routes_reject_anonymous(create_client):
    routes = ["/search/vector", "/search/bbox", "/telemetry/query",
              "/telemetry/ingest", "/thumbs/00000000-0000-0000-0000-000000000000"]
    for path in routes:
        # Dispatch on the path set: httpx's get() has no json kwarg (json=None
        # would TypeError) and bound-method identity (`m is obj.post`) is never
        # stable — so POSTs send an empty JSON body, GETs send none.
        is_post = path in ("/search/vector", "/search/bbox", "/telemetry/ingest")
        method = create_client.post if is_post else create_client.get
        r = method(path, json={}) if is_post else method(path)
        assert r.status_code == 401, f"{path} not protected"


@pytest.mark.db
def test_verify_jwt_rejects_deleted_user(create_client, make_token_for_missing_user):
    client = create_client
    client.cookies.set("access_token", make_token_for_missing_user)  # valid sig, sub not in users
    r = client.get("/telemetry/query")
    assert r.status_code == 401


@pytest.mark.db
def test_verify_jwt_accepts_valid_session(create_client):
    """Counterpart to the 401 cases: a real login must reach a protected route."""
    login(create_client)
    r = create_client.get("/telemetry/query")
    assert r.status_code == 200
    assert r.json() == {"stub": True}
