# Geo-RAG Earth Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a natural-language geospatial search demo over Sentinel-2 imagery of the Saudi Red Sea coast (Next.js + FastAPI + pgvector/PostGIS), live at `geo.sumbono.dev`, as a portfolio-quality demonstration of full-stack geospatial AI engineering.

**Architecture:** Three-part monorepo: `apps/web` (Next.js 15, public landing + login + JWT-gated dashboard with MapLibre/Three.js/D3), `apps/api` (FastAPI: JWT auth, vector + bbox search, telemetry, thumbs), `etl/` (offline: Earth Search STAC download → 512px chip extraction → RemoteCLIP embeddings → Postgres). One Postgres (PostGIS + pgvector) shared by API and ETL. Deployed as a Coolify compose stack behind the existing Traefik proxy.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, PyJWT, bcrypt, slowapi, pgvector, PostGIS, open_clip + PyTorch (CPU, lazy-loaded), Node 22, Next.js 15 (App Router), TypeScript, MapLibre GL JS, Three.js, D3, Vitest + React Testing Library, Playwright, pytest, GitHub Actions, Docker Compose, Coolify.

**Spec:** `PLAN.md` (repo root). The plan argues from the spec — executors read both.

## Global Constraints

- Python 3.12, Node 22 (exact floors; no other runtimes).
- All timestamps UTC (`timestamptz`); no server-side local-time math.
- JWT `sub` = `users.uuid`; tiles PK = uuid; telemetry PK = `(buoy_id, ts)`.
- Search `LIMIT` fixed at 12; telemetry query default 24 h window, max 5,000 points; telemetry ingest body cap 64 KB; auth rate limit 5/min/IP, other API routes 60/min/IP.
- Embedding = RemoteCLIP ViT-B/32, 512 dims, model input 224×224; pgvector operator `<=>` (cosine).
- Chip extraction: 512×512 px windows, 128 px stride, bbox from scene geotransform, SRID 4326.
- Basemap: ESRI World Imagery (default, attribution shown) + OSM streets toggle. No Mapbox, no tile API keys.
- Cookies: `access_token` (15 min) and `refresh_token` (7 d), both httpOnly, SameSite=Strict; `PUBLIC_ORIGIN=https://geo.sumbono.dev` in prod.
- No secrets in repo — `.env.example` only. Credentials read from `/home/bono/documents/cloudflare.txt` and `/home/bono/documents/coolify-api-token.txt` at deploy time only.
- API routes are defined WITHOUT the `/api` prefix (`/auth/token`, `/search/vector`, …); Next.js rewrites `/api/:path*` → `http://api:8000/:path*`. External surface is always `/api/...`.
- Torch/open_clip must be lazy-imported (inside encoder class only) so unit tests and CI run without ML deps (`requirements.txt` = core; `requirements-ml.txt` = torch/open_clip).
- Host: `geo.sumbono.dev`. Repo root: `/home/bono/portfolio/geo-rag-earth-dashboard` (worktree: `.claude/worktrees/parsed-wandering-hare`).

## Review Focus

Input classes / failure modes the spec implies but that no single happy-path task exercises — each is pinned to a task below:

1. **Earth Search S3 assets may be requester-pays** → Task 11 smoke-downloads exactly one scene and asserts a file > 1 MB lands on disk (catches auth/pays failure on day one of ETL).
2. **Refresh-token reuse after rotation** (stolen/ replayed cookie must be rejected, not silently accepted) → Task 5 test: consumed refresh token reuse → 401 + row revoked.
3. **Every protected route must reject unauthenticated calls** — not just the ones the author remembered → Task 4 parametrized authz sweep over the full route matrix.
4. **Encoder dimension drift** (model output must be 512 or pgvector insert corrupts) → Task 6 asserts `encode_text`/`encode_image` shapes end-to-end; Task 7 search test fails loudly on dim mismatch.
5. **Thumb path traversal** (`GET /api/thumbs/../../etc/passwd` must never read outside THUMBS_DIR) → Task 9 test with a malicious id → 404, never file contents.

---

## File Structure

```
geo-rag-earth-dashboard/
├── PLAN.md                                   # spec (exists)
├── README.md                                 # Task 24
├── docker-compose.yml                        # Task 1 (db) + Task 15 (web/api)
├── docker-compose.coolify.yml                # Task 25
├── .env.example                              # Task 1 (grown by later tasks)
├── .github/workflows/ci.yml                  # Task 22
├── deploy/
│   ├── db.Dockerfile                         # Task 1  (postgis + pgvector)
│   ├── initdb/01-extensions.sql              # Task 1
│   ├── cloudflare-dns.sh                     # Task 25
│   └── coolify-deploy.sh                     # Task 25
├── apps/api/
│   ├── requirements.txt / requirements-ml.txt / requirements-dev.txt
│   ├── app/
│   │   ├── main.py                           # Task 1  app factory
│   │   ├── config.py                         # Task 1  pydantic-settings
│   │   ├── db.py                             # Task 2  engine/session/Base
│   │   ├── models.py                         # Task 2  4 tables
│   │   ├── security.py                       # Task 3/4/5  hash, jwt, verify_jwt
│   │   ├── rate_limit.py                     # Task 3  slowapi limiter
│   │   ├── encoder.py                        # Task 6  Encoder protocol + RemoteCLIP + Fake
│   │   ├── routers/{health,auth,search,telemetry,thumbs}.py
│   │   └── deps.py                           # Task 4  get_settings/get_db/get_encoder
│   └── tests/
│       ├── conftest.py                       # Task 1/2 fixture DB + TestClient + shared fixtures
│       ├── helpers.py                        # Task 3 login() helper
│       ├── test_health.py                    # Task 1
│       ├── test_auth.py                      # Task 3/4/5
│       ├── test_search_vector.py             # Task 7
│       ├── test_search_bbox.py               # Task 8
│       ├── test_thumbs.py                    # Task 9
│       └── test_telemetry.py                 # Task 10
├── apps/web/
│   ├── next.config.ts                        # Task 15 rewrites
│   ├── app/{page,login,layout}.tsx + dashboard/*
│   ├── lib/{api.ts,auth.ts,types.ts}         # Task 15/16
│   ├── components/{Map,SearchBar,ResultsPanel,DetailPanel,ScoreBarChart,
│   │               TelemetryChart,View3D,EmptyState,AuthGuard}.tsx
│   ├── __tests__/*.test.tsx                  # Tasks 15–21
│   └── e2e/dashboard.spec.ts                 # Task 22
├── etl/
│   ├── requirements.txt                      # Task 11
│   ├── download_sentinel2.py                 # Task 11
│   ├── extract_chips.py                      # Task 12
│   ├── embed_remoteclip.py                   # Task 13
│   ├── seed_telemetry.py                     # Task 14
│   ├── make_fixture_dump.py                  # Task 14
│   └── tests/{make_fixture_tif.py, test_extract_chips.py}
├── fixtures/
│   └── seed.sql.gz                           # Task 14 (committed; restored by deploy/initdb/02-seed.sh)
└── docs/
    ├── superpowers/plans/2026-10-06-geo-rag-earth-dashboard.md  # this file
    ├── architecture.mmd                      # Task 24 (+ exported architecture.png)
    └── benchmarks.md                         # Task 23
```

**Milestone ↔ task map:** M1 = Tasks 1–2 · M2 = Tasks 11–14 · M3 = Tasks 3–10 · M4 = Tasks 15–19 · M5 = Tasks 20–23 · M6 = Tasks 24–25. (M3 tasks may run before M2; vector/bbox tests use synthetic fixture embeddings, never the real model.)

