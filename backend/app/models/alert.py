from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime, timezone

from backend.app.database.connection import Base


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    plate_number = Column(String, index=True, nullable=False)
    message = Column(String, nullable=False)
    camera_id = Column(String, nullable=True)
    timestamp = Column(DateTime, default=_utcnow, index=True)
