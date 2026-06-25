from sqlalchemy import Column, Integer, String, Boolean
from backend.app.database.connection import Base


class Vehicle(Base):

    __tablename__ = "vehicles"

    id = Column(Integer, primary_key=True, index=True)
    plate_number = Column(String, unique=True, nullable=False, index=True)
    owner_name = Column(String, nullable=True)
    vehicle_type = Column(String, nullable=True)
    is_authorized = Column(Boolean, default=True)
    is_blacklisted = Column(Boolean, default=False)
    is_watchlisted = Column(Boolean, default=False, server_default="0")
    watchlist_reason = Column(String, nullable=True)