# PLAN.md — Geo-RAG Earth Dashboard

**Design spec** · 2026-10-06 · Status: *revised after triple-pass verification; awaiting go/no-go*
**Author:** Sumbono (with Claude) · **Path:** Architectural (spec stage)

---

## 1. Purpose & Context

A bounded-region geospatial search engine that answers natural-language queries
against Sentinel-2 satellite imagery of the Saudi Arabian Red Sea coast with
sub-second latency, showcased as a deployed, runnable portfolio project.

**Primary goal:** a portfolio-quality demonstration of full-stack geospatial
AI engineering: modern TypeScript/React frontend, demonstrable JWT security,
2D/3D scientific visualization, and a Python/FastAPI + pgvector/PostGIS
backend — deployed and runnable, not just a code dump.

**Success criteria:**

1. Live at `geo.sumbono.dev` on this machine (Coolify + Traefik), publicly reachable.
2. The full stack is demonstrable in the repo: React/Next.js + TypeScript,
   JWT auth (login page + 401s), MapLibre map UI, Three.js 3D view, D3 charts,
   FastAPI backend, PostgreSQL/pgvector/PostGIS, Docker Compose, GitHub
   Actions CI, benchmark numbers.
3. Domain authenticity: real Red Sea Sentinel-2 imagery, GIS/bbox search,
   simulated telemetry timeseries, data-coverage honesty notes.
4. A new reader can clone → `docker compose up` → login with README demo
   credentials → search in under 10 minutes.

**Non-goals (YAGNI):** user registration, Kafka/Redis/Celery, real instrument
ingestion, full-resolution imagery storage, multi-region coverage, mobile app.

---

## 2. Decisions (approved)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Architecture | **Approach 1**: Next.js + FastAPI + offline ETL, one compose stack | Showcases both stacks (Python backend + TypeScript/React frontend) |
| D2 | Map stack | **MapLibre GL + ESRI World Imagery raster** (default, no API key, attribution shown) + OSM streets toggle | No account/token; repo self-contained for anyone cloning it; satellite basemap fits the domain (MapLibre demo tiles have no imagery) |
| D3 | Auth | **Visible login page**: public `/` + `/login`, JWT-gated `/dashboard` and all data APIs; demo creds in README | Security must be *seeable*; avoids bounce at a hard wall |
| D4 | Data scope | Saudi Red Sea coast, 512px RGB+NIR chips, low-thousands of rows | CPU-precomputable on this machine; honest, bounded |
| D5 | Message queue | **None** — telemetry via API → Postgres | Kafka is already proven in production work elsewhere; adding it here is ops weight without new signal |
| D6 | Deployment | Coolify stack on this machine, host `geo.sumbono.dev` | Reuses existing Traefik/Let's Encrypt; matches "You Build It You Run It" |
| D7 | Credentials | Cloudflare: `/home/bono/documents/cloudflare.txt` · Coolify API: `/home/bono/documents/coolify-api-token.txt` | Located 2026-10-06; never committed to repo; `.env.example` only |
| D8 | Imagery source | **Element84 Earth Search STAC API v1** (`earth-search.aws.element84.com/v1`, collection `sentinel-2-l2a`) | Verified live 2026-10-06: no auth, no requester-pays marker; Copernicus bulk API needs registration and lost |
| D9 | Embedding model | **RemoteCLIP ViT-B/32** via OpenCLIP + `hf_hub_download("chendelong/RemoteCLIP", ...)` | Official weights verified on Hugging Face; RS-domain model is a better story than vanilla CLIP; 512-dim output |

**Rejected alternatives (with reasons):**

| Alternative | Why rejected |
|---|---|
| Next.js full-stack (API routes only) | Hides the stronger story here (Python/FastAPI backend); ETL needs Python anyway → two runtimes regardless |
| FastAPI + vanilla-JS map frontend | Misses the modern TypeScript/React frontend this project exists to demonstrate |
| Mapbox GL JS | Requires account + token; repo not self-contained for anyone running it locally |
| Leaflet + OSM raster | Lighter, but reads dated for a "modern frontend" showcase |
| MapLibre demo tiles | No satellite imagery — unusable for an Earth-observation app |
| Copernicus Data Space download API | Requires account registration; breaks the 3-command quickstart spirit |
| Kafka/Redis/Celery in the stack | Already proven in production work elsewhere; ops weight with no new signal (telemetry is a seeded demo) |
| Real instrument ingestion | Out of scope; simulated telemetry suffices for the domain story |