---

### Task 1: Repo skeleton, DB image, compose, health endpoint

**Files:**
- Create: `deploy/db.Dockerfile`, `deploy/initdb/01-extensions.sql`, `docker-compose.yml`, `.env.example`, `.gitignore`, `apps/api/requirements.txt`, `apps/api/requirements-ml.txt`, `apps/api/requirements-dev.txt`, `apps/api/app/__init__.py`, `apps/api/app/main.py`, `apps/api/app/config.py`, `apps/api/app/routers/__init__.py`, `apps/api/app/routers/health.py`, `apps/api/tests/__init__.py`, `apps/api/tests/conftest.py`, `apps/api/tests/test_health.py`
- Test: `apps/api/tests/test_health.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `create_app(settings: Settings) -> FastAPI` in `apps/api/app/main.py`; `Settings` (pydantic-settings) with fields `database_url, jwt_secret, refresh_secret, demo_user, demo_password, public_origin, thumbs_dir, encoder, rate_limit_enabled`; `GET /health` → `{"status":"ok"}`. Later tasks import `create_app` and `Settings`.

- [ ] **Step 1: Write failing health test**

```python
# apps/api/tests/test_health.py
from fastapi.testclient import TestClient

def test_health_returns_ok(create_client):
    client: TestClient = create_client
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

`conftest.py` (Task 1 version — later tasks extend it):

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pip install -r requirements.txt -r requirements-dev.txt && pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: app` / router not yet present.

Create `apps/api/pytest.ini` in this step (registers markers used by later tasks):

```ini
[pytest]
pythonpath = .
markers =
    db: needs a reachable Postgres (docker compose up -d db)
    ml: needs ML deps + downloads RemoteCLIP weights
    smoke: network test against Earth Search STAC
```

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/geo"
    jwt_secret: str
    refresh_secret: str
    demo_user: str = "demo"
    demo_password: str
    public_origin: str = "http://localhost:3000"
    thumbs_dir: str = "data/thumbs"
    encoder: str = "remoteclip"          # "remoteclip" | "fake"
    rate_limit_enabled: bool = True
```

```python
# apps/api/app/main.py
from fastapi import FastAPI
from app.config import Settings
from app.routers import health

def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Geo-RAG Earth Dashboard API")
    app.state.settings = settings
    app.include_router(health.router)
    return app
```

```python
# apps/api/app/routers/health.py
from fastapi import APIRouter
router = APIRouter(tags=["health"])

@router.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest -v`
Expected: PASS `test_health_returns_ok`

- [ ] **Step 5: DB image + compose, verify extensions**

```dockerfile
# deploy/db.Dockerfile
FROM postgis/postgis:16-3.4
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
```

```sql
-- deploy/initdb/01-extensions.sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
```

```yaml
# docker-compose.yml
services:
  db:
    build: { context: ./deploy, dockerfile: db.Dockerfile }
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: geo
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./deploy/initdb:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d geo"]
      interval: 5s
      retries: 10
volumes: { pgdata: {} }
```

`.env.example`: `JWT_SECRET=change-me`, `REFRESH_SECRET=change-me-too`, `DEMO_USER=demo`, `DEMO_PASSWORD=change-me`, `DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/geo`, `PUBLIC_ORIGIN=http://localhost:3000`, `ENCODER=remoteclip`, `RATE_LIMIT_ENABLED=true`.
`.gitignore`: `.env`, `data/`, `__pycache__/`, `.venv/`, `node_modules/`, `checkpoints/`.

Run: `docker compose up -d db && docker compose exec db psql -U postgres -d geo -c "SELECT extname FROM pg_extension ORDER BY extname;"`
Expected: rows `postgis` and `vector`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: repo skeleton, postgis+pgvector db, health endpoint (M1)"
```

---

### Task 2: SQLAlchemy models for all four tables

**Files:**
- Create: `apps/api/app/db.py`, `apps/api/app/models.py`
- Test: `apps/api/tests/test_models.py`

**Interfaces:**
- Consumes: Task 1 `Settings.database_url`.
- Produces: `Base`, `get_db()` dependency yielding `Session`; models `User(uuid, username, password_hash, created_at)`, `RefreshToken(uuid, user_uuid, token_hash, expires_at, used_at, revoked_at)`, `Tile(id, bbox, embedding, thumb_path, captured_at)`, `Telemetry(buoy_id, ts, value, unit)`. Tasks 3–10, 13–14 import these exact names. `embedding` column uses `pgvector.sqlalchemy.Vector(512)`; `bbox` uses `geoalchemy2.Geometry("POLYGON", srid=4326)`. Also produces `init_db(url: str) -> None` (idempotent create_all + extensions) called from `create_app` lifespan and Task 25.

- [ ] **Step 1: Write failing model test**

```python
# apps/api/tests/test_models.py
def test_tables_create_and_user_roundtrip(engine_session, settings):
    from app.models import User
    import uuid as uuid_mod
    s = engine_session
    u = User(id=uuid_mod.uuid4(), username="t-user", password_hash="x")
    s.add(u); s.commit()
    got = s.query(User).filter_by(username="t-user").one()
    assert got.id == u.id
```

`conftest.py` additions (requires `docker compose up -d db`; mark tests `@pytest.mark.db`):

```python
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

@pytest.fixture(scope="session")
def engine_session(settings):
    # Ensure the dedicated test database exists (never touch dev `geo`).
    root = sa.create_engine("postgresql+psycopg://postgres:postgres@localhost:5432/postgres")
    with root.connect() as conn:
        conn.execute(sa.text("COMMIT"))
        conn.execute(sa.text("CREATE DATABASE geo_test"))
    root.dispose()
    engine = sa.create_engine(settings.database_url)
    from app.db import Base
    import app.models  # register mappers
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    yield Session()
    Base.metadata.drop_all(engine)
    engine.dispose()
```

(`CREATE DATABASE` raises `42P04` if it already exists — catch and pass.)

Also produce `apps/api/app/init_db.py` (used by Task 25 for prod):

```python
from sqlalchemy import create_engine, text
from app.db import Base
import app.models  # noqa: F401

def init_db(url: str) -> None:
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    engine.dispose()
```

`create_app` (Task 1) gains a FastAPI `lifespan` hook calling `init_db(settings.database_url)` on startup so a fresh container self-initializes.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pytest tests/test_models.py -v`
Expected: FAIL `ModuleNotFoundError: app.models`

- [ ] **Step 3: Implement**

```python
# apps/api/app/db.py
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

class Base(DeclarativeBase): pass

def make_engine(url: str):
    return create_engine(url, pool_pre_ping=True)

def make_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
```

```python
# apps/api/app/models.py
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Float, Text, PrimaryKeyConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from geoalchemy2 import Geometry
from pgvector.sqlalchemy import Vector
from app.db import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    uuid: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class Tile(Base):
    __tablename__ = "tiles"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    bbox = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    embedding = mapped_column(Vector(512), nullable=False)
    thumb_path: Mapped[str] = mapped_column(String(512), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

class Telemetry(Base):
    __tablename__ = "telemetry"
    buoy_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(16), nullable=False)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pytest -v -m db`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: data model — users, refresh_tokens, tiles, telemetry (M3)"
