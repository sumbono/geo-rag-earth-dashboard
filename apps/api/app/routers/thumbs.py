"""Thumbnail endpoint — auth-protected placeholder until the real handler lands."""
import uuid

from fastapi import APIRouter, Depends

from app.models import User
from app.security import verify_jwt

router = APIRouter(tags=["thumbs"])

@router.get("/thumbs/{thumb_id}")
def get_thumb(thumb_id: uuid.UUID, user: User = Depends(verify_jwt)) -> dict:
    return {"stub": True}
