
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# ==========================================
# VEHICLE RESPONSE — matches current DB model
# ==========================================

class VehicleResponse(BaseModel):
    """Matches the Vehicle ORM model fields exactly."""

    id: int
    plate_number: str
    owner_name: Optional[str] = None
    vehicle_type: Optional[str] = None
    is_authorized: bool = True
    is_blacklisted: bool = False

    class Config:
        from_attributes = True


# ==========================================
# VEHICLE FULL SCHEMA (future extended model)
# ==========================================

class VehicleSchema(BaseModel):
    """Extended schema — add columns to Vehicle model before using this."""

    id: int

    # ======================================
    # BASIC VEHICLE INFO
    # ======================================

    plate_number: str
    owner_name: str | None
    vehicle_type: str | None
    vehicle_category: str

    # ======================================
    # ORGANIZATION DETAILS
    # ======================================

    department: str | None
    company_name: str | None
    contact_number: str | None

    # ======================================
    # ACCESS CONTROL
    # ======================================

    is_authorized: bool
    is_blacklisted: bool

    # ======================================
    # VALIDITY
    # ======================================

    valid_from: datetime
    valid_until: datetime | None

    # ======================================
    # EXTRA NOTES
    # ======================================

    notes: str | None

    class Config:

        from_attributes = True