import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import jwt as pyjwt
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("JWT_SECRET", "test-jwt-secret-0123456789abcdef0123456789")  # >=32 bytes: PyJWT warns on short HMAC keys
os.environ.setdefault("REFRESH_SECRET", "test-refresh-secret")
os.environ.setdefault("DEMO_USER", "demo")
os.environ.setdefault("DEMO_PASSWORD", "demo-pass-123")
os.environ.setdefault("ENCODER", "fake")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/geo_test")
# Tests use the dedicated `geo_test` database — NEVER the dev/prod `geo` db.

# Imported after the env defaults above (deliberate late import — E402 by
# design; a plain comment because ruff's default set does not enable E402).
from app.encoder import FakeEncoder


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

@pytest.fixture()
def limited_client(settings):
    """App instance with rate limiting ON (the session default is off)."""
    os.environ["RATE_LIMIT_ENABLED"] = "true"
    from app.config import Settings
    from app.main import create_app
    s = Settings()
    with TestClient(create_app(s)) as c:
        yield c
    os.environ["RATE_LIMIT_ENABLED"] = "false"

@pytest.fixture()
def make_token_for_missing_user(settings) -> str:
    """A correctly signed JWT whose sub points at no users row."""
    return pyjwt.encode(
        {"sub": str(uuid.uuid4()), "exp": datetime.now(timezone.utc) + timedelta(minutes=15)},
        settings.jwt_secret, algorithm="HS256",
    )

def _create_geo_test() -> None:
    """Create the dedicated test database (never touch dev `geo`).

    `CREATE DATABASE` raises 42P04 if it already exists — catch and pass.
    AUTOCOMMIT is required: under psycopg3 a plain connection is already inside
    a transaction block, which PostgreSQL rejects for CREATE DATABASE (an
    `execute("COMMIT")` workaround does not survive SQLAlchemy 2 + psycopg3).
    """
    root = sa.create_engine(
        "postgresql+psycopg://postgres:postgres@localhost:5432/postgres",
        isolation_level="AUTOCOMMIT",
    )
    with root.connect() as conn:
        try:
            conn.execute(sa.text("CREATE DATABASE geo_test"))
        except sa.exc.DBAPIError as e:
            if getattr(e.orig, "sqlstate", None) != "42P04":
                raise
    root.dispose()

@pytest.fixture(scope="session", autouse=True)
def geo_test_ready(settings):
    """Session-start readiness: geo_test exists with postgis+vector before any
    app lifespan (init_db) or model test touches it.

    Extensions are required because CREATE DATABASE clones template1, which has
    no extensions — the initdb SQL only ran against the dev `geo` database.
    """
    assert "geo_test" in settings.database_url, f"tests must target geo_test, got {settings.database_url}"
    _create_geo_test()
    engine = sa.create_engine(settings.database_url)
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS postgis"))
        conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
    engine.dispose()

@pytest.fixture(scope="session")
def engine_session(settings):
    # Ensure the dedicated test database exists (never touch dev `geo`).
    _create_geo_test()
    engine = sa.create_engine(settings.database_url)
    import app.models  # noqa: F401 — registers mappers (side-effect import)
    from app.db import Base
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = Session()
    yield session
    # Close BEFORE drop_all: the test's last SELECT leaves an open transaction,
    # and drop_all from another connection would block on its locks forever.
    session.close()
    Base.metadata.drop_all(engine)
    engine.dispose()

@pytest.fixture()
def seeded_tiles(engine_session):
    """50 tiles with known FakeEncoder embeddings; 'coral' is rank-1 for its own text."""
    from app.models import Tile
    enc = FakeEncoder()
    out = {}
    for i in range(50):
        text = "turquoise coral reef" if i == 7 else f"generic coastal patch {i}"
        # WKT built directly (brief's sanctioned alternative to shapely, which
        # is not a dependency of this repo).
        x0, x1 = 35.0 + i * 0.01, 35.01 + i * 0.01
        wkt = f"POLYGON(({x0} 20.0, {x1} 20.0, {x1} 20.01, {x0} 20.01, {x0} 20.0))"
        t = Tile(id=uuid.uuid4(), bbox=wkt, embedding=enc.encode_text(text),
                 thumb_path=f"{uuid.uuid4()}.jpg",
                 captured_at=datetime(2025, 6, 1, tzinfo=timezone.utc))
        engine_session.add(t)
        if i == 7:
            out["coral"] = t
    engine_session.commit()
    return out


@pytest.fixture()
def tmp_thumbs(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "thumbs"; d.mkdir()
    monkeypatch.setenv("THUMBS_DIR", str(d))
    return d

def write_thumb(thumbs_dir: Path, data: bytes) -> str:
    tid = str(uuid4())
    (thumbs_dir / f"{tid}.jpg").write_bytes(data)
    return tid
