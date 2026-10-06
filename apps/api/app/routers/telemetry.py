"""Telemetry endpoints — auth-protected placeholders until the real handlers land."""
from fastapi import APIRouter, Depends

from app.models import User
from app.security import verify_jwt

router = APIRouter(tags=["telemetry"])

@router.get("/telemetry/query")
def query_telemetry(user: User = Depends(verify_jwt)) -> dict:
    return {"stub": True}

@router.post("/telemetry/ingest")
def ingest_telemetry(user: User = Depends(verify_jwt)) -> dict:
    return {"stub": True}
