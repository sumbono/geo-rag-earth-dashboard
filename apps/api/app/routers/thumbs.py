"""Traversal-safe JPEG thumbnail serving behind the shared JWT guard.

Review Focus #5 — containment: the filename is built from a validated uuid
only, yet the candidate path is still `resolve()`d (follows `..` and symlinks)
and must be `is_relative_to` the resolved THUMBS_DIR — defense in depth so no
future filename change can escape the thumb directory.
"""
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response

from app.config import Settings
from app.deps import get_settings
from app.models import User
from app.security import verify_jwt

router = APIRouter(tags=["thumbs"])


def _resolve_in(root: Path, filename: str) -> Path | None:
    """Resolve `filename` under `root`; None when the resolved path escapes `root`."""
    resolved_root = root.resolve()
    candidate = (resolved_root / filename).resolve()
    return candidate if candidate.is_relative_to(resolved_root) else None


@router.get("/thumbs/{tile_id}")
def get_thumb(
    tile_id: str,
    fc: bool = False,
    user: User = Depends(verify_jwt),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Serve `{tile_id}.jpg`, or `{tile_id}_fc.jpg` (false color) with `?fc=1`.

    404: non-uuid `tile_id` (no file is ever touched), missing file, or a
    resolved path outside THUMBS_DIR. No rate limiter — static file serving.
    """
    try:
        uuid.UUID(tile_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not Found") from None
    # THUMBS_DIR is read live: app.state.settings is built at startup, so an
    # env override applied afterwards (runtime config; tests' tmp_thumbs
    # fixture) must still take effect; the injected setting is the fallback.
    root = Path(os.environ.get("THUMBS_DIR") or settings.thumbs_dir)
    path = _resolve_in(root, f"{tile_id}{'_fc' if fc else ''}.jpg")
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Not Found")
    return Response(content=path.read_bytes(), media_type="image/jpeg")
