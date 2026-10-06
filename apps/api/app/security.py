"""Password hashing, JWT minting, and the demo-user seed."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

def verify_password(pw: str, h: str) -> bool:
    return bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))

def create_access_token(sub: str, settings: Settings) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=15)
    return jwt.encode({"sub": sub, "exp": exp}, settings.jwt_secret, algorithm="HS256")

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
