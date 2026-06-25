"""Alembic environment for Smart ANPR System.

Reads DATABASE_URL from backend.app.core.config so SQLite (dev) and
PostgreSQL (prod) are both handled without editing this file.

Usage
-----
# Generate a migration after changing a model:
    venv/bin/alembic revision --autogenerate -m "describe what changed"

# Apply all pending migrations:
    venv/bin/alembic upgrade head

# Roll back one step:
    venv/bin/alembic downgrade -1

# Mark an existing database as already up-to-date (first setup on a live DB):
    venv/bin/alembic stamp head

# Show history:
    venv/bin/alembic history --verbose
"""

import sys
from pathlib import Path
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# Make the project root importable when running alembic from the repo root
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ── Project imports ──────────────────────────────────────────────────────────
from backend.app.core.config import DATABASE_URL
from backend.app.database.connection import Base

# Import every model so SQLAlchemy populates Base.metadata.
# Add new model modules here whenever a new table is created.
import backend.app.models.user             # noqa: F401
import backend.app.models.vehicle          # noqa: F401
import backend.app.models.vehicle_sessions # noqa: F401
import backend.app.models.detections       # noqa: F401
import backend.app.models.alert            # noqa: F401

# ── Alembic config ───────────────────────────────────────────────────────────
config = context.config
config.set_main_option("sqlalchemy.url", DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


# ── Offline mode (generates SQL without connecting) ──────────────────────────
def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online mode (connects and migrates) ──────────────────────────────────────
def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