```

---

### Task 3: Password hashing, login endpoint, rate limit

**Files:**
- Create: `apps/api/app/security.py`, `apps/api/app/rate_limit.py`, `apps/api/app/routers/auth.py`, `apps/api/app/deps.py`
- Test: `apps/api/tests/test_auth.py`

**Interfaces:**
- Consumes: Task 2 `User`, `get_db`.
- Produces: `hash_password(pw: str) -> str`, `verify_password(pw: str, h: str) -> bool`, `create_access_token(sub: str, settings) -> str`, `POST /auth/token` (form `username`,`password` → sets `access_token` + `refresh_token` httpOnly cookies, returns `{"token_type":"bearer"}`; 401 on bad creds; 429 when rate-limited), `seed_user_if_missing(settings, session) -> User`. Task 4 imports `create_access_token` and `verify_password`; Task 5 reuses `POST /auth/refresh`.

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_auth.py
def test_login_sets_cookies(create_client):
    r = create_client.post("/auth/token", data={"username": "demo", "password": "demo-pass-123"})
    assert r.status_code == 200
    assert "access_token" in r.cookies
    assert "refresh_token" in r.cookies

def test_login_bad_password_401(create_client):
    r = create_client.post("/auth/token", data={"username": "demo", "password": "wrong"})
    assert r.status_code == 401

def test_login_rate_limited(limited_client):
    for _ in range(5):
        assert limited_client.post("/auth/token", data={"username":"demo","password":"wrong"}).status_code == 401
    r = limited_client.post("/auth/token", data={"username":"demo","password":"wrong"})
    assert r.status_code == 429
```

Shared helpers — defined here (first consumer), reused by Tasks 4, 7, 9:

```python
# apps/api/tests/helpers.py
from fastapi.testclient import TestClient

def login(client: TestClient) -> None:
    """Log in as the seed user; subsequent requests carry the auth cookies."""
    r = client.post("/auth/token", data={"username": "demo", "password": "demo-pass-123"})
    assert r.status_code == 200, r.text
```

```python
# apps/api/tests/conftest.py — addition
import os
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
```

- [ ] **Step 2: Run to verify failure** — Run: `pytest tests/test_auth.py -v` → FAIL (no `/auth/token`)

- [ ] **Step 3: Implement**

`security.py`: bcrypt via `bcrypt.hashpw/pwcheck` (cost 12); `create_access_token(sub, settings)` = `jwt.encode({"sub": sub, "exp": now+15min}, settings.jwt_secret, algorithm="HS256")`; `seed_user_if_missing` upserts `settings.demo_user` with `hash_password(settings.demo_password)`.

`routers/auth.py`: `@router.post("/auth/token")` takes `OAuth2PasswordRequestForm`, loads user by username, `verify_password` or `HTTPException(401)`, creates refresh token via Task 5's helper (for now: opaque `secrets.token_urlsafe(32)` stored hashed in `refresh_tokens`), sets both cookies (`httponly=True, samesite="strict", secure=settings.public_origin.startswith("https")`, `max_age` 15 min / 7 d).

`rate_limit.py`: slowapi `Limiter(key_func=get_remote_address, enabled=settings.rate_limit_enabled)`; `@limiter.limit("5/minute")` on token + refresh, `"60/minute"` applied to search/telemetry routers in their tasks.

- [ ] **Step 4: Run to verify pass** — `pytest tests/test_auth.py -v` → all PASS (rate-limit test uses a fixture app with `RATE_LIMIT_ENABLED=true`)

- [ ] **Step 5: Commit** — `git commit -m "feat: login endpoint with JWT cookies and rate limiting"`

---

### Task 4: `verify_jwt` dependency + full authz sweep

**Files:**
- Modify: `apps/api/app/security.py`, `apps/api/app/routers/auth.py` (nothing else exposes data yet; sweep expands in later tasks)
- Test: `apps/api/tests/test_auth.py` (append)

**Interfaces:**
- Consumes: Task 3 `create_access_token`, Task 2 `User`, `helpers.login`.
- Produces: `verify_jwt` — exact FastAPI dependency signature:

```python
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer  # imported for OpenAPI docs only

def verify_jwt(
    request: Request,
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
) -> User:
    # read `access_token` cookie → jwt.decode(..., settings.jwt_secret, algorithms=["HS256"])
    # → load User by payload["sub"] as uuid → missing/expired/bad-sig/deleted → HTTPException(401)
```

All protected routes use `Depends(verify_jwt)`.

- [ ] **Step 1: Write failing tests**

```python
def test_protected_routes_reject_anonymous(create_client):
    routes = ["/search/vector", "/search/bbox", "/telemetry/query",
              "/telemetry/ingest", "/thumbs/00000000-0000-0000-0000-000000000000"]
    for path in routes:
        method = create_client.post if path in ("/search/vector", "/search/bbox", "/telemetry/ingest") else create_client.get
        r = method(path, json={} if method is create_client.post else None)
        assert r.status_code == 401, f"{path} not protected"

def test_verify_jwt_rejects_deleted_user(create_client, make_token_for_missing_user):
    client = create_client
    client.cookies.set("access_token", make_token_for_missing_user)  # valid sig, sub not in users
    r = client.get("/telemetry/query")
    assert r.status_code == 401
```

```python
# apps/api/tests/conftest.py — addition
import uuid
from datetime import datetime, timedelta, timezone
import jwt as pyjwt

@pytest.fixture()
def make_token_for_missing_user(settings) -> str:
    """A correctly signed JWT whose sub points at no users row."""
    return pyjwt.encode(
        {"sub": str(uuid.uuid4()), "exp": datetime.now(timezone.utc) + timedelta(minutes=15)},
        settings.jwt_secret, algorithm="HS256",
    )
```

- [ ] **Step 2: Run to verify failure** — routes currently 404/500 → FAIL

- [ ] **Step 3: Implement** `verify_jwt` as specified (cookie read → decode → user lookup → 401 on any failure with `{"detail": "Not authenticated"}`). Register the not-yet-existing protected routers as empty stubs in `create_app` **only if needed for the sweep to see them** — the sweep grows in Tasks 7–10 as routes appear (each task adds its path to the `routes` list).

- [ ] **Step 4: Run to verify pass** — `pytest tests/test_auth.py -v` → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: verify_jwt with user-existence check + authz sweep"`

---

### Task 5: Refresh token rotation + reuse detection

**Files:**
- Modify: `apps/api/app/routers/auth.py`, `apps/api/app/security.py`
- Test: `apps/api/tests/test_auth.py` (append)

**Interfaces:**
- Consumes: Task 3 cookie names, Task 2 `RefreshToken`.
- Produces: `POST /auth/refresh` — rotates: validates refresh cookie against `refresh_tokens.token_hash`, rejects if `used_at IS NOT NULL OR revoked_at IS NOT NULL` (**reuse → 401 and revokes the whole family row set for that token**), marks old used, issues new refresh + new access cookies.

- [ ] **Step 1: Write failing tests**

```python
def test_refresh_rotates_and_old_token_rejected(create_client):
    r = create_client.post("/auth/token", data={"username":"demo","password":"demo-pass-123"})
    old = r.cookies["refresh_token"]
    r2 = create_client.post("/auth/refresh")                 # rotates, sets new cookie
    assert r2.status_code == 200 and r2.cookies["refresh_token"] != old
    create_client.cookies.clear()
    create_client.cookies.set("refresh_token", old)          # replay
    assert create_client.post("/auth/refresh").status_code == 401
```

- [ ] **Step 2: Run to verify failure** → FAIL (`/auth/refresh` missing)

- [ ] **Step 3: Implement** per interface; `token_hash = hashlib.sha256(raw.encode()).hexdigest()`; new access token issued alongside.

- [ ] **Step 4: Run to verify pass** → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: refresh rotation with reuse revocation"`

---

### Task 6: Encoder abstraction (Fake + RemoteCLIP)

