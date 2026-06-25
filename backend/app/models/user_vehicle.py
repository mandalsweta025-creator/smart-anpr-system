from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint, ForeignKey
from datetime import datetime, timezone
from backend.app.database.connection import Base


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class UserVehicle(Base):
    """Ownership link: a registered user claims one or more plate numbers."""

    __tablename__ = "user_vehicles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plate_number = Column(String, nullable=False, index=True)
    owner_name = Column(String, nullable=True)
    phone_number = Column(String, nullable=True)
    vehicle_type = Column(String, nullable=True)
    registration_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "plate_number", name="uq_user_plate"),
    )
