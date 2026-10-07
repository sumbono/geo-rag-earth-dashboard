from sqlalchemy import create_engine, text

import app.models  # noqa: F401
from app.db import Base


def init_db(url: str) -> None:
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    engine.dispose()
