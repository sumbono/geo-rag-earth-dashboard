"""Unit tests for scripts/bench.py — argument parsing, p95 math, budget-row
formatting, and markdown rendering ONLY.

Deliberately never runs the benchmark itself: the live run is report-only
evidence (docs/benchmarks.md), while these tests must pass with no stack,
no DB and no ML deps installed.
"""
import importlib.util
import re
from pathlib import Path

import pytest

_BENCH_PATH = Path(__file__).resolve().parents[1] / "scripts" / "bench.py"


def _load_bench():
    """Load apps/api/scripts/bench.py as a module (scripts/ is not a package)."""
    spec = importlib.util.spec_from_file_location("bench", _BENCH_PATH)
    assert spec and spec.loader, f"cannot load spec for {_BENCH_PATH}"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def bench():
    return _load_bench()


# ── argument parsing ──────────────────────────────────────────────────────

def test_parse_args_defaults(bench):
    args = bench.parse_args([])
    assert args.n == 50
    assert args.encoder == "remoteclip"   # real run is the committed default
    assert args.base_url.rstrip("/").endswith("/api")
    assert str(args.out).endswith("docs/benchmarks.md")


def test_parse_args_flags(bench):
    args = bench.parse_args(["--n", "10", "--encoder", "fake", "--force"])
    assert args.n == 10
    assert args.encoder == "fake"
    assert args.force is True


def test_parse_args_rejects_bad_encoder(bench):
    with pytest.raises(SystemExit):
        bench.parse_args(["--encoder", "clip"])


# ── fake-mode clobber guard ───────────────────────────────────────────────

def test_fake_mode_refuses_default_out(bench, capsys):
    """`--encoder fake` with the default out must REFUSE: CI-ish numbers
    must never silently overwrite the committed real-run benchmarks."""
    with pytest.raises(SystemExit):
        bench.parse_args(["--encoder", "fake"])
    assert "--force" in capsys.readouterr().err


def test_fake_mode_allowed_with_force(bench):
    args = bench.parse_args(["--encoder", "fake", "--force"])
    assert args.encoder == "fake" and args.force is True


def test_fake_mode_allowed_with_explicit_out(bench, tmp_path):
    out = tmp_path / "bench.md"
    args = bench.parse_args(["--encoder", "fake", "--out", str(out)])
    assert args.out == out


def test_real_mode_allowed_at_default_out(bench):
    args = bench.parse_args([])   # real run is the committed default
    assert args.out == bench.DEFAULT_OUT


# ── p95 math (nearest-rank: sorted[ceil(0.95*n) - 1]) ─────────────────────

def test_p95_nearest_rank_n50(bench):
    assert bench.p95(list(range(1, 51))) == 48  # ceil(0.95*50)=48 → 48th value


def test_p95_single_and_small(bench):
    assert bench.p95([7.0]) == 7.0
    assert bench.p95([1.0, 2.0, 3.0, 4.0, 5.0]) == 5.0  # ceil(4.75)=5 → last


def test_mean(bench):
    assert bench.mean([10.0, 20.0, 30.0]) == 20.0


# ── budget rows ───────────────────────────────────────────────────────────

def test_budget_row_pass(bench):
    row = bench.format_row("(a) encode_text", n=50, mean_ms=80.0, p95_ms=150.0, budget_ms=400.0)
    assert row == "| (a) encode_text | 50 | 80.0 | 150.0 | < 400 | PASS |"


def test_budget_row_fail_above_budget(bench):
    row = bench.format_row("(c) e2e /search/vector", n=50, mean_ms=900.0, p95_ms=2100.0, budget_ms=800.0)
    assert row.endswith("| FAIL |")


def test_budget_row_fail_exactly_at_budget(bench):
    # budgets are strict "<": p95 == budget is a FAIL, not a PASS
    row = bench.format_row("sql", n=50, mean_ms=10.0, p95_ms=50.0, budget_ms=50.0)
    assert row.endswith("| FAIL |")


def test_budget_row_error_leg(bench):
    row = bench.format_row("sql", n=0, mean_ms=None, p95_ms=None, budget_ms=50.0)
    assert "ERROR" in row


# ── markdown rendering ────────────────────────────────────────────────────

def _stats():
    return {
        "encode": {"n": 50, "mean": 80.0, "p95": 150.0, "budget": 400.0},
        "sql": {"n": 50, "mean": 10.0, "p95": 20.0, "budget": 50.0},
        "e2e": {"n": 50, "mean": 900.0, "p95": 2100.0, "budget": 800.0},
    }


def test_render_contains_machine_line(bench):
    """Machine line derives its date from run time — assert the PATTERN,
    not a frozen date (the date must change with each run)."""
    md = bench.render_markdown(_stats(), disclosures=["dummy note"])
    match = re.search(r"\*\*Machine:\*\* (.+)", md)
    assert match, "machine line missing from rendered markdown"
    assert re.fullmatch(
        r"8 vCPU, 15 GB RAM, CPU-only \(this Coolify host\), \d{4}-\d{2}-\d{2}",
        match.group(1),
    )


def test_machine_line_pattern_and_run_date(bench):
    from datetime import datetime, timezone
    line = bench.machine_line(datetime(2026, 10, 7, tzinfo=timezone.utc))
    assert line == "8 vCPU, 15 GB RAM, CPU-only (this Coolify host), 2026-10-07"
    assert bench.machine_line().split(", ")[-1].count("-") == 2  # derived, not frozen


def test_render_contains_all_rows_and_verdicts(bench):
    md = bench.render_markdown(_stats(), disclosures=["dummy note"])
    assert "| (a) `encode_text`" in md and "| PASS |" in md
    assert "| (b) pgvector SQL" in md
    assert "| (c) end-to-end" in md and md.count("| FAIL |") == 1  # only e2e fails
    assert "dummy note" in md


def test_render_error_leg_does_not_crash(bench):
    stats = _stats()
    stats["sql"] = {"n": 0, "mean": None, "p95": None, "budget": 50.0, "error": "db unreachable"}
    md = bench.render_markdown(stats, disclosures=[])
    assert "ERROR" in md and "db unreachable" in md


# ── author-section preservation (static prose survives regeneration) ──────

def test_preserved_author_section_roundtrip(bench, tmp_path):
    out = tmp_path / "benchmarks.md"
    out.write_text(
        f"generated head\n\n---\n\n{bench.AUTHOR_MARK}\n## History\nauthor prose\n",
        encoding="utf-8",
    )
    section = bench.preserved_author_section(out)
    assert section.startswith(bench.AUTHOR_MARK)
    assert "## History" in section and "author prose" in section


def test_preserved_author_section_absent_or_missing(bench, tmp_path):
    missing = tmp_path / "nope.md"
    assert bench.preserved_author_section(missing) == ""
    stale = tmp_path / "stale.md"
    stale.write_text("# no marker here\n", encoding="utf-8")
    assert bench.preserved_author_section(stale) == ""
