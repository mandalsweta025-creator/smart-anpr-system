"""
Detection Database Model
========================
Stores ANPR vehicle detection records.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
)
from datetime import datetime, timezone

from backend.app.database.connection import Base


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Detection(Base):
    """
    Database model for ANPR detections.
    """

    __tablename__ = "detections"

    id = Column(Integer, primary_key=True, index=True)

    plate_number = Column(String, index=True, nullable=False)
    confidence   = Column(Float, default=0.0)
    image_path   = Column(String, nullable=True)
    timestamp    = Column(DateTime, default=_utcnow, index=True)

    # Added in Phase 2 — directional entry/exit support
    camera_id    = Column(String, nullable=True, index=True)
    orientation  = Column(String, nullable=True, default="UNKNOWN")  # FRONT | REAR | UNKNOWN
    event_type   = Column(String, nullable=True, default="DETECTION")  # ENTRY | EXIT | DETECTION
