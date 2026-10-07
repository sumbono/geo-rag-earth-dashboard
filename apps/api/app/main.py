from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import Settings
from app.init_db import init_db
from app.rate_limit import install_rate_limit
from app.routers import auth, health, search, telemetry, thumbs

MAX_BODY_BYTES = 65536  # 64 KB global request-body cap

def create_app(settings: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(settings.database_url)
        yield

    app = FastAPI(title="Geo-RAG Earth Dashboard API", lifespan=lifespan)
    app.state.settings = settings

    @app.middleware("http")
    async def body_size_limit(request: Request, call_next):
        """One global 413 for bodies over 64 KB — covers every route, not just
        telemetry ingest. Header-based by design (the spec's cap is on
        Content-Length): a chunked body without one falls through to normal
        parsing, as does a malformed header (never a 500 from here)."""
        raw = request.headers.get("content-length", "0")
        if raw.isdigit() and int(raw) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "payload too large"}, status_code=413)
        return await call_next(request)

    install_rate_limit(app, settings)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(search.router)
    app.include_router(telemetry.router)
    app.include_router(thumbs.router)
    return app


# Module-level entrypoint for uvicorn (`app.main:app`, as in the Dockerfile
# CMD). `create_app` stays the injectable factory tests call directly — this
# line only gives the server process an app built from the ambient Settings.
app = create_app(Settings())
