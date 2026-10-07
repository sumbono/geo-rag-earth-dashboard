"""Telemetry: idempotent ingest (`ON CONFLICT DO NOTHING` on the (buoy_id, ts) PK)
and windowed timeseries query (default 24 h, newest 5,000 points kept)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Telemetry, User
from app.rate_limit import limiter
from app.security import verify_jwt

router = APIRouter(tags=["telemetry"])

MAX_POINTS = 5000        # Global Constraint: query returns at most 5,000 points
_HOURS_CLAMP = 876_000.0  # ±100 y: any larger window is the same "everything"


class IngestRequest(BaseModel):
    """`{"buoy_id": str, "ts": ISO-8601, "value": float, "unit": str}`.

    `min_length=1` makes an empty buoy_id a 422; the max lengths mirror the
    Task 2 column sizes (String(32)/String(16)) so an over-long value is a 422
    instead of a 500 from Postgres at insert time.
    """
    buoy_id: str = Field(min_length=1, max_length=32)
    ts: datetime
    value: float
    unit: str = Field(max_length=16)

    @field_validator("ts")
    @classmethod
    def _naive_ts_is_utc(cls, v: datetime) -> datetime:
        # timestamptz is an instant; a naive ISO-8601 input carries no zone, so
        # pin it to UTC rather than letting the session timezone guess.
        return v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)


class IngestResponse(BaseModel):
    ok: bool


class Point(BaseModel):
    ts: datetime  # ISO-8601, UTC
    value: float


class QueryResponse(BaseModel):
    points: list[Point]
    count: int


@router.post("/telemetry/ingest", response_model=IngestResponse)
@limiter.limit("60/minute")
def ingest_telemetry(
    request: Request,
    payload: IngestRequest,
    user: User = Depends(verify_jwt),
    session: Session = Depends(get_db),
) -> IngestResponse:
    """Store one reading. Idempotent: `INSERT ... ON CONFLICT DO NOTHING` —
    a repeat of the same `(buoy_id, ts)` is 200 with no second row (first
    write wins)."""
    stmt = (
        insert(Telemetry)
        .values(
            buoy_id=payload.buoy_id,
            ts=payload.ts,
            value=payload.value,
            unit=payload.unit,
        )
        .on_conflict_do_nothing()
    )
    session.execute(stmt)
    session.commit()
    return IngestResponse(ok=True)


@router.get("/telemetry/query", response_model=QueryResponse)
@limiter.limit("60/minute")
def query_telemetry(
    request: Request,
    buoy_id: str | None = Query(default=None),
    hours: float = Query(default=24),
    user: User = Depends(verify_jwt),
    session: Session = Depends(get_db),
) -> QueryResponse:
    """Last `hours` (default 24) readings as `{points: [{ts, value}], count}`.

    `buoy_id` is optional: absent/empty → every buoy in the window (the bare
    GET must stay 200 — test_auth's contract). `hours` is clamped to ±100 y so
    an extreme input cannot OverflowError the datetime math; whatever the
    window, at most the 5,000 NEWEST points come back, in chronological order.
    """
    hours = max(-_HOURS_CLAMP, min(hours, _HOURS_CLAMP))
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    stmt = select(Telemetry.ts, Telemetry.value).where(Telemetry.ts >= since)
    if buoy_id:
        stmt = stmt.where(Telemetry.buoy_id == buoy_id)
    # Newest-first + LIMIT keeps the newest MAX_POINTS; reverse for the chart.
    rows = list(session.execute(stmt.order_by(Telemetry.ts.desc()).limit(MAX_POINTS)))
    points = [Point(ts=ts, value=value) for ts, value in reversed(rows)]
    return QueryResponse(points=points, count=len(points))
