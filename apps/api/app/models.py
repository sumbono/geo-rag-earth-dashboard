import uuid
from uuid import UUID
from datetime import datetime
from sqlalchemy import String, DateTime, Float, Text, PrimaryKeyConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from geoalchemy2 import Geometry
from pgvector.sqlalchemy import Vector
from app.db import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    # annotation uses `UUID` (not `uuid.UUID`): the class attr name `uuid`
    # shadows the module after the RHS is stored (CPython evaluates value
    # before annotation), which would raise AttributeError at class creation.
    uuid: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_uuid: Mapped[UUID] = mapped_column(Uuid, nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class Tile(Base):
    __tablename__ = "tiles"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    bbox = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    embedding = mapped_column(Vector(512), nullable=False)
    thumb_path: Mapped[str] = mapped_column(String(512), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

class Telemetry(Base):
    __tablename__ = "telemetry"
    buoy_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(16), nullable=False)
