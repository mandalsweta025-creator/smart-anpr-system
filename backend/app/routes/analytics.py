from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.database.connection import SessionLocal
from backend.app.models.detections import Detection
from backend.app.models.vehicle_sessions import VehicleSession

router = APIRouter()


def _naive_utc_now() -> datetime:
    """Naive UTC datetime — matches what SQLite actually stores."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("/analytics/hourly")
def get_hourly_detections(days: int = Query(1, ge=1, le=30)):
    db: Session = SessionLocal()
    try:
        since = _naive_utc_now() - timedelta(days=days)
        rows = db.query(Detection).filter(Detection.timestamp >= since).all()

        if days == 1:
            counts: dict = {}
            for d in rows:
                ts = d.timestamp.replace(tzinfo=None) if d.timestamp.tzinfo else d.timestamp
                counts[ts.hour] = counts.get(ts.hour, 0) + 1
            return [{"hour": h, "label": f"{h:02d}h", "count": counts.get(h, 0)} for h in range(24)]

        # Multi-day: one bucket per calendar day, oldest first
        counts: dict = {}
        for d in rows:
            ts = d.timestamp.replace(tzinfo=None) if d.timestamp.tzinfo else d.timestamp
            key = ts.strftime("%d/%m")
            counts[key] = counts.get(key, 0) + 1

        result = []
        for i in range(days - 1, -1, -1):
            day = _naive_utc_now() - timedelta(days=i)
            label = day.strftime("%d/%m")
            result.append({"hour": i, "label": label, "count": counts.get(label, 0)})
        return result

    finally:
        db.close()


@router.get("/analytics/flow")
def get_vehicle_flow():
    """
    Entries, exits, and occupancy for today.

    Uses event_type column when populated (Phase 2 cameras); falls back to
    session counts for legacy data so the endpoint always returns useful data.
    """
    db: Session = SessionLocal()
    try:
        today_start = _naive_utc_now().replace(hour=0, minute=0, second=0, microsecond=0)

        # Count ENTRY and EXIT event_type detections today
        entries_det = (
            db.query(func.count(Detection.id))
            .filter(Detection.timestamp >= today_start, Detection.event_type == "ENTRY")
            .scalar() or 0
        )
        exits_det = (
            db.query(func.count(Detection.id))
            .filter(Detection.timestamp >= today_start, Detection.event_type == "EXIT")
            .scalar() or 0
        )

        # Fallback: if no event_type data, count sessions
        sessions_entered_today = (
            db.query(func.count(VehicleSession.id))
            .filter(VehicleSession.entry_time >= today_start)
            .scalar() or 0
        )
        sessions_exited_today = (
            db.query(func.count(VehicleSession.id))
            .filter(
                VehicleSession.exit_time >= today_start,
                VehicleSession.status == "EXITED",
            )
            .scalar() or 0
        )

        entries = entries_det or sessions_entered_today
        exits   = exits_det   or sessions_exited_today

        # Occupancy = currently ENTERED sessions
        occupancy = (
            db.query(func.count(VehicleSession.id))
            .filter(VehicleSession.status == "ENTERED")
            .scalar() or 0
        )

        # Average dwell time (minutes) for sessions that exited today
        avg_dwell_row = (
            db.query(func.avg(VehicleSession.duration_minutes))
            .filter(
                VehicleSession.exit_time >= today_start,
                VehicleSession.status == "EXITED",
                VehicleSession.duration_minutes.isnot(None),
            )
            .scalar()
        )

        return {
            "entries_today":     entries,
            "exits_today":       exits,
            "occupancy":         occupancy,
            "avg_dwell_minutes": round(avg_dwell_row, 1) if avg_dwell_row else None,
        }
    finally:
        db.close()


@router.get("/analytics/heatmap")
def get_heatmap(days: int = Query(28, ge=1, le=90)):
    """
    Returns a 7×24 detection-count grid (day-of-week × hour-of-day).
    day 0 = Monday … 6 = Sunday  (ISO weekday - 1).
    Used to render the traffic heatmap in the analytics dashboard.
    """
    db: Session = SessionLocal()
    try:
        since = _naive_utc_now() - timedelta(days=days)
        rows  = db.query(Detection.timestamp).filter(Detection.timestamp >= since).all()

        # Build 7×24 grid
        grid: dict[tuple[int, int], int] = {}
        for (ts,) in rows:
            if ts is None:
                continue
            t = ts.replace(tzinfo=None) if getattr(ts, "tzinfo", None) else ts
            dow  = t.weekday()   # 0=Mon … 6=Sun
            hour = t.hour
            grid[(dow, hour)] = grid.get((dow, hour), 0) + 1

        max_count = max(grid.values(), default=1)
        data = [
            {"day": dow, "hour": hour, "count": cnt}
            for (dow, hour), cnt in grid.items()
        ]
        return {"data": data, "max_count": max_count, "days": days}
    finally:
        db.close()


@router.get("/analytics/occupancy")
def get_occupancy():
    """Current occupancy + capacity utilisation for the dashboard gauge."""
    from backend.app.core.config import MAX_CAPACITY
    db: Session = SessionLocal()
    try:
        current = (
            db.query(func.count(VehicleSession.id))
            .filter(VehicleSession.status == "ENTERED")
            .scalar() or 0
        )
        pct = round((current / MAX_CAPACITY) * 100, 1) if MAX_CAPACITY > 0 else None
        return {
            "current":      current,
            "max_capacity": MAX_CAPACITY,
            "percent":      pct,
            "status":       (
                "critical" if pct and pct >= 90 else
                "warning"  if pct and pct >= 75 else
                "normal"
            ),
        }
    finally:
        db.close()


@router.get("/analytics/dwell")
def get_dwell_distribution(days: int = Query(7, ge=1, le=90)):
    """Dwell-time histogram: buckets 0–15 min, 15–30, 30–60, 1–2h, 2–4h, 4–8h, 8h+."""
    db: Session = SessionLocal()
    try:
        since = _naive_utc_now() - timedelta(days=days)
        rows = (
            db.query(VehicleSession.duration_minutes)
            .filter(
                VehicleSession.status == "EXITED",
                VehicleSession.exit_time >= since,
                VehicleSession.duration_minutes.isnot(None),
            )
            .all()
        )
        buckets = [
            {"label": "0–15 min",   "min": 0,    "max": 15,   "count": 0},
            {"label": "15–30 min",  "min": 15,   "max": 30,   "count": 0},
            {"label": "30–60 min",  "min": 30,   "max": 60,   "count": 0},
            {"label": "1–2 h",      "min": 60,   "max": 120,  "count": 0},
            {"label": "2–4 h",      "min": 120,  "max": 240,  "count": 0},
            {"label": "4–8 h",      "min": 240,  "max": 480,  "count": 0},
            {"label": "8 h+",       "min": 480,  "max": 99999,"count": 0},
        ]
        for (mins,) in rows:
            for b in buckets:
                if b["min"] <= mins < b["max"]:
                    b["count"] += 1
                    break
        return buckets
    finally:
        db.close()


@router.get("/analytics/by-camera")
def get_by_camera(days: int = Query(7, ge=1, le=90)):
    """Detection counts grouped by camera_id for the given window."""
    db: Session = SessionLocal()
    try:
        since = _naive_utc_now() - timedelta(days=days)
        rows = (
            db.query(Detection.camera_id, func.count(Detection.id).label("count"))
            .filter(Detection.timestamp >= since)
            .group_by(Detection.camera_id)
            .order_by(func.count(Detection.id).desc())
            .all()
        )
        total = sum(r.count for r in rows) or 1
        return [
            {
                "camera_id": r.camera_id or "unknown",
                "count": r.count,
                "pct": round(r.count / total * 100, 1),
            }
            for r in rows
        ]
    finally:
        db.close()


@router.get("/analytics/plates/top")
def get_top_plates(limit: int = Query(10, ge=1, le=50), days: int = Query(0, ge=0, le=365)):
    db: Session = SessionLocal()
    try:
        q = db.query(Detection.plate_number, func.count(Detection.id).label("count"))
        if days > 0:
            since = _naive_utc_now() - timedelta(days=days)
            q = q.filter(Detection.timestamp >= since)
        rows = (
            q.group_by(Detection.plate_number)
            .order_by(func.count(Detection.id).desc())
            .limit(limit)
            .all()
        )
        return [{"plate": r.plate_number, "count": r.count} for r in rows]
    finally:
        db.close()
