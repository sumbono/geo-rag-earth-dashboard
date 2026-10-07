#!/usr/bin/env python3
"""Honest latency benchmark → writes docs/benchmarks.md (report-only, never a gate).

Measures three legs against the real stack (fixture-seeded Postgres on
localhost:5432 + the compose web/api):

  (a) encode_text   — mean/p95 over N queries (default encoder: RemoteCLIP CPU)
  (b) pgvector SQL  — the actual top-12 cosine search statement, executed N times
  (c) end-to-end    — POST /search/vector N times

Writes a markdown table with a machine line and per-row PASS/FAIL against the
spec budgets (encode <400 ms, sql <50 ms, e2e p95 <800 ms), then exits 0
REGARDLESS of the verdicts: the numbers are honest reporting, not a gate.

  Real committed run:  python apps/api/scripts/bench.py --n 50
  CI-ish run:          python apps/api/scripts/bench.py --encoder fake
      (FakeEncoder + in-process TestClient e2e — needs only the compose db,
       no ML deps and no running api/web containers)

ML imports stay lazy (repo invariant: torch/open_clip only inside
RemoteCLIPEncoder paths) so `--encoder fake` works without requirements-ml.
"""
import argparse
import math
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]          # monorepo root
API_ROOT = Path(__file__).resolve().parents[1]            # apps/api → `import app.*`
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

# Everything from this marker to EOF in the output file is author-editable
# prose (static methodology notes, History) that the generator preserves
# verbatim across runs — never re-derived, so its claims can't go stale.
AUTHOR_MARK = "<!-- author-section -->"
DEFAULT_OUT = REPO_ROOT / "docs" / "benchmarks.md"
WARMUP = 3                       # discarded iterations per leg
DEFAULT_DB_URL = "postgresql+psycopg://postgres:postgres@localhost:5432/geo"
DEFAULT_BASE_URL = "http://localhost:3000/api"   # web /api proxy = browser path

BUDGETS_MS = {"encode": 400.0, "sql": 50.0, "e2e": 800.0}   # PLAN.md §5

QUERIES = (
    "turquoise coral reef shallow water",
    "sentinel-2 coastal scene red sea",
    "desert coastline sandbar island",
    "mangrove wetland estuary",
    "seagrass bed submerged vegetation",
    "sand dune arid terrain",
)


# ── run metadata ──────────────────────────────────────────────────────────

def machine_line(now: datetime | None = None) -> str:
    """Run-date machine line — same shape every run, date = run day
    (not frozen at authoring time; test_bench checks the pattern, not a date)."""
    day = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    return f"8 vCPU, 15 GB RAM, CPU-only (this Coolify host), {day}"


# ── statistics ────────────────────────────────────────────────────────────

def p95(xs: list[float]) -> float:
    """Nearest-rank p95: sorted[ceil(0.95·n) − 1] — a real sample value, no
    interpolation (documented in benchmarks.md so the number is reproducible)."""
    if not xs:
        raise ValueError("p95 of empty sample")
    ordered = sorted(xs)
    return ordered[math.ceil(0.95 * len(ordered)) - 1]


def mean(xs: list[float]) -> float:
    return statistics.mean(xs)


def _stats_from(samples: list[float], budget_ms: float) -> dict:
    return {"n": len(samples), "mean": mean(samples), "p95": p95(samples), "budget": budget_ms}


def _error_leg(budget_ms: float, exc: Exception) -> dict:
    """A leg that could not be measured at all (stack/db/encoder down)."""
    reason = str(exc) or type(exc).__name__
    print(f"[bench] leg failed: {reason}", file=sys.stderr)
    return {"n": 0, "mean": None, "p95": None, "budget": budget_ms, "error": reason}


