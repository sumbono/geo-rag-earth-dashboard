"""Password hashing, JWT/refresh-token minting, the verify_jwt dependency, and the demo-user seed."""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import get_db
from app.deps import get_settings
from app.models import User


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

def verify_password(pw: str, h: str) -> bool:
    return bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))

def create_access_token(sub: str, settings: Settings) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=15)
    return jwt.encode({"sub": sub, "exp": exp}, settings.jwt_secret, algorithm="HS256")

def mint_refresh_token() -> tuple[str, str]:
    """A fresh one-time opaque refresh token: (raw value for the cookie,
    SHA-256 hex digest — the only form stored in refresh_tokens.token_hash)."""
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode()).hexdigest()

def verify_jwt(
    request: Request,
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
) -> User:
    """Authorize the request from the `access_token` cookie → the User row.

    Missing cookie, bad signature, expired token, malformed/absent `sub`, or a
    `sub` with no matching `users` row (deleted user) → 401, same detail as
    every other auth failure.
    """
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        user_id = uuid.UUID(payload["sub"])  # sub is str(users.id)
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Not authenticated") from None
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

def seed_user_if_missing(settings: Settings, session: Session) -> User:
    """Insert the demo user (bcrypt cost 12) when it does not exist yet."""
    user = session.scalar(select(User).where(User.username == settings.demo_user))
    if user is None:
        user = User(
            username=settings.demo_user,
            password_hash=hash_password(settings.demo_password),
        )
        session.add(user)
        session.commit()
    return user
