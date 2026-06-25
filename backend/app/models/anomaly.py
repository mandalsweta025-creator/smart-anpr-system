from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, Text

from backend.app.database.connection import Base


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AnomalyEvent(Base):
    __tablename__ = "anomaly_events"

    id              = Column(Integer, primary_key=True, index=True)
    anomaly_type    = Column(String(60),  nullable=False, index=True)
    severity        = Column(String(20),  nullable=False, index=True)   # CRITICAL/HIGH/MEDIUM/LOW
    plate_number    = Column(String(20),  nullable=True,  index=True)
    camera_id       = Column(String(50),  nullable=True)
    description     = Column(String(255), nullable=False)
    details         = Column(Text,        nullable=True)                # JSON extra context
    status          = Column(String(20),  nullable=False, default="OPEN", index=True)
    # OPEN / ACKNOWLEDGED / RESOLVED / FALSE_POSITIVE
    acknowledged_by = Column(String(100), nullable=True)
    acknowledged_at = Column(DateTime,    nullable=True)
    session_id      = Column(Integer,     nullable=True)
    created_at      = Column(DateTime,    default=_utcnow, index=True)
