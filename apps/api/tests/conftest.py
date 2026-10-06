import os
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("REFRESH_SECRET", "test-refresh-secret")
os.environ.setdefault("DEMO_USER", "demo")
os.environ.setdefault("DEMO_PASSWORD", "demo-pass-123")
os.environ.setdefault("ENCODER", "fake")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/geo_test")
# Tests use the dedicated `geo_test` database — NEVER the dev/prod `geo` db.

@pytest.fixture(scope="session")
def settings():
    from app.config import Settings
    return Settings()

@pytest.fixture()
def create_client(settings):
    from app.main import create_app
    app = create_app(settings)
    with TestClient(app) as c:
        yield c
