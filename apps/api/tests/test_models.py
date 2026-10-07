import pytest
import sqlalchemy as sa


@pytest.mark.db
def test_tables_create_and_user_roundtrip(engine_session, settings):
    import uuid as uuid_mod

    from app.models import User
    s = engine_session
    u = User(id=uuid_mod.uuid4(), username="t-user", password_hash="x")
    s.add(u); s.commit()
    got = s.query(User).filter_by(username="t-user").one()
    assert got.id == u.id


@pytest.mark.db
def test_get_db_yields_connected_session():
    from app.db import get_db
    gen = get_db()
    session = next(gen)
    try:
        assert session.execute(sa.text("SELECT 1")).scalar() == 1
    finally:
        gen.close()