**Machine facts (verified):** Coolify 4.3.23 healthy; Traefik v3 on 80/443 with
Let's Encrypt; portfolio `sumbono.dev` already served here; 8 vCPU, 15 GB RAM,
~295 GB free disk; **no GPU** → RemoteCLIP inference CPU-only and offline;
Cloudflare-managed DNS for `sumbono.dev`.

---

## 3. Repository Layout

```
geo-rag-earth-dashboard/          ← this repo (/home/bono/portfolio/geo-rag-earth-dashboard)
├── PLAN.md                       # this spec
├── README.md                     # public pitch, quickstart, demo credentials, badges
├── docker-compose.yml            # full local stack (db + api + web)
├── docker-compose.coolify.yml    # production variant
├── .env.example                  # all env vars, no secrets
├── apps/
│   ├── web/                      # Next.js 15 + TypeScript
│   │   ├── app/(public)/         #   / landing (no auth)
│   │   ├── app/login/            #   /login form
│   │   ├── app/dashboard/        #   /dashboard: map + 3D + charts (JWT-gated)
│   │   └── lib/                  #   API client, auth helpers, map components
│   └── api/                      # FastAPI, Python 3.12
│       ├── auth/                 #   JWT issue/verify, bcrypt seed user
│       ├── search/               #   vector similarity + PostGIS bbox
│       ├── telemetry/            #   simulated ingest + timeseries query
│       └── health/               #   GET /health (Coolify healthcheck)
├── etl/                          # offline batch — NOT deployed
│   ├── download_sentinel2.py     #   S2 L2A for Saudi Red Sea bbox
│   ├── extract_chips.py          #   512px RGB+NIR chips + geodataframe
│   ├── embed_remoteclip.py       #   RemoteCLIP ViT-B/32 CPU batches → pgvector
│   └── seed_telemetry.py         #   synthetic buoy/sensor timeseries
└── docs/
    ├── architecture.png          # diagram for README
    └── benchmarks.md             # measured latency & accuracy
```

---

## 4. Runtime Topology

```
Browser ──HTTPS──▶ Traefik (existing, :80/:443, Let's Encrypt)
                     │  Host(`geo.sumbono.dev`)
        ┌────────────┴────────────┐
        ▼                         ▼
   web (Next.js)            api (FastAPI)
   public routes +          JWT validation,
   /api proxy               vector/bbox/telemetry
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
             postgres:16             etl/ (manual,
             + PostGIS               CPU-only, writes
             + pgvector              into postgres)
             + timeseries
```

- **3 stack containers** (web, api, db) + the shared existing Traefik proxy.
- Web is the only public entry besides Traefik; api stays on the internal
  compose network, reached via `/api/*` proxy from web (single origin →
  no CORS pain in prod; CORS still locked for direct dev access).
- `etl/` runs once on the host, not as a service.

---

## 5. Data Flow & Search Pipeline

**Phase A — Offline ingestion (one-time; download dominates wall time, CPU
embedding ≈ 10 min for ~3k chips):**

```
Earth Search STAC (verified 2026-10-06; no auth)
  → download_sentinel2.py   # STAC search, bbox = Saudi Red Sea coast
                            # (~1,000–3,000 km²); scene assets to local cache
  → extract_chips.py        # per scene: 512×512 px windows, 128 px stride
                            # (25% overlap); bbox per chip derived from scene
                            # geotransform; RGB+NIR bands
  → embed_remoteclip.py     # resize to 224×224 (model input), RemoteCLIP
                            # ViT-B/32 batched CPU inference
  → postgres (see data model below)
  → seed_telemetry.py       # synthetic buoy/sensor timeseries
```

ETL is **resumable and idempotent** (upsert by chip id; skips chips already
embedded), so an interrupted run costs nothing. A committed fixture dump
(`fixtures/seed.sql.gz`, restored automatically on first DB boot) provides
instant demo data so the quickstart works with zero network calls; the full
ETL above is the optional enrichment path.

**Data model (all timestamps `timestamptz`, UTC everywhere — authoritative
clock is the source scene metadata / ingest time, not the browser):**

