"""Vector search over Tile embeddings (pgvector cosine distance) + bbox search (PostGIS envelope)."""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import get_db
from app.deps import get_settings
from app.encoder import get_encoder
from app.models import Tile, User
from app.rate_limit import limiter
from app.security import verify_jwt

router = APIRouter(tags=["search"])


class VectorSearchRequest(BaseModel):
    """`{"query": str}` — an empty query is a 422 (min_length=1)."""
    query: str = Field(min_length=1)


class SearchResult(BaseModel):
    """The exact shape Task 15's `lib/types.ts` consumes."""
    id: str                       # uuid str
    thumb_url: str                # "/api/thumbs/{id}"
    bbox: list[list[list[float]]]  # GeoJSON Polygon coords: number[][][]
    score: float                  # 1 - cosine_distance
    captured_at: datetime         # ISO-8601


class VectorSearchResponse(BaseModel):
    results: list[SearchResult]


class BboxSearchRequest(BaseModel):
    """`{"bbox": [[w,s],[e,n]], "q": str | null, "limit": int = 12}`.

    `q` selects the mode: present → cosine-ranked vector search, absent →
    intersecting tiles by `captured_at DESC`. Invalid geometry is a 422.
    """
    bbox: tuple[tuple[float, float], tuple[float, float]]
    q: str | None = None
    limit: int = Field(default=12, ge=1)

    @field_validator("bbox")
    @classmethod
    def _ordered_and_in_range(cls, b):
        (w, s), (e, n) = b
        if not (w < e and s < n):
            raise ValueError("bbox must be [[w,s],[e,n]] with w < e and s < n")
        if not (-180 <= w and e <= 180 and -90 <= s and n <= 90):
            raise ValueError("bbox out of range: lon within [-180, 180], lat within [-90, 90]")
        return b


def _row_to_result(row) -> SearchResult:
    """One row-mapper shared by /search/vector and /search/bbox (no duplication)."""
    return SearchResult(
        id=str(row.id),
        thumb_url=f"/api/thumbs/{row.id}",
        bbox=json.loads(row.bbox_json)["coordinates"],
        score=float(row.score),
        captured_at=row.captured_at,
    )


@router.post("/search/vector", response_model=VectorSearchResponse)
@limiter.limit("60/minute")
def search_vector(
    request: Request,
    payload: VectorSearchRequest,
    user: User = Depends(verify_jwt),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> VectorSearchResponse:
    """Rank tiles by cosine distance to the query embedding; top 12.

    score = 1 - cosine_distance (so higher is closer). Dimension drift between
    the encoder and the Vector(512) column must fail loudly, once, at fetch.
    """
    vec = get_encoder(settings).encode_text(payload.query)
    assert vec.shape == (512,), f"encoder dim drift: got shape {vec.shape}, expected (512,)"
    dist = Tile.embedding.cosine_distance(vec)
    stmt = (
        select(
            Tile.id,
            func.ST_AsGeoJSON(Tile.bbox).label("bbox_json"),
            Tile.captured_at,
            (1 - dist).label("score"),
        )
        .order_by(dist)
        .limit(12)  # Global Constraint: LIMIT 12
    )
    return VectorSearchResponse(results=[_row_to_result(row) for row in session.execute(stmt)])


@router.post("/search/bbox", response_model=VectorSearchResponse)
@limiter.limit("60/minute")
def search_bbox(
    request: Request,
    payload: BboxSearchRequest,
    user: User = Depends(verify_jwt),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> VectorSearchResponse:
    """Tiles intersecting the envelope, optionally cosine-ranked by `q`.

    Without `q` there is no similarity to score, so `score` is 0.0 for every
    row — a constant > 0 would win Task 19's union-by-id / max-score merge
    over a real vector score for the same tile. Results cap at 12 regardless
    of the requested limit (Global Constraint: LIMIT 12).
    """
    (w, s), (e, n) = payload.bbox
    limit = min(payload.limit, 12)  # Global Constraint: LIMIT 12
    spatial = func.ST_Intersects(Tile.bbox, func.ST_MakeEnvelope(w, s, e, n, 4326))
    cols = (
        Tile.id,
        func.ST_AsGeoJSON(Tile.bbox).label("bbox_json"),
        Tile.captured_at,
    )
    if payload.q is not None:
        vec = get_encoder(settings).encode_text(payload.q)
        assert vec.shape == (512,), f"encoder dim drift: got shape {vec.shape}, expected (512,)"
        dist = Tile.embedding.cosine_distance(vec)
        stmt = (
            select(*cols, (1 - dist).label("score"))
            .where(spatial)
            .order_by(dist)
            .limit(limit)
        )
    else:
        stmt = (
            select(*cols, literal(0.0).label("score"))
            .where(spatial)
            .order_by(Tile.captured_at.desc())
            .limit(limit)
        )
    return VectorSearchResponse(results=[_row_to_result(row) for row in session.execute(stmt)])
