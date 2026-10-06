"""Vector search over Tile embeddings (pgvector cosine distance) — bbox stays a stub (Task 8)."""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
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
    results = [
        SearchResult(
            id=str(row.id),
            thumb_url=f"/api/thumbs/{row.id}",
            bbox=json.loads(row.bbox_json)["coordinates"],
            score=float(row.score),
            captured_at=row.captured_at,
        )
        for row in session.execute(stmt)
    ]
    return VectorSearchResponse(results=results)


@router.post("/search/bbox")
def search_bbox(user: User = Depends(verify_jwt)) -> dict:
    return {"stub": True}