# ── argument parsing ──────────────────────────────────────────────────────

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="bench",
        description="Measure encode/SQL/e2e latency and write docs/benchmarks.md "
                    "(report-only: exits 0 regardless of PASS/FAIL).",
    )
    p.add_argument("--n", type=int, default=50,
                   help="measured iterations per leg (default: 50)")
    p.add_argument("--encoder", choices=("remoteclip", "fake"),
                   default="remoteclip",
                   help="remoteclip = real CPU RemoteCLIP (committed default); "
                        "fake = CI-ish run (FakeEncoder, in-process e2e)")
    p.add_argument("--base-url", default=DEFAULT_BASE_URL,
                   help="live stack base URL for the e2e leg (default: %(default)s)")
    p.add_argument("--database-url",
                   default=os.environ.get("DATABASE_URL", DEFAULT_DB_URL),
                   help="Postgres DSN for the SQL leg (default: %(default)s)")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT,
                   help="markdown output path (default: %(default)s)")
    p.add_argument("--force", action="store_true",
                   help="allow --encoder fake to overwrite the default out path "
                        "(the committed real-run numbers)")
    args = p.parse_args(argv)
    if args.n < 1:
        p.error("--n must be >= 1")
    if (args.encoder == "fake" and not args.force
            and args.out.resolve() == DEFAULT_OUT.resolve()):
        # Clobber guard: a fake-mode run must never silently overwrite the
        # committed real-run benchmarks with CI-ish numbers.
        p.error("--encoder fake would overwrite the committed real-run "
                "benchmarks (docs/benchmarks.md) — pass --force or a "
                "different --out")
    return args


# ── markdown rendering ────────────────────────────────────────────────────

def format_row(name: str, n: int, mean_ms: float | None, p95_ms: float | None,
               budget_ms: float, error: str | None = None) -> str:
    """One table row. Budgets are strict '<': p95 == budget is a FAIL.
    A leg that could not be measured renders as ERROR (<reason>), not a FAIL."""
    budget = f"< {budget_ms:g}"
    if error is not None or p95_ms is None:
        detail = f" ({error})" if error else ""
        return f"| {name} | {n} | — | — | {budget} | ERROR{detail} |"
    verdict = "PASS" if p95_ms < budget_ms else "FAIL"
    return f"| {name} | {n} | {mean_ms:.1f} | {p95_ms:.1f} | {budget} | {verdict} |"


def _row(stats: dict, name: str) -> str:
    return format_row(name, n=stats["n"], mean_ms=stats["mean"], p95_ms=stats["p95"],
                      budget_ms=stats["budget"], error=stats.get("error"))


def render_markdown(stats: dict, disclosures: list[str],
                    encoder_label: str = "RemoteCLIP CPU") -> str:
    """The full docs/benchmarks.md body for one run."""
    n = next((s["n"] for s in stats.values() if s.get("n")), 0)
    rows = [
        _row(stats["encode"], f"(a) `encode_text` ({encoder_label})"),
        _row(stats["sql"], "(b) pgvector SQL (cosine, top-12)"),
        _row(stats["e2e"], "(c) end-to-end `POST /search/vector`"),
    ]
    lines = [
        "# Benchmarks — Geo-RAG Earth Dashboard",
        "",
        f"**Machine:** {machine_line()}",
        (
            f"**Run:** `python apps/api/scripts/bench.py --n {n}` — report-only: "
            "the script exits 0 regardless of verdicts (honest numbers, not a gate)."
        ),
        "",
        "| Measurement | n | mean (ms) | p95 (ms) | budget | verdict |",
        "|---|---:|---:|---:|---:|---|",
        *rows,
        "",
        "## Method & disclosures",
        "",
        (
            "- Budgets (PLAN.md §5): text→embedding < 400 ms, pgvector search < 50 ms, "
            "end-to-end `/search/vector` p95 < 800 ms. PASS = strictly under budget "
            "(p95 == budget counts as FAIL)."
        ),
        (
            "- Statistics: arithmetic mean; p95 = nearest-rank (sorted sample, index "
            "ceil(0.95·n)−1, no interpolation)."
        ),
        (
            f"- Each leg: {WARMUP} warm-up iterations discarded, then {n} measured "
            f"iterations over a fixed cycle of {len(QUERIES)} earth-observation queries."
        ),
    ]
    lines += [f"- {d}" for d in disclosures]
    lines += ["", "---", ""]
    return "\n".join(lines)


