"""
Database Connection Layer
=========================
Handles SQLite connection and session management for ANPR system.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from backend.app.core.config import DATABASE_URL

_is_sqlite = DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    # SQLite: single writer, so we just add a write-lock timeout so concurrent
    # ANPR threads don't crash with "database is locked" under multi-camera load.
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False, "timeout": 10},
    )
else:
    # PostgreSQL (or other): use a connection pool so 6 concurrent ANPR threads
    # don't exhaust connections.
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,   # drops stale connections before use
    )

# Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base class for ORM models
Base = declarative_base()


def get_db():
    """
    Dependency function for FastAPI routes.
    Provides DB session and ensures proper closure.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
