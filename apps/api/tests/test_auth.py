import hashlib

import pytest
from app.models import RefreshToken
from sqlalchemy import select

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
    # Plan matrix: every route except /auth/token and /auth/refresh is JWT-gated
    # — /auth/me and /auth/logout included (Task 16).
    routes = ["/search/vector", "/search/bbox", "/telemetry/query",
              "/telemetry/ingest", "/thumbs/00000000-0000-0000-0000-000000000000",
              "/auth/me", "/auth/logout"]
    for path in routes:
        # Dispatch on the path set: httpx's get() has no json kwarg (json=None
        # would TypeError) and bound-method identity (`m is obj.post`) is never
        # stable — so POSTs send an empty JSON body, GETs send none.
        is_post = path in ("/search/vector", "/search/bbox", "/telemetry/ingest",
                           "/auth/logout")
        method = create_client.post if is_post else create_client.get
        r = method(path, json={}) if is_post else method(path)
        assert r.status_code == 401, f"{path} not protected"


@pytest.mark.db
def test_me_returns_logged_in_username(create_client):
    assert create_client.get("/auth/me").status_code == 401  # anonymous first
    login(create_client)
    r = create_client.get("/auth/me")
    assert r.status_code == 200
    assert r.json() == {"username": "demo"}


@pytest.mark.db
def test_logout_clears_cookies_and_revokes_refresh(create_client, engine_session):
    r = create_client.post("/auth/token", data={"username": "demo", "password": "demo-pass-123"})
    assert r.status_code == 200
    raw = r.cookies["refresh_token"]

    r = create_client.post("/auth/logout")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    # Both cookies deleted (Set-Cookie expiry processed into the client jar).
    assert create_client.cookies.get("access_token") is None
    assert create_client.cookies.get("refresh_token") is None

    # The presented refresh row is revoked, not merely hidden by cookie clear.
    revoked_at = engine_session.scalar(
        select(RefreshToken.revoked_at).where(
            RefreshToken.token_hash == hashlib.sha256(raw.encode()).hexdigest()
        )
    )
    assert revoked_at is not None

    # Re-presenting the dead token cannot mint a new session (reuse → 401).
    create_client.cookies.set("refresh_token", raw)
    assert create_client.post("/auth/refresh").status_code == 401


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
    assert r.status_code == 200  # durable auth contract; shape is Task 10's


@pytest.mark.db
def test_refresh_rotates_and_old_token_rejected(create_client, engine_session):
    r = create_client.post("/auth/token", data={"username":"demo","password":"demo-pass-123"})
    old = r.cookies["refresh_token"]
    r2 = create_client.post("/auth/refresh")                 # rotates, sets new cookie
    assert r2.status_code == 200 and r2.cookies["refresh_token"] != old
    current = r2.cookies["refresh_token"]
    create_client.cookies.clear()
    create_client.cookies.set("refresh_token", old)          # replay
    assert create_client.post("/auth/refresh").status_code == 401
    # Ruling R10: reuse revokes the WHOLE family — the still-current token
    # minted by the rotation must be dead too, not just the replayed row.
    current_revoked = engine_session.scalar(
        select(RefreshToken.revoked_at).where(
            RefreshToken.token_hash == hashlib.sha256(current.encode()).hexdigest()
        )
    )
    assert current_revoked is not None, "family revocation must reach the current token"