**Files:**
- Create: `apps/api/app/encoder.py`, `apps/api/requirements-ml.txt`
- Test: `apps/api/tests/test_encoder.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `class Encoder(Protocol): def encode_text(self, text: str) -> np.ndarray; def encode_image(self, arr: np.ndarray) -> np.ndarray` (both `float32`, shape `(512,)`); `FakeEncoder` (deterministic: seeded hash of input → 512-dim unit vector); `RemoteCLIPEncoder` (lazy-imports `torch`/`open_clip` inside `__init__`, weights `hf_hub_download("chendelong/RemoteCLIP", "RemoteCLIP-ViT-B-32.pt")`, resize to 224×224); `get_encoder(settings) -> Encoder` (`ENCODER=fake|remoteclip`). Consumed by Task 7 (`get_encoder` dependency) and Task 13 (imports `RemoteCLIPEncoder` directly).

- [ ] **Step 1: Write failing tests**

```python
import numpy as np

def test_fake_encoder_deterministic_unit_vector():
    from app.encoder import FakeEncoder
    e = FakeEncoder()
    a, b = e.encode_text("coral reef"), e.encode_text("coral reef")
    assert a.shape == (512,) and a.dtype == np.float32
    assert np.allclose(a, b)
    assert abs(np.linalg.norm(a) - 1.0) < 1e-5

def test_remoteclip_output_shape():           # @pytest.mark.ml (skipped without ML deps)
    from app.encoder import RemoteCLIPEncoder
    e = RemoteCLIPEncoder()
    v = e.encode_text("coastal water")
    assert v.shape == (512,)
```

- [ ] **Step 2: Run to verify failure** — `pytest tests/test_encoder.py -v` → FAIL (module missing; ML test SKIPPED without marker env)

- [ ] **Step 3: Implement** — FakeEncoder: `rng = np.random.default_rng(int(hashlib.sha256(text.encode()).hexdigest(),16) % 2**32)` → 512 draws → L2-normalize. RemoteCLIPEncoder as specified; **no top-level torch import anywhere else in `app/`**.

- [ ] **Step 4: Run to verify pass** — `pytest tests/test_encoder.py -v` → fake PASS; run `ML_TESTS=1 pytest -m ml` locally → remoteclip PASS (downloads ~350 MB checkpoint once).

- [ ] **Step 5: Commit** — `git commit -m "feat: encoder protocol with RemoteCLIP and deterministic fake"`

---

### Task 7: Vector search endpoint

**Files:**
- Create: `apps/api/app/routers/search.py`
- Test: `apps/api/tests/test_search_vector.py`

**Interfaces:**
- Consumes: Task 4 `verify_jwt`; Task 6 `get_encoder`; Task 2 `Tile`; limiter 60/min.
- Produces: `POST /search/vector` body `{"query": str}` → `200 {"results": [SearchResult]}` where `SearchResult = {id: uuid str, thumb_url: "/api/thumbs/{id}", bbox: GeoJSON Polygon coords, score: float (1 - cosine_distance), captured_at: ISO-8601}`; empty query → 422; no matches → `{"results": []}`. Task 17's `lib/api.ts` consumes exactly this shape.

- [ ] **Step 1: Write failing tests** (fixture DB seeded via `engine_session` with 50 deterministic `FakeEncoder`-encoded tiles; one tile encoded from "turquoise coral reef" to be rank-1 for that query)

```python
# apps/api/tests/conftest.py — addition
import numpy as np
from shapely.geometry import Polygon, mapping  # or build WKT strings directly
from app.encoder import FakeEncoder

@pytest.fixture()
def seeded_tiles(engine_session):
    """50 tiles with known FakeEncoder embeddings; 'coral' is rank-1 for its own text."""
    from app.models import Tile
    enc = FakeEncoder()
    out = {}
    for i in range(50):
        text = "turquoise coral reef" if i == 7 else f"generic coastal patch {i}"
        poly = Polygon([(35.0 + i * 0.01, 20.0), (35.01 + i * 0.01, 20.0),
                        (35.01 + i * 0.01, 20.01), (35.0 + i * 0.01, 20.01), (35.0 + i * 0.01, 20.0)])
        t = Tile(id=uuid.uuid4(), bbox=poly.wkt, embedding=enc.encode_text(text),
                 thumb_path=f"{uuid.uuid4()}.jpg",
                 captured_at=datetime(2025, 6, 1, tzinfo=timezone.utc))
        engine_session.add(t)
        if i == 7:
            out["coral"] = t
    engine_session.commit()
    return out
```

(Tests import `login` from `apps.api.tests.helpers`.)

```python
def test_vector_search_ranked_and_protected(create_client, seeded_tiles):
    assert create_client.post("/search/vector", json={"query": "x"}).status_code == 401
    login(create_client)
    r = create_client.post("/search/vector", json={"query": "turquoise coral reef"})
    assert r.status_code == 200
    results = r.json()["results"]
    assert 0 < len(results) <= 12
    assert results[0]["id"] == seeded_tiles["coral"]["id"]
    assert results[0]["score"] >= results[-1]["score"]
    assert results[0]["thumb_url"] == f"/api/thumbs/{results[0]['id']}"
```

- [ ] **Step 2: Run to verify failure** → FAIL (router missing; also add path to authz sweep list)

- [ ] **Step 3: Implement** — SQLAlchemy Core: `select(Tile.id, Tile.bbox, Tile.captured_at, (1 - Tile.embedding.cosine_distance(vec)).label("score")).order_by(Tile.embedding.cosine_distance(vec)).limit(12)`; `bbox` exported with `ST_AsGeoJSON` → dict. Dim mismatch (encoder 512 vs column 512) asserted once at encoder fetch: `assert vec.shape == (512,)`.

- [ ] **Step 4: Run to verify pass** → PASS; run full suite `pytest -v` — authz sweep now includes `/search/vector`.

- [ ] **Step 5: Commit** — `git commit -m "feat: vector search endpoint with cosine ranking"`

---

### Task 8: Bbox search endpoint

**Files:**
- Modify: `apps/api/app/routers/search.py`
- Test: `apps/api/tests/test_search_bbox.py`

**Interfaces:**
- Consumes: Task 7 patterns.
- Produces: `POST /search/bbox` body `{"bbox": [[w,s],[e,n]], "q": str | null, "limit": int=12}` → same `SearchResult` list. With `q`: vector search filtered by `ST_Intersects`; without: intersecting tiles ordered by `captured_at DESC`. Invalid bbox (w≥e, s≥n, out of ±180/±90) → 422. Consumed by Task 19.

- [ ] **Step 1: Write failing tests** — protected→401; valid bbox w/o `q` returns only intersecting tiles (assert every returned id ∈ expected set); with `q` ranks filtered set; invalid bbox → 422.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with `ST_Intersects(Tile.bbox, ST_MakeEnvelope(w, s, e, n, 4326))`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5:** `git commit -m "feat: PostGIS bbox search with optional vector filter"`

---

### Task 9: Thumbnail serving (traversal-safe)

**Files:**
- Create: `apps/api/app/routers/thumbs.py`
- Test: `apps/api/tests/test_thumbs.py`

**Interfaces:**
- Consumes: Task 4 `verify_jwt`; `Settings.thumbs_dir`.
- Produces: `GET /thumbs/{tile_id}` → `image/jpeg` bytes from `{THUMBS_DIR}/{tile_id}.jpg` (path resolved and verified to start with `THUMBS_DIR.resolve()`); missing file or non-uuid id → 404. `thumb_url` from Task 7 points here through the `/api` proxy.

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/conftest.py — addition
from pathlib import Path
from uuid import uuid4
import pytest

@pytest.fixture()
def tmp_thumbs(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "thumbs"; d.mkdir()
    monkeypatch.setenv("THUMBS_DIR", str(d))
    return d

def write_thumb(thumbs_dir: Path, data: bytes) -> str:
    tid = str(uuid4())
    (thumbs_dir / f"{tid}.jpg").write_bytes(data)
    return tid
```

