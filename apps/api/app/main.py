from fastapi import FastAPI
from app.config import Settings
from app.routers import health

def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Geo-RAG Earth Dashboard API")
    app.state.settings = settings
    app.include_router(health.router)
    return app
