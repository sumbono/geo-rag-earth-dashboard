from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

class Base(DeclarativeBase): pass

def make_engine(url: str):
    return create_engine(url, pool_pre_ping=True)

def make_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

_session_factories: dict[str, sessionmaker] = {}

def _session_factory_for(url: str) -> sessionmaker:
    # One engine (connection pool) per database URL, created on first use.
    if url not in _session_factories:
        _session_factories[url] = make_session_factory(make_engine(url))
    return _session_factories[url]

def get_db() -> Iterator[Session]:
    """FastAPI dependency: yield a Session for request handling."""
    from app.config import Settings
    session = _session_factory_for(Settings().database_url)()
    try:
        yield session
    finally:
        session.close()
