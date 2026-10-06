from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.config import Settings
from app.init_db import init_db
from app.rate_limit import install_rate_limit
from app.routers import auth, health, search, telemetry, thumbs

def create_app(settings: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(settings.database_url)
        yield

    app = FastAPI(title="Geo-RAG Earth Dashboard API", lifespan=lifespan)
    app.state.settings = settings
    install_rate_limit(app, settings)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(search.router)
    app.include_router(telemetry.router)
    app.include_router(thumbs.router)
    return app