| Table | PK / key | Columns | Id space |
|---|---|---|---|
| `users` | `uuid` | username (unique), password_hash (bcrypt), created_at | uuid v4; **`sub` of every JWT = `users.uuid`** |
| `refresh_tokens` | `uuid` | user_uuid FK, token_hash (SHA-256 of opaque token), expires_at, used_at, revoked_at | uuid v4; raw token never stored |
| `tiles` | `uuid` | bbox (Polygon, PostGIS SRID 4326), embedding (vector, 512), thumb_path, captured_at (from scene metadata) | uuid v4 |
| `telemetry` | `(buoy_id text, ts timestamptz)` | value double, unit text; **no tokens/secrets ever stored** | composite natural key (idempotent ingest) |

**Phase B — Query-time (what a user sees):**

1. Login at `/login` → `POST /auth/token` → JWT cookie set.
2. On `/dashboard`, type: *"coral reef turquoise water near coastline"*.
3. `POST /search/vector` (JWT required):
   - encode query via RemoteCLIP text tower (CPU, target < 400 ms),
   - `pgvector ORDER BY embedding <=> query_vec LIMIT 12` (< 50 ms),
   - return `{id, thumb_url, bbox, score, captured_at}`; `thumb_url` →
     `GET /api/thumbs/{tile_id}` (JPEG on disk, JWT-gated; same-origin
     cookie is sent with `<img>` requests).
4. MapLibre flies to matched bboxes; chips overlaid colored by score
   (basemap: ESRI World Imagery, attribution shown).
5. Click chip → detail panel: larger thumb, metadata, and a **D3 bar chart
   of all returned results' scores with the selected chip highlighted**.
6. Draw bbox on map → `POST /search/bbox` (PostGIS `ST_Intersects`);
   results merge vector score with spatial filter.
7. 3D tab (Three.js): chips as extruded point-cloud tiles on a Red Sea
   segment, colored by embedding similarity.
8. Telemetry panel: D3 timeseries chart fed by
   `GET /api/telemetry/query` (seeded data, default last 24 h, max 5,000
   points); optional SSE live stream is a dev-only extra, not a demo
   requirement.

**Latency budget** (publish in `docs/benchmarks.md`):

| Step | Target |
|---|---|
| text → embedding (CPU) | < 400 ms |
| pgvector search (~1–3k rows) | < 50 ms |
| bbox search | < 50 ms |
| end-to-end `/search/vector` p95 | < 800 ms |

---

## 6. Security Design

- **AuthN:** OAuth2 password flow → short-lived JWT access (15 min) in
  httpOnly, SameSite=Strict cookie + rotating refresh token (7 d, httpOnly;
  **opaque token stored hashed in `refresh_tokens`, rotated on use,
  revocable**). `Depends(verify_jwt)` on every `/search/*` and `/telemetry/*`
  route; `verify_jwt` validates signature/expiry **and that `sub`
  (`users.uuid`) still exists**; missing/invalid/expired/deleted-user →
  `401 {"detail": ...}`; web redirects to `/login`.
- **Seed user:** bcrypt hash from env (`DEMO_USER`, `DEMO_PASSWORD`), created
  by first-boot script if absent. No plaintext secrets in the repo.
- **Transport:** TLS via Traefik/Let's Encrypt; api on internal network only.
- **Hardening checklist:** CORS locked to `geo.sumbono.dev`; rate limits —
  `POST /api/auth/token` and `/api/auth/refresh` 5/min/IP (slowapi), other
  API routes 60/min/IP; telemetry ingest body capped at **64 KB JSON**;
  telemetry query default window **last 24 h, max 5,000 points**; search
  `LIMIT` fixed at **12**; parameterized SQL (SQLAlchemy); Next.js security
  headers (CSP, X-Frame-Options); real `.env` gitignored, `.env.example`
  committed.
- **Showcase artifacts:** README screenshots of a 401 response, JWT decode
  flow diagram, rate-limited login rejection.

**Route access matrix:**