```python
# apps/api/tests/test_thumbs.py
from uuid import uuid4
from app.tests.helpers import login   # or relative import per package layout

def test_thumb_requires_auth(create_client, tmp_thumbs):
    assert create_client.get(f"/thumbs/{uuid4()}").status_code == 401

def test_thumb_returns_jpeg_when_logged_in(create_client, tmp_thumbs):
    login(create_client); tid = write_thumb(tmp_thumbs, b"\xff\xd8fake")
    r = create_client.get(f"/thumbs/{tid}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"

def test_thumb_path_traversal_blocked(create_client, tmp_thumbs):
    login(create_client)
    assert create_client.get("/thumbs/..%2F..%2Fetc%2Fpasswd").status_code == 404
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (uuid parse + `os.path.realpath` containment check). **Step 4: Run → PASS.** **Step 5:** commit `feat: JWT-gated traversal-safe thumbnail serving"`.

---

### Task 10: Telemetry query + idempotent ingest

**Files:**
- Create: `apps/api/app/routers/telemetry.py`
- Test: `apps/api/tests/test_telemetry.py`

**Interfaces:**
- Consumes: Task 2 `Telemetry`; Task 4 `verify_jwt`.
- Produces: `POST /telemetry/ingest` `{"buoy_id": str (min_length=1), "ts": ISO-8601, "value": float, "unit": str}` → 200; empty `buoy_id` → 422; duplicate `(buoy_id, ts)` → 200 **no second row**; body > 64 KB → 413. `GET /telemetry/query?buoy_id=&hours=24` → `{"points": [{ts, value}], "count": n}` with `hours` default 24, clamped to max 5,000 points (newest kept). Consumed by Tasks 21 (`TelemetryChart`).

- [ ] **Step 1: Write failing tests**: authz 401 (sweep), idempotency (post same payload twice → `count == 1`), window clamp (`hours=100000` → 200, points ≤ 5000), oversize body → 413, empty-string `buoy_id` → 422.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (`INSERT ... ON CONFLICT DO NOTHING`). The 413 cap is **one global middleware** (decided — not a per-route check):

```python
@app.middleware("http")
async def body_size_limit(request: Request, call_next):
    if int(request.headers.get("content-length", 0)) > 65536:
        return JSONResponse({"detail": "payload too large"}, status_code=413)
    return await call_next(request)
```

- [ ] **Step 4: Run → PASS.** **Step 5:** commit `feat: telemetry query + idempotent ingest with caps"`.

*API milestone checkpoint (M3):* `docker compose up` + full `pytest -v` green; manual smoke: `curl -c jar -X POST -d 'username=demo&password=demo-pass-123' localhost:8000/auth/token` then `curl -b jar localhost:8000/search/vector -H 'content-type: application/json' -d '{"query":"water"}'`.

---

### Task 11: ETL download — Earth Search STAC (smoke test for Review Focus #1)

**Files:**
- Create: `etl/requirements.txt`, `etl/download_sentinel2.py`, `etl/tests/test_download.py`
- Modify: `.env.example` (add `ETL_CACHE_DIR=data/scenes`, `SAUDI_REDSEA_BBOX=34.5,16.5,40.0,29.0`)

**Interfaces:**
- Consumes: Earth Search STAC v1 (`https://earth-search.aws.element84.com/v1`), collection `sentinel-2-l2a`.
- Produces: CLI `python etl/download_sentinel2.py --bbox 34.5 16.5 40.0 29.0 --max-scenes 40 --cloud-cover 20` → scenes saved under `ETL_CACHE_DIR/{scene_id}/` (B04, B08, B03, B02 TIFFs + `scene.json` manifest incl. bbox + datetime); returns exit 0 and writes `ETL_CACHE_DIR/manifest.json` listing downloaded scenes. Task 12 reads this manifest.

- [ ] **Step 1: Write failing smoke test** (plus a deterministic unit test of the asset-URL policy — no network):

```python
import os, pytest

def test_pick_asset_prefers_https_over_s3():
    """Requester-pays lives on the S3 layer — HTTPS must win when both exist."""
    from download_sentinel2 import pick_asset_href
    assets = {
        "B04": {"href": "s3://sentinel-s2-l2a/x/B04.tif"},
        "B04_https": {"href": "https://sentinel-c1.example/x/B04.tif"},
    }
    assert pick_asset_href("B04", assets).startswith("https://")
    assert pick_asset_href("B04", {"B04": assets["B04"]}).startswith("s3://")  # s3 only when alone

@pytest.mark.smoke
def test_one_scene_downloads(tmp_path):
    from download_sentinel2 import download_one_scene
    scene = download_one_scene(bbox=(39.0, 21.0, 39.5, 21.5), out_dir=tmp_path)  # small Red Sea window
    assert scene["files"], "no assets downloaded"
    total = sum(os.path.getsize(p) for p in scene["files"])
    assert total > 1_000_000, f"assets too small ({total} B) — requester-pays or auth failure?"
    assert (tmp_path / "manifest.json").exists()
```

- [ ] **Step 2: Run to verify failure** — `cd etl && pip install -r requirements.txt && pytest tests/test_download.py -v -m smoke` → FAIL (module missing). *This is the task that catches the spec's #1 open risk — if the S3 layer demands payment/auth, this test fails here, before any other ETL work.*
- [ ] **Step 3: Implement** with `pystac-client` + `requests` streaming. **Asset-URL policy (prevention for the requester-pays risk):** for each STAC item, pick asset hrefs in this order — (1) `https://` hrefs (including `alternate.https` when the item uses the alternate-assets extension), (2) `s3://` only as last resort. If a fetch returns 403/`AccessDenied`, apply the **fallback ladder** in order, logging each switch:
  1. Retry remaining assets of the same scene over HTTPS if the first hit was `s3://`.
  2. Switch the catalog client to **Microsoft Planetary Computer** (`https://planetarycomputer.microsoft.com/api/stac/v1`, same `sentinel-2-l2a` collection; sign asset URLs via the public `planetarycomputer.microsoft.com/api/sas/v1/sign` endpoint — no account). The STAC-query/fetch interface is unchanged; only the catalog base URL + signing step differ.
  3. If both catalogs fail: run in degraded mode — skip downloads, leave the fixture dump as the demo data source, and record in `ETL_CACHE_DIR/manifest.json` that coverage is fixture-only (spec §7 honesty requirement). Never crash the demo path.

  On any unrecoverable fetch error, raise a clear message naming the ladder outcome — never a bare traceback.
- [ ] **Step 4: Run to verify pass** → PASS (network test; CI marks `smoke` as allowed-failure-with-annotation only if flaky — local run is authoritative).
- [ ] **Step 5:** commit `feat: Earth Search STAC scene downloader with one-scene smoke test"`.

---

### Task 12: Chip extractor (golden-file test)

**Files:**
- Create: `etl/extract_chips.py`, `etl/tests/test_extract_chips.py`, `etl/tests/make_fixture_tif.py` (generator script — **decided: no binary GeoTIFFs in git**; tests call the generator into `tmp_path`)
- Modify: `etl/requirements.txt` (+`rasterio`, `numpy`)

