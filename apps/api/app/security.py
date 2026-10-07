"""Password hashing, JWT/refresh-token minting, the verify_jwt dependency, and the demo-user seed."""
import hashlib
import logging
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

logger = logging.getLogger(__name__)

# bcrypt's hard input cap (spec §6): the Python binding raises ValueError for
# inputs over 72 BYTES (UTF-8, not characters) — it never silently truncates.
BCRYPT_MAX_PASSWORD_BYTES = 72

def hash_password(pw: str) -> str:
    """Hash with bcrypt cost 12. Raises ValueError (caught only at seed time,
    as a config error → clear 500) when the input exceeds 72 bytes — login
    never hashes caller-supplied passwords, only verifies them."""
    data = pw.encode("utf-8")
    if len(data) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError(
            f"password is {len(data)} bytes; bcrypt accepts at most "
            f"{BCRYPT_MAX_PASSWORD_BYTES} bytes — shorten it "
            "(e.g. DEMO_PASSWORD for the seed user)"
        )
    return bcrypt.hashpw(data, bcrypt.gensalt(rounds=12)).decode("utf-8")

def verify_password(pw: str, h: str) -> bool:
    """True only for an exact match. An over-72-byte password (bcrypt raises
    ValueError) or a malformed stored hash is a FAILED match, never a server
    error: the login route answers 401 for bad credentials (spec §6/§7), so
    this must not raise."""
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))
    except ValueError:
        return False

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
    """Insert the demo user (bcrypt cost 12) when it does not exist yet.

    The ONLY place a >72-byte password can raise: DEMO_PASSWORD is operator
    config, so a too-long value is a configuration error, not a credential
    failure — log it loudly and answer a clear 500-class message. This runs
    before verification only while the seed row is missing; once the user
    exists, logins with any password length go through `verify_password`
    → 401, never here.
    """
    user = session.scalar(select(User).where(User.username == settings.demo_user))
    if user is None:
        try:
            password_hash = hash_password(settings.demo_password)
        except ValueError as exc:
            logger.error(
                "cannot seed demo user %r: %s "
                "(fix the DEMO_PASSWORD environment variable and restart)",
                settings.demo_user,
                exc,
            )
            raise HTTPException(
                status_code=500,
                detail=f"Seed configuration error: {exc}",
            ) from exc
        user = User(
            username=settings.demo_user,
            password_hash=password_hash,
        )
        session.add(user)
        session.commit()
    return user
