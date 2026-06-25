from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.schemas.detection_schema import DetectionResponse
from backend.app.database.connection import SessionLocal
from backend.app.models.detections import Detection
from backend.app.models.vehicle_sessions import VehicleSession
from backend.app.models.alert import Alert

router = APIRouter()


@router.get("/detections", response_model=list[DetectionResponse])
def get_detections(limit: int = Query(50, ge=1, le=500)):
    db: Session = SessionLocal()
    try:
        return (
            db.query(Detection)
            .order_by(Detection.timestamp.desc())
            .limit(limit)
            .all()
        )
    finally:
        db.close()


@router.get("/detections/search", response_model=list[DetectionResponse])
def search_detection_route(plate: str, limit: int = Query(20, ge=1, le=100)):
    db: Session = SessionLocal()
    try:
        return (
            db.query(Detection)
            .filter(Detection.plate_number.ilike(f"%{plate}%"))
            .order_by(Detection.timestamp.desc())
            .limit(limit)
            .all()
        )
    finally:
        db.close()


@router.get("/detections/count")
def count_detections():
    db: Session = SessionLocal()
    try:
        total = db.query(func.count(Detection.id)).scalar()
        return {"count": total or 0}
    finally:
        db.close()


@router.get("/detections/history/{plate}", response_model=list[DetectionResponse])
def get_vehicle_history(plate: str):
    db: Session = SessionLocal()
    try:
        return (
            db.query(Detection)
            .filter(Detection.plate_number == plate)
            .order_by(Detection.timestamp.desc())
            .all()
        )
    finally:
        db.close()


@router.get("/vehicles/{plate}/timeline")
def get_vehicle_timeline(
    plate: str,
    since: Optional[str] = Query(None, description="ISO 8601 start date, e.g. 2025-01-01"),
    until: Optional[str] = Query(None, description="ISO 8601 end date"),
    limit: int = Query(200, ge=1, le=1000),
):
    """
    Complete event timeline for a single plate number.

    Returns detections, sessions, and alerts sorted by time (newest first),
    combined into a unified event stream for the investigation view.
    """
    def _parse_dt(s: str | None) -> datetime | None:
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None

    since_dt = _parse_dt(since)
    until_dt = _parse_dt(until)

    def _utc_iso(dt: datetime | None) -> str | None:
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()

    db: Session = SessionLocal()
    try:
        # ── Detections ──────────────────────────────────────────
        dq = db.query(Detection).filter(Detection.plate_number == plate)
        if since_dt:
            dq = dq.filter(Detection.timestamp >= since_dt)
        if until_dt:
            dq = dq.filter(Detection.timestamp <= until_dt)
        detections = dq.order_by(Detection.timestamp.desc()).limit(limit).all()

        # ── Sessions ─────────────────────────────────────────────
        sq = db.query(VehicleSession).filter(VehicleSession.plate_number == plate)
        if since_dt:
            sq = sq.filter(VehicleSession.entry_time >= since_dt)
        sessions = sq.order_by(VehicleSession.entry_time.desc()).all()

        # ── Alerts ───────────────────────────────────────────────
        aq = db.query(Alert).filter(Alert.plate_number == plate)
        if since_dt:
            aq = aq.filter(Alert.timestamp >= since_dt)
        alerts = aq.order_by(Alert.timestamp.desc()).all()

        # ── First / last seen ────────────────────────────────────
        first_row = (
            db.query(Detection)
            .filter(Detection.plate_number == plate)
            .order_by(Detection.timestamp.asc())
            .first()
        )

        return {
            "plate": plate,
            "first_seen": _utc_iso(first_row.timestamp) if first_row else None,
            "last_seen":  _utc_iso(detections[0].timestamp) if detections else None,
            "total_detections": db.query(func.count(Detection.id))
                                   .filter(Detection.plate_number == plate).scalar(),
            "total_sessions":   len(sessions),
            "total_alerts":     len(alerts),
            "detections": [
                {
                    "id":          d.id,
                    "timestamp":   _utc_iso(d.timestamp),
                    "confidence":  d.confidence,
                    "camera_id":   d.camera_id,
                    "event_type":  d.event_type or "DETECTION",
                    "image_path":  d.image_path,
                }
                for d in detections
            ],
            "sessions": [
                {
                    "id":               s.id,
                    "entry_time":       _utc_iso(s.entry_time),
                    "exit_time":        _utc_iso(s.exit_time),
                    "duration_minutes": s.duration_minutes,
                    "status":           s.status,
                    "camera_id":        s.camera_id,
                    "exit_camera_id":   s.exit_camera_id,
                }
                for s in sessions
            ],
            "alerts": [
                {
                    "id":        a.id,
                    "timestamp": _utc_iso(a.timestamp),
                    "message":   a.message,
                    "camera_id": a.camera_id,
                }
                for a in alerts
            ],
        }
    finally:
        db.close()