**Interfaces:**
- Consumes: Task 11 manifest + TIFFs.
- Produces: `extract_chips(scene_dir: Path, out_dir: Path | None = None, chip_size=512, stride=128) -> list[ChipRecord]` where `ChipRecord = {chip_id: uuid5(scene_id+row+col), chip_path, bbox: (w,s,e,n), scene_datetime}`; `out_dir` **defaults to `data/thumbs` — the same directory `Settings.thumbs_dir` serves from** (Task 9); writes `{out_dir}/{chip_id}.jpg` (RGB preview) + `{chip_id}.npy` (4-band float array, sibling cache dir) and `chips_manifest.jsonl`. Task 13 reads this. **Missing band in a scene → scene skipped with a WARNING log line** (spec §7), never a crash.

- [ ] **Step 1: Write failing golden test**: build 1024×1024 synthetic GeoTIFF with known transform in-test → extract with chip_size=512, stride=512 → expect 4 chips; assert chip 0 bbox ≈ transform-derived corners within 1e-6; assert deterministic `chip_id` stable across runs.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** with `rasterio.windows.Window` + `rasterio.windows.transform`. **Step 4: Run → PASS.** **Step 5:** commit `feat: 512px chip extractor with georeferenced golden test"`.

---

### Task 13: RemoteCLIP embedding job → pgvector

**Files:**
- Create: `etl/embed_remoteclip.py`, `etl/tests/test_embed_upsert.py`
- Modify: `etl/requirements.txt` (+`open_clip_torch`, `torch`, `huggingface_hub`)

**Interfaces:**
- Consumes: Task 12 `chips_manifest.jsonl`; Task 2 models (run against compose `db`); Task 6's `RemoteCLIPEncoder` (import from `apps/api` via `sys.path` insert or shared package — **decision: `etl/` inserts `apps/api` on `sys.path` and reuses `app.encoder`, single source of truth**).
- Produces: `python etl/embed_remoteclip.py --manifest path --batch 16` → idempotent upsert: `INSERT ... ON CONFLICT (id) DO UPDATE`; skips chips whose embedding is already non-null unless `--force`; prints progress `embedded N/M` and final count to `tiles`. **`thumb_path` stores only the relative filename** (`{chip_id}.jpg`), resolved against `Settings.thumbs_dir` at serve time — never an absolute path.

- [ ] **Step 1: Write failing test**: seed 3 fake chip `.npy` files + manifest → run embed with `ENCODER=fake` (tests never download the model) → assert 3 rows in `tiles`, embeddings L2-normalized, re-run inserts nothing new (idempotent).
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (batch loop, `ON CONFLICT DO NOTHING` on first pass check). **Step 4: Run → PASS**; locally once with real encoder: run against 10 chips, assert `pgv_dim(embedding)=512`.
- [ ] **Step 5:** commit `feat: idempotent RemoteCLIP embedding job"`.

---

### Task 14: Telemetry seeder + committed fixture dump

**Files:**
- Create: `etl/seed_telemetry.py`, `etl/make_fixture_dump.py`, `fixtures/seed.sql.gz`, `deploy/initdb/02-seed.sh`

