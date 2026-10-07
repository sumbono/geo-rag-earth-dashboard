"""Auth routes: login (password grant), refresh (rotation), session probe
(/auth/me), logout — JWT access + opaque refresh cookies."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import get_db
from app.deps import get_settings
from app.models import RefreshToken, User
from app.rate_limit import limiter
from app.security import (
    create_access_token,
    hash_password,
    mint_refresh_token,
    seed_user_if_missing,
    verify_jwt,
    verify_password,
)

router = APIRouter(tags=["auth"])

# Fixed dummy (cost 12) so an unknown username pays the same bcrypt cost as a
# wrong password on a real account — no username-enumeration timing oracle.
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))

def _set_auth_cookies(
    response: Response, settings: Settings, access_token: str, raw_refresh: str
) -> None:
    """Set the auth cookie pair — one definition of names, lifetimes, flags."""
    secure = settings.public_origin.startswith("https")
    response.set_cookie(
        "access_token", access_token,
        max_age=15 * 60, httponly=True, samesite="strict", secure=secure,
    )
    response.set_cookie(
        "refresh_token", raw_refresh,
        max_age=7 * 24 * 60 * 60, httponly=True, samesite="strict", secure=secure,
    )

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
    # only its SHA-256 hash (rotated one-time-use by /auth/refresh).
    raw_refresh, refresh_hash = mint_refresh_token()
    session.add(
        RefreshToken(
            user_uuid=user.id,
            token_hash=refresh_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
    )
    session.commit()

    _set_auth_cookies(response, settings, access_token, raw_refresh)
    return {"token_type": "bearer"}

def _clear_auth_cookies(response: Response, settings: Settings) -> None:
    """Delete both auth cookies — same names/flags/path as _set_auth_cookies,
    so the browser matches and drops the pair it was issued at login."""
    secure = settings.public_origin.startswith("https")
    for name in ("access_token", "refresh_token"):
        response.delete_cookie(name, httponly=True, samesite="strict", secure=secure)

@router.get("/auth/me")
def me(user: User = Depends(verify_jwt)) -> dict:
    """Who the access-token cookie says we are — the cheap, credential-free
    session probe the web AuthGuard runs when the dashboard mounts."""
    return {"username": user.username}

@router.post("/auth/logout")
def logout(
    request: Request,
    response: Response,
    user: User = Depends(verify_jwt),
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
) -> dict:
    """End the session: revoke the presented refresh row and clear both cookies.

    Guarded by verify_jwt — the plan's matrix makes only /auth/token and
    /auth/refresh public, so an anonymous call is 401 (same as /auth/me), not
    a silent cookie clear. Revocation is scoped to the logged-in user's row
    (hash match + user_uuid): possession of the presented token lets you kill
    it, never someone else's. Cookies are cleared regardless of whether a
    refresh cookie was presented, so a stale pair cannot linger.
    """
    raw = request.cookies.get("refresh_token")
    if raw:
        session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == hashlib.sha256(raw.encode()).hexdigest(),
                RefreshToken.user_uuid == user.id,
            )
            .values(revoked_at=datetime.now(timezone.utc))
        )
        session.commit()
    _clear_auth_cookies(response, settings)
    return {"ok": True}

@router.post("/auth/refresh")
@limiter.limit("5/minute")
def refresh(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
) -> dict:
    """Rotate the refresh cookie: exactly one use per token.

    Lookup is by SHA-256 hash of the cookie value. A token already used or
    revoked means it was replayed (stolen cookie / second use after rotation):
    the whole family — every refresh token for that user — is revoked and the
    request answered 401, so a rotated-away token an attacker may hold dies
    too. On success the old row is marked used and a brand-new refresh token
    (7d) plus a fresh access token (15min) are set as cookies.
    """
    now = datetime.now(timezone.utc)
    raw = request.cookies.get("refresh_token")
    row = None
    if raw:
        row = session.scalar(
            select(RefreshToken).where(
                RefreshToken.token_hash == hashlib.sha256(raw.encode()).hexdigest()
            )
        )
    if row is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if row.used_at is not None or row.revoked_at is not None:
        # Reuse detection (R10): the presented token is spent, so every
        # refresh token for this user is suspect — revoke the whole family
        # (no family column; user_uuid scopes it), then reject.
        session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_uuid == row.user_uuid,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        session.commit()
        raise HTTPException(status_code=401, detail="Not authenticated")
    if row.expires_at <= now:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = session.get(User, row.user_uuid)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    row.used_at = now
    raw_new, refresh_hash = mint_refresh_token()
    session.add(
        RefreshToken(
            user_uuid=user.id,
            token_hash=refresh_hash,
            expires_at=now + timedelta(days=7),
        )
    )
    session.commit()

    _set_auth_cookies(response, settings, create_access_token(str(user.id), settings), raw_new)
    return {"token_type": "bearer"}
