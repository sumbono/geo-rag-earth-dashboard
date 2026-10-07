from fastapi.testclient import TestClient


def login(client: TestClient) -> None:
    """Log in as the seed user; subsequent requests carry the auth cookies."""
    r = client.post("/auth/token", data={"username": "demo", "password": "demo-pass-123"})
    assert r.status_code == 200, r.text
