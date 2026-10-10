"""Vector search over Tile embeddings (pgvector cosine distance) + bbox search (PostGIS envelope)."""
import json
import math
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
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


def _validate_polygon(points: list) -> list:
    """Return a normalized closed ring or raise 422 (Review Focus #1)."""
    if not isinstance(points, list) or len(points) < 3 or len(points) > 64:
        raise HTTPException(status_code=422, detail="polygon must have 3 to 64 points")
    ring: list[list[float]] = []
    for point in points:
        if (
            not isinstance(point, (list, tuple))
            or len(point) != 2
            or not all(isinstance(c, (int, float)) and math.isfinite(c) for c in point)
        ):
            raise HTTPException(status_code=422, detail="each point must be [lon, lat] numbers")
        lon, lat = float(point[0]), float(point[1])
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise HTTPException(status_code=422, detail="coordinates out of bounds")
        ring.append([lon, lat])
    if ring[0] == ring[-1]:
        ring = ring[:-1]  # duplicate closing vertex normalized away
    if len(ring) < 3:
        raise HTTPException(status_code=422, detail="polygon must have 3 to 64 points")
    # shoelace — zero area (collinear or degenerate) is a user mistake, not a 500
    area = abs(
        sum(
            ring[i][0] * ring[(i + 1) % len(ring)][1]
            - ring[(i + 1) % len(ring)][0] * ring[i][1]
            for i in range(len(ring))
        )
    ) / 2.0
    if area <= 1e-12:
        raise HTTPException(status_code=422, detail="polygon has no area")
    return ring


class PolygonSearchRequest(BaseModel):
    """`{"polygon": [[lon, lat], ...], "q": str | null, "limit": int = 12}`.

    `limit` is validated by the model alone (ge=1, le=12 → out-of-range is a
    422; there is NO separate clamp — finding 28's single mechanism).
    """
    polygon: list
    q: str | None = None
    limit: int = Field(default=12, ge=1, le=12)


@router.post("/search/polygon", response_model=VectorSearchResponse)
@limiter.limit("60/minute")
def search_polygon(
    request: Request,
    payload: PolygonSearchRequest,
    user: User = Depends(verify_jwt),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> VectorSearchResponse:
    """Tiles intersecting a client-drawn ring, optionally cosine-ranked by `q`.

    The ring is validated here (3–64 finite in-bounds points, non-zero
    shoelace area; a duplicate closing vertex is normalized away; GEOS
    ST_IsValid rejects self-intersecting bow-ties with 422), closed,
    and handed to PostGIS as WKT. Without `q` there is no similarity to score,
    so `score` is 0.0 for every row — identical to /search/bbox no-q mode.
    Results cap at 12 regardless of the requested limit (Global Constraint).
    """
    ring = _validate_polygon(payload.polygon)
    wkt = (
        "POLYGON(("
        + ", ".join(f"{lon} {lat}" for lon, lat in ring)
        + f", {ring[0][0]} {ring[0][1]}))"  # closed
    )
    poly = func.ST_GeomFromText(wkt, 4326)  # func pattern — no geoalchemy2 symbol imports (finding 19)
    # Bow-tie / self-intersecting rings have non-zero shoelace area but fail
    # GEOS validity; reject 422 before ST_Intersects (which can 500 or silently
    # accept on some builds). ST_IsValid is the GEOS check — no shapely dep.
    if not session.execute(select(func.ST_IsValid(poly))).scalar():
        raise HTTPException(status_code=422, detail="polygon is self-intersecting")
    spatial = func.ST_Intersects(Tile.bbox, poly)
    limit = min(payload.limit, 12)  # Global Constraint: LIMIT 12
    cols = (
        Tile.id,
        func.ST_AsGeoJSON(Tile.bbox).label("bbox_json"),
        Tile.captured_at,
    )
    if payload.q:
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
