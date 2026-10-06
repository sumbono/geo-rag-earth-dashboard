"""Login: password grant -> JWT access + opaque refresh cookies."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import get_db
from app.deps import get_settings
from app.models import RefreshToken, User
from app.rate_limit import limiter
from app.security import create_access_token, hash_password, seed_user_if_missing, verify_password

router = APIRouter(tags=["auth"])

# Fixed dummy (cost 12) so an unknown username pays the same bcrypt cost as a
# wrong password on a real account — no username-enumeration timing oracle.
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))

@router.post("/auth/token")
@limiter.limit("5/minute")
def login(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
) -> dict:
    seed_user_if_missing(settings, session)
    user = session.scalar(select(User).where(User.username == form_data.username))
    # Verify unconditionally (dummy hash when the user is missing) so both
    # branches pay the same bcrypt cost before the identical 401.
    stored_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    valid = verify_password(form_data.password, stored_hash)
    if user is None or not valid:
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    access_token = create_access_token(str(user.id), settings)

    # Opaque refresh token: the cookie carries the raw value, the DB stores
    # only its SHA-256 hash (a later /auth/refresh endpoint rotates it).
    raw_refresh = secrets.token_urlsafe(32)
    session.add(
        RefreshToken(
            user_uuid=user.id,
            token_hash=hashlib.sha256(raw_refresh.encode()).hexdigest(),
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
    )
    session.commit()

    secure = settings.public_origin.startswith("https")
    response.set_cookie(
        "access_token", access_token,
        max_age=15 * 60, httponly=True, samesite="strict", secure=secure,
    )
    response.set_cookie(
        "refresh_token", raw_refresh,
        max_age=7 * 24 * 60 * 60, httponly=True, samesite="strict", secure=secure,
    )
    return {"token_type": "bearer"}
