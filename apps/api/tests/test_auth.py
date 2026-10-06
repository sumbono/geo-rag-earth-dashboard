import pytest


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
