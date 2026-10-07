"""slowapi limiter: 5/min on POST /auth/token (and later /auth/refresh);
other API routers attach 60/min when they are added."""
from fastapi import FastAPI
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import Settings

limiter = Limiter(
    key_func=get_remote_address,
    enabled=Settings().rate_limit_enabled,
)

def install_rate_limit(app: FastAPI, settings: Settings) -> None:
    """Attach the shared limiter to an app instance.

    Route decorators bind to this process-wide limiter at import time, so the
    enabled flag is re-synced from each app's settings here (tests toggle it
    per app). FastAPI's exception handler needs `app.state.limiter`.
    """
    limiter.enabled = settings.rate_limit_enabled
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
