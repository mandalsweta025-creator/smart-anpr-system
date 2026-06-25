from pydantic import BaseModel, field_serializer
from datetime import datetime, timezone
from typing import Optional


def _utc_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class DetectionResponse(BaseModel):

    id: int
    plate_number: str
    confidence: float
    image_path: Optional[str] = None
    timestamp: datetime
    # Phase 2 fields (nullable for older rows)
    camera_id:   Optional[str] = None
    orientation: Optional[str] = None
    event_type:  Optional[str] = None

    class Config:
        from_attributes = True

    @field_serializer("timestamp")
    def serialize_timestamp(self, dt: datetime) -> str:
        return _utc_iso(dt)


class VehicleSessionResponse(BaseModel):

    id: int
    plate_number: str
    entry_time: datetime
    exit_time: Optional[datetime] = None
    duration_minutes: Optional[float] = None
    status: str
    snapshot_path: Optional[str] = None
    # Phase 2 fields
    camera_id:      Optional[str] = None
    exit_camera_id: Optional[str] = None

    class Config:
        from_attributes = True

    @field_serializer("entry_time")
    def serialize_entry(self, dt: datetime) -> str:
        return _utc_iso(dt)

    @field_serializer("exit_time")
    def serialize_exit(self, dt: Optional[datetime]) -> Optional[str]:
        return _utc_iso(dt)