"""Database engine, session and Base (Sprint 16).

SQLAlchemy 2.0. The engine is built from settings.database_url so the
same code runs on SQLite today and PostgreSQL later. `init_db()` creates
all tables (idempotent) and seeds the local development user.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings

settings = get_settings()

# check_same_thread is a SQLite-only quirk (FastAPI uses multiple threads).
connect_args = {"check_same_thread": False} if settings.is_sqlite else {}
engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables (safe to call repeatedly) and seed the dev user."""
    from . import models  # noqa: F401 — ensure every model is registered
    Base.metadata.create_all(bind=engine)
    from .services.seed import ensure_dev_user
    db = SessionLocal()
    try:
        ensure_dev_user(db)
    finally:
        db.close()