**Interfaces:**
- Consumes: compose `db`.
- Produces:
  1. `python etl/seed_telemetry.py --buoys 5 --days 7 --freq 10min` → buoy ids `buoy-rs-1..5`, sinusoid + seeded noise, `ON CONFLICT DO NOTHING`; total ≈ 5040 rows (24 h default window keeps the query under the 5,000-point cap ✓).
  2. `python etl/make_fixture_dump.py --tiles 100` → runs the *chip + embed path* on 100 small real chips (or on-the-fly RemoteCLIP over a 10-chip mini set expanded with seeded jitter if a full ETL hasn't run), then `pg_dump --data-only --table=tiles --table=telemetry` → `fixtures/seed.sql.gz` (**committed to the repo**, ~1–3 MB).
  3. `deploy/initdb/02-seed.sh` (mounted via the existing `initdb` volume): `gunzip -c /fixtures/seed.sql.gz | psql -U postgres -d geo` — so a fresh `docker compose up` is search-ready with **zero network calls**.

This dump is what makes spec success criterion 4 ("clone → search in under 10 minutes") and the offline CI e2e (Task 22) true. The full ETL (Tasks 11–13) remains the optional path for regenerating/enriching data.

- [ ] **Step 1:** failing test — run seeder twice against test DB → row count unchanged; all `ts` are UTC (`ts.tzinfo is not None`); fixture dump restore test: load `seed.sql.gz` into a scratch DB → `SELECT count(*) FROM tiles` = 100.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** all three artifacts. **Step 4: Run → PASS**; verify `docker compose down -v && docker compose up -d` then `POST /search/vector {"query":"water"}` returns ≤ 12 results with no ETL run. **Step 5:** commit `feat: telemetry seeder and committed fixture seed dump"`.

*Milestone checkpoint (M2):* fresh `docker compose down -v && up` → run Tasks 11→14 in order → `SELECT count(*) FROM tiles;` > 500, `SELECT count(*) FROM telemetry;` ≈ 5040.

---

### Task 15: Next.js scaffold, landing page, `/api` proxy

**Files:**
- Create: `apps/web/package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `lib/types.ts`, `lib/api.ts`, `__tests__/landing.test.tsx`
- Modify: `docker-compose.yml` (+`web`, `api` services)

**Interfaces:**
- Consumes: Task 1 `Settings`-style env (`API_INTERNAL_URL=http://api:8000`).
- Produces: landing page at `/` (headline "Geo-RAG Earth Dashboard", one-paragraph pitch, CTA link `/login`, screenshots placeholder slots); `next.config.ts` rewrites `{"source":"/api/:path*", "destination":"${API_INTERNAL_URL}/:path*"}`; `lib/api.ts` exports `apiFetch<T>(path, init?): Promise<T>` always `credentials: "include"` and throws `ApiError(status)` on non-2xx; `lib/types.ts` exports `SearchResult {id: string; thumb_url: string; bbox: number[][][]; score: number; captured_at: string}` and `TelemetryPoint {ts: string; value: number}` — **the same field names as Tasks 7/10**.

- [ ] **Step 1: failing test** (`vitest`): render `app/page` → expect heading text and `href="/login"` link.
- [ ] **Step 2: Run → FAIL** — `cd apps/web && npx vitest run`.
- [ ] **Step 3: Implement** scaffold (`create-next-app --ts --app --no-src-dir` layout honored manually) + compose services:

```yaml
  api:
    build: { context: ./apps/api }
    environment: [DATABASE_URL=postgresql+psycopg://postgres:postgres@db:5432/geo,
                  JWT_SECRET, REFRESH_SECRET, DEMO_USER, DEMO_PASSWORD, ENCODER, RATE_LIMIT_ENABLED]
    depends_on: { db: { condition: service_healthy } }
  web:
    build: ./apps/web
    environment: [API_INTERNAL_URL=http://api:8000]
    ports: ["3000:3000"]
    depends_on: [api]
```

Dockerfiles (full content):

```dockerfile
# apps/api/Dockerfile
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt requirements-ml.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-ml.txt
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```dockerfile
# apps/web/Dockerfile
FROM node:22-slim AS build
WORKDIR /srv
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=build /srv/.next ./.next
COPY --from=build /srv/node_modules ./node_modules
COPY --from=build /srv/package.json ./
COPY --from=build /srv/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

(`app.main:app` implies the module-level `app = create_app(Settings())` entrypoint that uvicorn and tests share; `create_app` stays the injectable factory.)

- [ ] **Step 4: Run → PASS**; `docker compose up` → `curl localhost:3000` contains headline; `curl localhost:3000/api/health` → `{"status":"ok"}`.
- [ ] **Step 5:** commit `feat: Next.js scaffold with landing page and api proxy"`.

---

### Task 16: Login page + auth guard wiring

**Files:**
- Create: `app/login/page.tsx`, `lib/auth.ts`, `components/AuthGuard.tsx`, `app/dashboard/layout.tsx`, `__tests__/login.test.tsx`, `__tests__/authguard.test.tsx`

**Interfaces:**
- Consumes: Task 15 `apiFetch`; Task 3/5 cookie endpoints.
- Produces: `/login` form (username/password) → `POST /api/auth/token` (`Content-Type: application/x-www-form-urlencoded`) → `router.push("/dashboard")`; on 401 show inline error "Invalid credentials". `AuthGuard` wraps dashboard: on mount `GET /api/health`-independent check via a lightweight `GET /api/auth/me` (**add `GET /auth/me` → `{username}` to Task 3's router, protected by `verify_jwt` — one new route, 401 otherwise**); if 401 → `redirect("/login")`. `lib/auth.ts` exports `logout()` → `POST /api/auth/refresh`-style clear: `POST /api/auth/logout` (**add to Task 3 router: clears both cookies, revokes refresh row**).

- [ ] **Step 1: failing tests**: login page submits and pushes `/dashboard` on 200 (mock `fetch`); on 401 shows error text; `AuthGuard` redirects to `/login` when `/auth/me` 401. **Also extend Task 4's authz sweep list** with the two new routes: `GET /auth/me` and `POST /auth/logout` must both 401 when anonymous.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (client components; `"use client"` directives). **Step 4: Run → PASS** + curl round-trip through the proxy. **Step 5:** commit `feat: login flow and dashboard auth guard"`.

---

### Task 17: Dashboard map + search UI

**Files:**
- Create: `app/dashboard/page.tsx`, `components/Map.tsx`, `components/SearchBar.tsx`, `components/ResultsPanel.tsx`, `__tests__/search_ui.test.tsx`
- Modify: `apps/web/package.json` (+`maplibre-gl`)

**Interfaces:**
- Consumes: Task 15 `apiFetch` + `SearchResult`; Task 7/8 endpoints via `/api/search/vector`, `/api/search/bbox`.
- Produces: `components/Map.tsx` exports `<Map results={SearchResult[]} onPick={(id) => void} />` — client component initializing maplibre with ESRI World Imagery raster source (URL `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution `Esri`), OSM toggle via `setStyle`/layer visibility, markers at each result's bbox centroid colored by score; flies to first result on `results` change. `SearchBar` → calls vector search, lifts state to page. `ResultsPanel` lists `score` (2 dp) + `captured_at` (UTC slice 0..10) rows.

- [ ] **Step 1: failing tests** (RTL + mocked `maplibre-gl`): typing query + submit calls `/api/search/vector` once with `{query}`; rendered list shows returned scores; map mock receives `results` prop.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** — `"use client"` throughout; map created in `useEffect` with cleanup `map.remove()`; guard `typeof window !== "undefined"`. **Step 4: Run → PASS.** **Step 5:** commit `feat: MapLibre dashboard with search and results overlay"`.

---

### Task 18: Detail panel + D3 score chart + empty state

**Files:**
- Create: `components/DetailPanel.tsx`, `components/ScoreBarChart.tsx`, `components/EmptyState.tsx`, `__tests__/detail_panel.test.tsx`
- Modify: `apps/web/package.json` (+`d3`, `@types/d3`)

**Interfaces:**
- Consumes: Task 17 state; `SearchResult`.
- Produces: `<ScoreBarChart results={SearchResult[]} selectedId={string} />` — SVG horizontal bars, x = score (0..1), selected bar highlighted (accent color), labels = score values; `<DetailPanel tile={SearchResult} onClose={fn} />` showing thumb (`tile.thumb_url` — cookie auth makes `<img>` work), bbox text, `captured_at`, embedded `ScoreBarChart`; `<EmptyState onSuggest={(q: string) => void} />` with 3 clickable example queries ("turquoise coastal water", "desert near shoreline", "cloud patterns") shown when `results.length === 0 && searched`.

- [ ] **Step 1: failing tests**: given 3 results, chart renders 3 `<rect>` and selected has highlight class; empty search renders `EmptyState` with suggestions; clicking a suggestion triggers search.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.** **Step 5:** commit `feat: detail panel, D3 score chart, empty-state suggestions"`.

---

### Task 19: Two-click bbox draw search

**Files:**
- Create: `components/BboxDraw.tsx`, `__tests__/bbox_draw.test.tsx`
- Modify: `components/Map.tsx` (expose `onMapClick(lonLat)` and `setRectangle(bbox)` imperative handles via ref), `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: Task 8 endpoint; Map click events.
- Produces: toggle "Draw area" → first click sets corner A, second sets corner B → rectangle added as maplibre geojson layer → immediately `POST /api/search/bbox {bbox: [[w,s],[e,n]], q: currentQuery || null}` → results merge into `ResultsPanel` (union by id, max score wins). Esc cancels.

- [ ] **Step 1: failing tests**: two simulated clicks produce exactly one bbox request with ordered `[[w,s],[e,n]]` (w<e, s<n); response results replace panel; Esc sends nothing.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.** **Step 5:** commit `feat: two-click bbox draw with spatial+vector merged results"`.

---

### Task 20: Three.js 3D view

**Files:**
- Create: `components/View3D.tsx`, `__tests__/view3d.test.tsx`
- Modify: `apps/web/package.json` (+`three`, `@types/three`), `app/dashboard/page.tsx` (tab switcher Map | 3D | Telemetry)

**Interfaces:**
- Consumes: `SearchResult[]`.
- Produces: `<View3D results={SearchResult[]} />` — WebGL canvas; each result = a point at (lon→x, lat→z) scaled to a ~100-unit scene, height y = score×20, color ramp blue→yellow by score; OrbitControls-style drag implemented with pointer events (import `three/examples/jsm/controls/OrbitControls.js`); falls back to `<p>` "3D unavailable" if `WebGLRenderingContext` missing.

- [ ] **Step 1: failing tests**: renders canvas (jsdom stub `HTMLCanvasElement.prototype.getContext`), one mesh per result, fallback message when WebGL absent.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (client-only, `dynamic(..., {ssr:false})` if needed). **Step 4: Run → PASS.** **Step 5:** commit `feat: Three.js score-elevated point view"`.

---

### Task 21: Telemetry chart (D3)

**Files:**
- Create: `components/TelemetryChart.tsx`, `__tests__/telemetry_chart.test.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: Task 10 `GET /api/telemetry/query` → `{points: [{ts, value}]}`.
- Produces: `<TelemetryChart />` fetches on mount (5 buoys → one line each, or selector; default buoy `buoy-rs-1`), D3 line chart, UTC axis labels (`d3.utcFormat`), loading + empty states.

- [ ] **Step 1: failing tests**: mocked fetch returns 3 points → 1 `<path>` d non-empty; empty points → "No telemetry" text; fetch called with `buoy_id=buoy-rs-1`.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.** **Step 5:** commit `feat: D3 telemetry timeseries panel"`.

---

### Task 22: Playwright e2e + CI workflow

**Files:**
- Create: `apps/web/e2e/dashboard.spec.ts`, `apps/web/playwright.config.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: full stack via `docker compose up` (or Playwright webServer).
- Produces: one e2e: **login (demo creds) → type query → results appear → click first chip → detail panel visible → draw bbox (2 clicks) → telemetry tab shows chart**; CI job matrix: `api` (ruff, pytest, core only — no ML), `web` (eslint, tsc, vitest, next build), `e2e` (compose up + playwright), README badge `ci.yml`.

- [ ] **Step 1: failing e2e** — write spec as above with `page.goto("/login")`.
- [ ] **Step 2: Run → FAIL** — `npx playwright test`.
- [ ] **Step 3: green locally** — `docker compose down -v && docker compose up -d && npx playwright test`. **Decided: e2e runs against the committed fixture dump from Task 14** (no network, no full ETL) so CI is deterministic and fast; the full ETL is never a CI dependency.
- [ ] **Step 4: CI file** with the three jobs; push; verify Actions green.
- [ ] **Step 5:** commit `test: playwright e2e and GitHub Actions CI"`.

---

### Task 23: Benchmarks + architecture diagram source

**Files:**
- Create: `apps/api/scripts/bench.py`, `docs/benchmarks.md`, `docs/architecture.mmd`

**Interfaces:**
- Consumes: running stack + seeded DB.
- Produces: `python apps/api/scripts/bench.py --n 50` → measures (a) `encode_text` mean/p95 over 50 queries, (b) vector search SQL p95, (c) end-to-end `/search/vector` p95 via TestClient+real DB — writes a markdown table into `docs/benchmarks.md` with machine line "8 vCPU, 15 GB RAM, CPU-only (this Coolify host), 2026-10-xx"; asserts spec budget (<400/<50/<800 ms) — **prints PASS/FAIL per row but exits 0 regardless, numbers are honest reporting, not gates**. `docs/architecture.mmd` = mermaid `flowchart LR` mirroring spec §4 topology exactly (Traefik → web/api → db; etl → db).

- [ ] **Step 1:** write bench script + mermaid. **Step 2:** run against seeded local stack; paste real numbers into `docs/benchmarks.md`. **Step 3:** export mermaid → `docs/architecture.png` (`npx @mermaid-js/mermaid-cli -i docs/architecture.mmd -o docs/architecture.png`). **Step 4:** commit `docs: measured benchmarks and architecture diagram"`.

---

### Task 24: README, quickstart, demo credentials, GIF

**Files:**
- Create: `README.md`, `docs/demo.gif` (Playwright video → ffmpeg), `apps/web/e2e/recording.spec.ts`

**README sections (content, not placeholders):** headline + badges (CI); architecture image; 3-command quickstart (`git clone … && cp .env.example .env && docker compose up` — **works offline thanks to the Task 14 fixture dump auto-restore**); demo credentials line `demo` / value of `DEMO_PASSWORD` (dev default `demo-pass-123`); ETL rerun instructions (optional data enrichment); security notes (JWT flow summary + 401 example); benchmark table link.

- [ ] **Step 1:** record e2e with `video: "on"` → `ffmpeg -i video.webm -vf "fps=10,scale=800:-1" docs/demo.gif`.
- [ ] **Step 2:** write README per sections; verify quickstart on a clean clone in a temp dir (`docker compose up` from scratch, ≤10 min, no manual steps).
- [ ] **Step 3:** commit `docs: README with quickstart, demo creds, and demo gif"`.

---

### Task 25: Coolify deployment + DNS + live verification

**Files:**
- Create: `docker-compose.coolify.yml` (prod: no published db port; `restart: unless-stopped`; healthchecks; `PUBLIC_ORIGIN=https://geo.sumbono.dev`; secure cookies true), `deploy/cloudflare-dns.sh`, `deploy/coolify-deploy.sh`
- Modify: `README.md` (live badge), `PLAN.md` (§10 milestone status)

**Interfaces:**
- Consumes: `/home/bono/documents/cloudflare.txt` (format read defensively — expect `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`, or a single token + zone lookup by `sumbono.dev`; script prints which it found), `/home/bono/documents/coolify-api-token.txt` (token; base URL `http://localhost:8000`), Coolify API.
- Produces: `deploy/cloudflare-dns.sh` creates/updates A record `geo` → `$(curl -s ifconfig.me)` via Cloudflare API v4; `deploy/coolify-deploy.sh` creates project + docker-compose-github-or-path resource via Coolify API pointing at this repo + `docker-compose.coolify.yml`, waits for healthy.

- [ ] **Step 1: DNS** — run `deploy/cloudflare-dns.sh`; `dig +short geo.sumbono.dev` → machine IP.
- [ ] **Step 2: Deploy** — run `deploy/coolify-deploy.sh`; Traefik issues LE cert (watch `docker logs coolify-proxy`).
- [ ] **Step 3: Seed prod** — tables self-create via `init_db` in the api lifespan (Task 2); then restore the Task 14 fixture dump (`fixtures/seed.sql.gz`) for instant data, optionally followed by the full ETL (Tasks 11→13) for richer coverage.
- [ ] **Step 4: Live verification (the acceptance test for the whole spec §1 success criteria):**

```bash
curl -sI https://geo.sumbono.dev | head -1          # HTTP/2 200
curl -s https://geo.sumbono.dev/api/health           # {"status":"ok"}
# unauthenticated must 401:
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://geo.sumbono.dev/api/search/vector \
  -H 'content-type: application/json' -d '{"query":"water"}'   # 401
# login sets cookies, search returns ≤12 results — verify in browser + record p95s
```

- [ ] **Step 5:** paste live screenshots (landing, login, dashboard, 401) into README; update `PLAN.md` §10 status; final commit `feat: Coolify deployment to geo.sumbono.dev"`.

*No push to `main` without user confirmation; open a draft PR if a remote exists (per session rules).*

---

## Self-Review (executed by plan author; re-run after triple-pass revision)

1. **Spec coverage:** §1 success → Tasks 24–25 (+22 CI, +14 fixture dump for the <10-min quickstart); §2 decisions → Global Constraints; §3 layout → File Structure; §4 topology → Tasks 1/15/25; §5 data flow → Tasks 11–14 (Phase A), 6–10 (Phase B), latency budget → Task 23; §6 security → Tasks 3–5, 9, 16, 24; §7 error handling → Review Focus + tests in Tasks 5/9/10/11/12/18; §8 testing → every task TDD + Task 22; §9 deployment → Task 25; §10 milestones → task map; §11 risks → Task 11 (S3 pays), Task 23 (latency honesty), Task 25 (DNS), Review Focus. **No gaps found.**
2. **Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N"; every test helper referenced in code is defined in its first-consumer task (`login`, `limited_client`, `make_token_for_missing_user`, `seeded_tiles`, `tmp_thumbs`, `write_thumb`); no unresolved "X or Y" choices remain (413 middleware, fixture generator, thumb dir, fixture dump all decided).
3. **Type consistency:** `SearchResult` fields identical across Tasks 7/8/15/17/18/19/20; cookie names `access_token`/`refresh_token` across Tasks 3/5/16; `verify_jwt` single definition (Task 4) consumed by 7–10; `RemoteCLIPEncoder` reused by Task 13 via `sys.path` (explicitly decided); `create_app(settings)` + module-level `app` entrypoint stable from Task 1; `thumb_path` = relative filename consistently (Task 13 write ↔ Task 9 serve).
4. **Review Focus:** all five lines each have a pinning test: #1→Task 11 Step 1, #2→Task 5 Step 1, #3→Task 4 Step 1, #4→Task 6 Step 1 + Task 7 dim assert, #5→Task 9 Step 1.
5. **Triple-pass (plan-level) findings applied:** `geo_test` isolation (no clobbering dev data), fixture dump (quickstart + offline CI), `init_db` ownership (prod tables), empty-`buoy_id` 422, missing-band scene skip, pytest marker registration, authz sweep extension for `/auth/me` + `/auth/logout`, full Dockerfile content.
