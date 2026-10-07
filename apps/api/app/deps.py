"""Shared FastAPI dependencies."""
from fastapi import Request

from app.config import Settings


def get_settings(request: Request) -> Settings:
    """Settings injected by create_app (app.state.settings)."""
    return request.app.state.settings
