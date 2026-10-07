# Benchmarks — Geo-RAG Earth Dashboard

**Machine:** 8 vCPU, 15 GB RAM, CPU-only (this Coolify host), 2026-10-07
**Run:** `python apps/api/scripts/bench.py --n 50` — report-only: the script exits 0 regardless of verdicts (honest numbers, not a gate).

| Measurement | n | mean (ms) | p95 (ms) | budget | verdict |
|---|---:|---:|---:|---:|---|
| (a) `encode_text` (RemoteCLIP CPU) | 50 | 58.7 | 90.0 | < 400 | PASS |
| (b) pgvector SQL (cosine, top-12) | 50 | 2.9 | 3.6 | < 50 | PASS |
| (c) end-to-end `POST /search/vector` | 50 | 2035.1 | 2294.6 | < 800 | FAIL |

## Method & disclosures

- Budgets (PLAN.md §5): text→embedding < 400 ms, pgvector search < 50 ms, end-to-end `/search/vector` p95 < 800 ms. PASS = strictly under budget (p95 == budget counts as FAIL).
- Statistics: arithmetic mean; p95 = nearest-rank (sorted sample, index ceil(0.95·n)−1, no interpolation).
- Each leg: 3 warm-up iterations discarded, then 50 measured iterations over a fixed cycle of 6 earth-observation queries.
- Encoder `remoteclip`: constructed once in 6248 ms (model load excluded from (a) timings; warm-up absorbs first-call cost).
- SQL leg: the real `ORDER BY embedding <=> … LIMIT 12` statement (mirrors `app/routers/search.py`) executed on a per-iteration pooled Session against `postgresql+psycopg://postgres:postgres@localhost:5432/geo` — 100 tile rows (fixture seed `fixtures/seed.sql.gz`); one query embedding reused across iterations so this isolates the search.
- e2e leg: httpx POST `http://localhost:3000/api/search/vector` with a cookie session from `POST /auth/token` — the browser path (web `/api` proxy → api → db) minus Traefik/TLS, which local compose does not run. The stack ran with its compose settings (rate limit on); n+warm-up stays under the 60/min search limit. As shipped, `search_vector` constructs the encoder per request, so (c) includes model load each call — that is the (a)-vs-(c) gap, measured, not adjusted.

---