| Route | Access |
|---|---|
| `/` landing | Public |
| `/login` | Public |
| `/dashboard` + map/3D/charts | JWT required |
| `POST /api/auth/token`, `POST /api/auth/refresh` | Public, rate-limited 5/min/IP |
| `GET /api/search/*`, `POST /api/search/*`, `/api/telemetry/query` | JWT required (401 otherwise) |
| `POST /api/telemetry/ingest` | JWT required (dev/demo tooling) |
| `GET /api/thumbs/{tile_id}` | JWT required (cookie sent by `<img>`) |
| `GET /api/health` | Public (Coolify healthcheck) |

---

## 7. Error Handling

| Failure | Behavior |
|---|---|
| ETL download misses a tile | logged + skipped; manifest records coverage % (honest README note) |
| RemoteCLIP CPU OOM | batch size auto-halves; job resumable via idempotent upsert |
| api down / unhealthy | Coolify healthcheck on `/health` → auto-restart; web shows friendly "API unreachable" state |
| No search results | empty-state UI with query suggestions; never a blank map |
| JWT expired mid-session | silent refresh via refresh cookie; hard redirect to `/login` if refresh fails |
| JWT valid but user row deleted | `verify_jwt` returns 401 → redirect to `/login`; first-boot script recreates seed user |
| Telemetry client disconnects | SSE handler cleans up; ingest idempotent on `(buoy_id, ts)` |

---

## 8. Testing Strategy

- **api (pytest + httpx):** JWT issue/verify/expiry units; **refresh-token
  rotation + revocation test** (reuse of a consumed token → 401); **rate-limit
  test** (6th login attempt in a minute → 429); vector ranking against a
  50-row fixture DB with known embeddings (assert nearest-neighbor order);
  PostGIS `ST_Intersects` geometry fixtures; **telemetry ingest idempotency
  (same `(buoy_id, ts)` twice → one row)**; authz sweep — every protected
  route unauthenticated → 401.
- **web (Vitest + RTL):** auth-guard redirect, result rendering, empty
  states. One Playwright e2e: login → search → chip click → bbox draw.
- **etl:** golden-file test — small fixture TIFF → chip extractor bbox/shape
  matches stored expectation; embedding dim = 512.
- **CI (GitHub Actions, badge in README):** ruff + eslint/biome → pytest →
  vitest → build both apps → Playwright smoke.
- **Coverage:** auth + search ≥ 90%; repo overall ≥ 70%; no vanity coverage
  on map components.

---

## 9. Deployment Plan

1. Cloudflare DNS: `geo.sumbono.dev` A record → this machine's IP
   (via Cloudflare API using `/home/bono/documents/cloudflare.txt`).
2. Coolify: create project + app from repo, compose file
   `docker-compose.coolify.yml`, host `geo.sumbono.dev`, healthcheck
   `GET /health` (Coolify API token available for scripted setup).
3. Traefik (existing) auto-provisions Let's Encrypt cert for the subdomain.
4. Run `etl/` once on the host against the prod DB (or restore a seeded dump).
5. Verify: HTTPS landing → login → search → 3D → telemetry; record
   p95 latency for `docs/benchmarks.md`.

---

## 10. Milestones (post-approval implementation)

| # | Deliverable | Exit criterion |
|---|---|---|
| M1 | Scaffold: monorepo, compose, CI, health endpoints | `docker compose up` serves empty landing + healthy api |
| M2 | ETL pipeline + seeded DB | chips + embeddings + telemetry in Postgres |
| M3 | API: auth + vector + bbox + telemetry | pytest green; 401 sweep passes |
| M4 | Web: landing, login, dashboard map + detail panel | Playwright e2e green locally |
| M5 | 3D view + D3 charts + benchmarks doc | p95 numbers recorded honestly |
| M6 | Deploy to Coolify + DNS + README/GIF/architecture.png | live at `geo.sumbono.dev` |

---

## 11. Open Risks

- **Sentinel-2 access**: Earth Search STAC is auth-free (verified), but the
  underlying S3 asset layer could be requester-pays → **watch at M2**: the
  one-scene download smoke test catches it immediately; fallback is a second
  open mirror or a pre-seeded chip dump shipped with the repo.
- **Sentinel-2 cloud cover** over the Red Sea → scene filter (≤ 20% cloud)
  recorded in the coverage manifest; honest README note.
- **CPU text-encode latency** may exceed 400 ms under load → mitigate with
  ONNX-quantized text tower or query-embedding cache if measurements demand it.
- **DNS propagation** for `geo.sumbono.dev` → verify record before M6.
