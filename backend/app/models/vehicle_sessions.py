from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime
)

from datetime import datetime, timezone

from backend.app.database.connection import Base


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class VehicleSession(Base):

    __tablename__ = "vehicle_sessions"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    plate_number = Column(
        String,
        nullable=False,
        index=True
    )

    entry_time = Column(
        DateTime,
        default=_utcnow,
    )

    exit_time = Column(
        DateTime,
        nullable=True,
        index=True,
    )

    duration_minutes = Column(
        Float,
        nullable=True
    )

    status = Column(
        String,
        default="ENTERED",
        index=True,
    )

    snapshot_path   = Column(String, nullable=True)

    # Added in Phase 2 — directional entry/exit support
    camera_id       = Column(String, nullable=True)   # entry camera
    exit_camera_id  = Column(String, nullable=True)   # exit camera (if different)