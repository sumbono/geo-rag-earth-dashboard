from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.config import Settings
from app.init_db import init_db
from app.routers import health

def create_app(settings: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(settings.database_url)
        yield

    app = FastAPI(title="Geo-RAG Earth Dashboard API", lifespan=lifespan)
    app.state.settings = settings
    app.include_router(health.router)
    return app
