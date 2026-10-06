"""Search endpoints — auth-protected placeholders until the real handlers land."""
from fastapi import APIRouter, Depends

from app.models import User
from app.security import verify_jwt

router = APIRouter(tags=["search"])

@router.post("/search/vector")
def search_vector(user: User = Depends(verify_jwt)) -> dict:
    return {"stub": True}

@router.post("/search/bbox")
def search_bbox(user: User = Depends(verify_jwt)) -> dict:
    return {"stub": True}
