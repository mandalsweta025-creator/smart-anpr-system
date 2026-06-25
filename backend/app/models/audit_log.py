from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, Text

from backend.app.database.connection import Base


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id            = Column(Integer,  primary_key=True, index=True)
    username      = Column(String(100), nullable=True,  index=True)
    action        = Column(String(60),  nullable=False, index=True)
    # e.g. LOGIN, LOGOUT, CAMERA_START, CAMERA_STOP,
    #      BLACKLIST_ADD, BLACKLIST_REMOVE,
    #      USER_CREATE, USER_DELETE, USER_ROLE_CHANGE,
    #      ANOMALY_ACK, ANOMALY_RESOLVE, ANOMALY_FP
    resource_type = Column(String(40),  nullable=True)   # plate / camera / user / anomaly
    resource_id   = Column(String(120), nullable=True)   # the key value
    details       = Column(Text,        nullable=True)   # JSON extra context
    ip_address    = Column(String(45),  nullable=True)
    created_at    = Column(DateTime,    default=_utcnow, index=True)