# ── GET /detections/{plate}/snapshots ────────────────────────────────────────

@router.get("/detections/{plate_number}/snapshots")
def get_plate_snapshots(
    plate_number: str,
    limit:  int = Query(50, ge=1, le=200),
    offset: int = Query(0,  ge=0),
):
    """Return all saved snapshot paths for a given plate, newest first."""
    db: Session = SessionLocal()
    try:
        rows = (
            db.query(Detection)
            .filter(
                Detection.plate_number == plate_number,
                Detection.image_path.isnot(None),
                Detection.image_path != "",
            )
            .order_by(Detection.timestamp.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        total = (
            db.query(func.count(Detection.id))
            .filter(
                Detection.plate_number == plate_number,
                Detection.image_path.isnot(None),
                Detection.image_path != "",
            )
            .scalar()
        )
        return {
            "plate_number": plate_number,
            "total": total,
            "snapshots": [
                {
                    "id":         d.id,
                    "image_path": d.image_path,
                    "timestamp":  d.timestamp.isoformat() if d.timestamp else None,
                    "confidence": d.confidence,
                    "camera_id":  d.camera_id,
                    "event_type": d.event_type or "DETECTION",
                }
                for d in rows
            ],
        }
    finally:
        db.close()


# ── GET /search — cross-table fragment search ─────────────────────────────────

@router.get("/search")
def advanced_search(
    plate:    str | None = Query(None, description="Plate fragment (partial match)"),
    camera:   str | None = Query(None, description="Camera ID filter"),
    from_dt:  str | None = Query(None, alias="from",  description="ISO 8601 start datetime"),
    to_dt:    str | None = Query(None, alias="to",    description="ISO 8601 end datetime"),
    days:     int | None = Query(None, ge=1, le=365,  description="Last N days (overrides from/to)"),
    limit:    int        = Query(50,   ge=1, le=200),
    offset:   int        = Query(0,    ge=0),
):
    """
    Cross-table search across detections.

    Supports: partial plate fragment, camera filter, date range (from/to or last N days).
    Returns detections with associated snapshot URLs, sorted newest first.
    """
    def _parse(s: str | None) -> datetime | None:
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None

    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        since: datetime | None
        until: datetime | None

        if days is not None:
            since = now - timedelta(days=days)
            until = None
        else:
            since = _parse(from_dt)
            until = _parse(to_dt)

        q = db.query(Detection)
        if plate:
            q = q.filter(Detection.plate_number.ilike(f"%{plate.upper()}%"))
        if camera:
            q = q.filter(Detection.camera_id == camera)
        if since:
            q = q.filter(Detection.timestamp >= since)
        if until:
            q = q.filter(Detection.timestamp <= until)

        total = q.count()
        rows  = q.order_by(Detection.timestamp.desc()).offset(offset).limit(limit).all()

        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "results": [
                {
                    "id":          d.id,
                    "plate_number": d.plate_number,
                    "confidence":  d.confidence,
                    "camera_id":   d.camera_id,
                    "event_type":  d.event_type or "DETECTION",
                    "timestamp":   d.timestamp.isoformat() if d.timestamp else None,
                    "image_path":  d.image_path,
                }
                for d in rows
            ],
        }
    finally:
        db.close()