def preserved_author_section(path: Path) -> str:
    """Everything from AUTHOR_MARK to EOF in the existing output file —
    static methodology notes and History the generator carries forward
    verbatim (author prose; may claim what is true about *code*, which the
    run-derived disclosures above must not). Missing file/markup → ''."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    idx = text.find(AUTHOR_MARK)
    if idx == -1:
        return ""
    return text[idx:].rstrip() + "\n"


# ── measurement legs ──────────────────────────────────────────────────────

def _timed_samples(fn, n: int, warmup: int = WARMUP) -> list[float]:
    """Run `fn(i)` for warmup (discarded) + n iterations; return ms samples."""
    for i in range(warmup):
        fn(i)
    samples: list[float] = []
    for i in range(n):
        t0 = time.perf_counter()
        fn(warmup + i)
        samples.append((time.perf_counter() - t0) * 1000.0)
    return samples


def build_encoder(kind: str):
    """(encoder, label, construction_ms). ML deps imported lazily, only here."""
    t0 = time.perf_counter()
    if kind == "fake":
        from app.encoder import FakeEncoder
        enc, label = FakeEncoder(), "fake"
    else:
        from app.encoder import RemoteCLIPEncoder
        enc, label = RemoteCLIPEncoder(), "RemoteCLIP CPU"
    return enc, label, (time.perf_counter() - t0) * 1000.0


def bench_encode(enc, n: int) -> dict:
    samples = _timed_samples(
        lambda i: enc.encode_text(QUERIES[i % len(QUERIES)]), n)
    return _stats_from(samples, BUDGETS_MS["encode"])


def bench_sql(vec, db_url: str, n: int) -> tuple[dict, int]:
    """Execute the real pgvector search statement N times; return (stats, tile_rows).

    The statement mirrors app/routers/search.py:search_vector exactly (same
    cosine_distance ordering, LIMIT 12) — app code is not modified to reuse it.
    One query embedding is built once and reused, so this isolates the search.
    """
    import sqlalchemy as sa
    from app.db import make_engine, make_session_factory
    from app.models import Tile
    from sqlalchemy import func, select

    engine = make_engine(db_url)
    Session = make_session_factory(engine)
    with engine.connect() as conn:
        tile_rows = conn.execute(sa.select(func.count()).select_from(Tile)).scalar_one()

    dist = Tile.embedding.cosine_distance(vec)
    stmt = (
        select(
            Tile.id,
            func.ST_AsGeoJSON(Tile.bbox).label("bbox_json"),
            Tile.captured_at,
            (1 - dist).label("score"),
        )
        .order_by(dist)
        .limit(12)
    )

    def one(_i: int) -> None:
        with Session() as s:            # per-request session, as get_db does
            s.execute(stmt).all()       # fetch included — the app fetches rows

    samples = _timed_samples(one, n)
    engine.dispose()
    return _stats_from(samples, BUDGETS_MS["sql"]), tile_rows


def bench_e2e_live(base_url: str, n: int) -> dict:
    """(c) against the RUNNING stack over real HTTP: web /api proxy → api → db.

    Cookie auth from POST /auth/token (demo user). Total requests per run =
    n + WARMUP ≤ 53 for the default n=50 — under the stack's 60/min search
    rate limit, so pacing is unnecessary; a non-200 (e.g. 429) fails the leg
    loudly instead of being silently dropped from the sample.
    """
    import httpx

    user = os.environ.get("DEMO_USER", "demo")
    password = os.environ.get("DEMO_PASSWORD", "demo-pass-123")
    with httpx.Client(base_url=base_url, timeout=120.0) as client:
        login = client.post("/auth/token", data={"username": user, "password": password})
        if login.status_code != 200:
            raise RuntimeError(f"login failed: HTTP {login.status_code} {login.text[:200]}")

        def one(i: int) -> None:
            r = client.post("/search/vector", json={"query": QUERIES[i % len(QUERIES)]})
            if r.status_code != 200:
                raise RuntimeError(f"/search/vector HTTP {r.status_code}: {r.text[:200]}")
            r.json()

        samples = _timed_samples(one, n)
    return _stats_from(samples, BUDGETS_MS["e2e"])


def bench_e2e_testclient(db_url: str, encoder_kind: str, n: int) -> dict:
    """(c) CI-ish: in-process ASGI TestClient (no network hop), rate limiting
    off, ENCODER=fake — needs the compose db but no api/web containers."""
    os.environ["DATABASE_URL"] = str(db_url)
    os.environ["ENCODER"] = encoder_kind
    os.environ["RATE_LIMIT_ENABLED"] = "false"
    os.environ.setdefault("JWT_SECRET", "bench-jwt-secret-0123456789abcdef0123456789")
    os.environ.setdefault("REFRESH_SECRET", "bench-refresh-secret")
    os.environ.setdefault("DEMO_USER", "demo")
    os.environ.setdefault("DEMO_PASSWORD", "demo-pass-123")

    from app.config import Settings
    from app.main import create_app
    from fastapi.testclient import TestClient

    user = os.environ["DEMO_USER"]
    password = os.environ["DEMO_PASSWORD"]
    with TestClient(create_app(Settings())) as client:
        login = client.post("/auth/token", data={"username": user, "password": password})
        if login.status_code != 200:
            raise RuntimeError(f"login failed: HTTP {login.status_code} {login.text[:200]}")

        def one(i: int) -> None:
            r = client.post("/search/vector", json={"query": QUERIES[i % len(QUERIES)]})
            if r.status_code != 200:
                raise RuntimeError(f"/search/vector HTTP {r.status_code}: {r.text[:200]}")
            r.json()

        samples = _timed_samples(one, n)
    return _stats_from(samples, BUDGETS_MS["e2e"])


# ── driver ────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    n = args.n
    # Any app import may instantiate Settings() (e.g. app.rate_limit at module
    # import) — provide harmless defaults for the secrets it requires.
    os.environ.setdefault("JWT_SECRET", "bench-jwt-secret-0123456789abcdef0123456789")
    os.environ.setdefault("REFRESH_SECRET", "bench-refresh-secret")
    os.environ.setdefault("DEMO_USER", "demo")
    os.environ.setdefault("DEMO_PASSWORD", "demo-pass-123")

    stats: dict[str, dict] = {}
    disclosures: list[str] = []
    encoder_label = "RemoteCLIP CPU" if args.encoder == "remoteclip" else "fake"

    # (a) encode_text + the query embedding reused by (b)
    vec = None
    try:
        enc, encoder_label, load_ms = build_encoder(args.encoder)
        stats["encode"] = bench_encode(enc, n)
        vec = enc.encode_text(QUERIES[0])
        disclosures.append(
            f"Encoder `{args.encoder}`: constructed once in {load_ms:.0f} ms "
            f"(model load excluded from (a) timings; warm-up absorbs first-call cost)."
        )
    except Exception as exc:  # noqa: BLE001 — report leg failure, never crash the run
        stats["encode"] = _error_leg(BUDGETS_MS["encode"], exc)
        disclosures.append(f"Encoder `{args.encoder}` unavailable: {exc}")

    # (b) pgvector SQL
    try:
        if vec is None:
            raise RuntimeError("no query embedding (encoder leg failed)")
        sql_stats, tile_rows = bench_sql(vec, args.database_url, n)
        stats["sql"] = sql_stats
        disclosures.append(
            f"SQL leg: the real `ORDER BY embedding <=> … LIMIT 12` statement "
            f"(mirrors `app/routers/search.py`) executed on a per-iteration pooled "
            f"Session against `{args.database_url}` — {tile_rows} tile rows "
            f"(fixture seed `fixtures/seed.sql.gz`); one query embedding reused "
            f"across iterations so this isolates the search."
        )
    except Exception as exc:  # noqa: BLE001
        stats["sql"] = _error_leg(BUDGETS_MS["sql"], exc)

    # (c) end-to-end
    try:
        if args.encoder == "fake":
            stats["e2e"] = bench_e2e_testclient(args.database_url, args.encoder, n)
            disclosures.append(
                "e2e leg (CI-ish mode): in-process ASGI TestClient → FastAPI app → "
                f"real DB (`{args.database_url}`), rate limiting disabled, ENCODER=fake. "
                "No TCP/TLS/proxy hop — the committed numbers come from a real-mode run."
            )
        else:
            stats["e2e"] = bench_e2e_live(args.base_url, n)
            disclosures.append(
                f"e2e leg: httpx POST `{args.base_url}/search/vector` with a cookie "
                "session from `POST /auth/token` — the browser path (web `/api` proxy → "
                "api → db). The stack ran with its compose settings (rate limit on); "
                "n+warm-up stays under the 60/min search limit. Warm-up discards "
                "absorb any first-request model load in the api process. Path "
                "caveats and code-state notes live in the author-maintained "
                "methodology section below, preserved verbatim across runs."
            )
    except Exception as exc:  # noqa: BLE001
        stats["e2e"] = _error_leg(BUDGETS_MS["e2e"], exc)

    md = render_markdown(stats, disclosures, encoder_label=encoder_label)
    md = md + preserved_author_section(args.out)
    print(md)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(md, encoding="utf-8")
    print(f"[bench] wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
