from fastapi.testclient import TestClient


def test_health_returns_ok(create_client):
    client: TestClient = create_client
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
