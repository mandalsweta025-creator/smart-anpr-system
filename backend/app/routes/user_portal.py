"""
User Portal API — /me/* endpoints

Every endpoint here filters data to the requesting user's owned plates.
Admins and operators bypass the portal via their normal admin routes;
these endpoints are designed for role='user' (vehicle owners).
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.core.security import get_current_user
from backend.app.database.connection import SessionLocal
from backend.app.models.user import User
from backend.app.models.user_vehicle import UserVehicle
from backend.app.models.vehicle_sessions import VehicleSession
from backend.app.models.detections import Detection

router = APIRouter(prefix="/me", tags=["portal"])


# ── Helpers ───────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _utc_iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _get_user(db: Session, username: str) -> User:
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _get_plates(db: Session, user_id: int) -> list[str]:
    """Return all plate numbers owned by this user."""
    rows = db.query(UserVehicle.plate_number).filter(UserVehicle.user_id == user_id).all()
    return [r.plate_number for r in rows]


# ── Request models ────────────────────────────────────────────

class VehicleRegisterRequest(BaseModel):
    plate_number: str
    owner_name: Optional[str] = None
    phone_number: Optional[str] = None
    vehicle_type: Optional[str] = None
    registration_date: Optional[str] = None   # ISO date string YYYY-MM-DD


class VehicleUpdateRequest(BaseModel):
    owner_name: Optional[str] = None
    phone_number: Optional[str] = None
    vehicle_type: Optional[str] = None


# ══════════════════════════════════════════════════════════════
#  VEHICLE MANAGEMENT
# ══════════════════════════════════════════════════════════════

@router.get("/vehicles")
def get_my_vehicles(current_user: dict = Depends(get_current_user)):
    """List all vehicles registered to the current user."""
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        vehicles = (
            db.query(UserVehicle)
            .filter(UserVehicle.user_id == user.id)
            .order_by(UserVehicle.created_at.desc())
            .all()
        )
        return [
            {
                "id": v.id,
                "plate_number": v.plate_number,
                "owner_name": v.owner_name,
                "phone_number": v.phone_number,
                "vehicle_type": v.vehicle_type,
                "registration_date": _utc_iso(v.registration_date),
                "created_at": _utc_iso(v.created_at),
            }
            for v in vehicles
        ]
    finally:
        db.close()


@router.post("/vehicles", status_code=status.HTTP_201_CREATED)
def register_my_vehicle(
    req: VehicleRegisterRequest,
    current_user: dict = Depends(get_current_user),
):
    """Link a plate number to the current user's account."""
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plate = req.plate_number.strip().upper()
        if not plate:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plate number required")

        existing = (
            db.query(UserVehicle)
            .filter(UserVehicle.user_id == user.id, UserVehicle.plate_number == plate)
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Vehicle already registered to your account",
            )

        reg_date = None
        if req.registration_date:
            try:
                reg_date = datetime.fromisoformat(req.registration_date).replace(tzinfo=None)
            except ValueError:
                pass

        vehicle = UserVehicle(
            user_id=user.id,
            plate_number=plate,
            owner_name=req.owner_name,
            phone_number=req.phone_number,
            vehicle_type=req.vehicle_type,
            registration_date=reg_date,
        )
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)
        return {
            "success": True,
            "id": vehicle.id,
            "plate_number": vehicle.plate_number,
        }
    finally:
        db.close()


@router.put("/vehicles/{plate}")
def update_my_vehicle(
    plate: str,
    req: VehicleUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plate = plate.strip().upper()
        vehicle = (
            db.query(UserVehicle)
            .filter(UserVehicle.user_id == user.id, UserVehicle.plate_number == plate)
            .first()
        )
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        if req.owner_name is not None:
            vehicle.owner_name = req.owner_name
        if req.phone_number is not None:
            vehicle.phone_number = req.phone_number
        if req.vehicle_type is not None:
            vehicle.vehicle_type = req.vehicle_type
        db.commit()
        return {"success": True}
    finally:
        db.close()


@router.delete("/vehicles/{plate}", status_code=status.HTTP_200_OK)
def remove_my_vehicle(plate: str, current_user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plate = plate.strip().upper()
        vehicle = (
            db.query(UserVehicle)
            .filter(UserVehicle.user_id == user.id, UserVehicle.plate_number == plate)
            .first()
        )
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        db.delete(vehicle)
        db.commit()
        return {"success": True}
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
#  DASHBOARD SUMMARY
# ══════════════════════════════════════════════════════════════

@router.get("/dashboard")
def get_my_dashboard(current_user: dict = Depends(get_current_user)):
    """
    Full summary for the user portal home page.
    Returns vehicle statuses, today's activity, and rolling stats.
    """
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plates = _get_plates(db, user.id)

        now = _utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = now - timedelta(days=7)
        month_start = now - timedelta(days=30)

        if not plates:
            return {
                "username": user.username,
                "email": user.email,
                "vehicles": [],
                "today_activity": [],
                "recent_visits": [],
                "stats": {
                    "total_visits_today": 0,
                    "total_visits_week": 0,
                    "total_visits_month": 0,
                    "total_duration_month_min": 0,
                    "active_now": 0,
                },
            }

        # ── Per-vehicle live status ──────────────────────────
        user_vehicles = (
            db.query(UserVehicle)
            .filter(UserVehicle.user_id == user.id)
            .order_by(UserVehicle.created_at.desc())
            .all()
        )
        vehicles_data = []
        for uv in user_vehicles:
            active_session = (
                db.query(VehicleSession)
                .filter(
                    VehicleSession.plate_number == uv.plate_number,
                    VehicleSession.status == "ENTERED",
                )
                .first()
            )
            last_session = (
                db.query(VehicleSession)
                .filter(VehicleSession.plate_number == uv.plate_number)
                .order_by(VehicleSession.entry_time.desc())
                .first()
            )
            vehicles_data.append({
                "plate_number": uv.plate_number,
                "vehicle_type": uv.vehicle_type,
                "owner_name": uv.owner_name,
                "phone_number": uv.phone_number,
                "is_inside": active_session is not None,
                "entry_time": _utc_iso(active_session.entry_time) if active_session else None,
                "last_seen": _utc_iso(last_session.entry_time) if last_session else None,
            })

        # ── Today's sessions ─────────────────────────────────
        today_sessions = (
            db.query(VehicleSession)
            .filter(
                VehicleSession.plate_number.in_(plates),
                VehicleSession.entry_time >= today_start,
            )
            .order_by(VehicleSession.entry_time.desc())
            .all()
        )

        # ── Recent 20 visits (all time) ──────────────────────
        recent = (
            db.query(VehicleSession)
            .filter(VehicleSession.plate_number.in_(plates))
            .order_by(VehicleSession.entry_time.desc())
            .limit(20)
            .all()
        )

        # ── Stats ────────────────────────────────────────────
        week_count = (
            db.query(func.count(VehicleSession.id))
            .filter(
                VehicleSession.plate_number.in_(plates),
                VehicleSession.entry_time >= week_start,
            )
            .scalar() or 0
        )

        month_sessions_q = (
            db.query(VehicleSession)
            .filter(
                VehicleSession.plate_number.in_(plates),
                VehicleSession.entry_time >= month_start,
            )
            .all()
        )
        month_count = len(month_sessions_q)
        total_duration = sum(
            s.duration_minutes for s in month_sessions_q if s.duration_minutes
        )

        active_now = (
            db.query(func.count(VehicleSession.id))
            .filter(
                VehicleSession.plate_number.in_(plates),
                VehicleSession.status == "ENTERED",
            )
            .scalar() or 0
        )

        def _session_dict(s):
            return {
                "id": s.id,
                "plate_number": s.plate_number,
                "entry_time": _utc_iso(s.entry_time),
                "exit_time": _utc_iso(s.exit_time),
                "duration_minutes": s.duration_minutes,
                "status": s.status,
                "camera_id": s.camera_id,
                "exit_camera_id": s.exit_camera_id,
            }

        return {
            "username": user.username,
            "email": user.email,
            "vehicles": vehicles_data,
            "today_activity": [_session_dict(s) for s in today_sessions],
            "recent_visits": [_session_dict(s) for s in recent],
            "stats": {
                "total_visits_today": len(today_sessions),
                "total_visits_week": week_count,
                "total_visits_month": month_count,
                "total_duration_month_min": round(total_duration, 1),
                "active_now": active_now,
            },
        }
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
#  SESSIONS
# ══════════════════════════════════════════════════════════════

@router.get("/sessions")
def get_my_sessions(
    plate: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """Recent sessions for the user's vehicles. Optionally filter by plate."""
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plates = _get_plates(db, user.id)
        if not plates:
            return []

        q = db.query(VehicleSession).filter(VehicleSession.plate_number.in_(plates))
        if plate:
            plate_upper = plate.strip().upper()
            if plate_upper not in plates:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Vehicle not registered to your account",
                )
            q = q.filter(VehicleSession.plate_number == plate_upper)

        sessions = q.order_by(VehicleSession.entry_time.desc()).limit(limit).all()
        return [
            {
                "id": s.id,
                "plate_number": s.plate_number,
                "entry_time": _utc_iso(s.entry_time),
                "exit_time": _utc_iso(s.exit_time),
                "duration_minutes": s.duration_minutes,
                "status": s.status,
                "camera_id": s.camera_id,
                "exit_camera_id": s.exit_camera_id,
            }
            for s in sessions
        ]
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
#  DETECTIONS
# ══════════════════════════════════════════════════════════════

@router.get("/detections")
def get_my_detections(
    plate: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """Recent detections for the user's vehicles."""
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plates = _get_plates(db, user.id)
        if not plates:
            return []

        q = db.query(Detection).filter(Detection.plate_number.in_(plates))
        if plate:
            plate_upper = plate.strip().upper()
            if plate_upper not in plates:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Vehicle not registered to your account",
                )
            q = q.filter(Detection.plate_number == plate_upper)

        detections = q.order_by(Detection.timestamp.desc()).limit(limit).all()
        return [
            {
                "id": d.id,
                "plate_number": d.plate_number,
                "confidence": d.confidence,
                "timestamp": _utc_iso(d.timestamp),
                "camera_id": d.camera_id,
                "event_type": d.event_type,
                "image_path": d.image_path,
            }
            for d in detections
        ]
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
#  ANALYTICS
# ══════════════════════════════════════════════════════════════

@router.get("/analytics/daily")
def get_my_daily(
    days: int = Query(30, ge=1, le=90),
    current_user: dict = Depends(get_current_user),
):
    """Daily visit counts for the last N days."""
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plates = _get_plates(db, user.id)
        if not plates:
            return []

        since = _utcnow() - timedelta(days=days)
        sessions = (
            db.query(VehicleSession)
            .filter(VehicleSession.plate_number.in_(plates), VehicleSession.entry_time >= since)
            .all()
        )

        counts: dict[str, int] = {}
        durations: dict[str, float] = {}
        for s in sessions:
            key = s.entry_time.strftime("%Y-%m-%d")
            counts[key] = counts.get(key, 0) + 1
            if s.duration_minutes:
                durations[key] = durations.get(key, 0) + s.duration_minutes

        result = []
        for i in range(days - 1, -1, -1):
            day = _utcnow() - timedelta(days=i)
            key = day.strftime("%Y-%m-%d")
            result.append({
                "date": key,
                "label": day.strftime("%d/%m"),
                "count": counts.get(key, 0),
                "duration_min": round(durations.get(key, 0), 1),
            })
        return result
    finally:
        db.close()


@router.get("/analytics/weekly")
def get_my_weekly(
    weeks: int = Query(12, ge=1, le=52),
    current_user: dict = Depends(get_current_user),
):
    """Weekly visit counts for the last N weeks."""
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plates = _get_plates(db, user.id)
        if not plates:
            return []

        since = _utcnow() - timedelta(weeks=weeks)
        sessions = (
            db.query(VehicleSession)
            .filter(VehicleSession.plate_number.in_(plates), VehicleSession.entry_time >= since)
            .all()
        )

        counts: dict[str, int] = {}
        for s in sessions:
            iso = s.entry_time.isocalendar()
            key = f"{iso[0]}-W{iso[1]:02d}"
            counts[key] = counts.get(key, 0) + 1

        result = []
        for i in range(weeks - 1, -1, -1):
            day = _utcnow() - timedelta(weeks=i)
            iso = day.isocalendar()
            key = f"{iso[0]}-W{iso[1]:02d}"
            result.append({"week": key, "label": f"W{iso[1]}", "count": counts.get(key, 0)})
        return result
    finally:
        db.close()


@router.get("/analytics/monthly")
def get_my_monthly(
    months: int = Query(12, ge=1, le=24),
    current_user: dict = Depends(get_current_user),
):
    """Monthly visit counts and parking duration."""
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plates = _get_plates(db, user.id)
        if not plates:
            return []

        since = _utcnow() - timedelta(days=months * 31)
        sessions = (
            db.query(VehicleSession)
            .filter(VehicleSession.plate_number.in_(plates), VehicleSession.entry_time >= since)
            .all()
        )

        counts: dict[str, int] = {}
        durations: dict[str, float] = {}
        for s in sessions:
            key = s.entry_time.strftime("%Y-%m")
            counts[key] = counts.get(key, 0) + 1
            if s.duration_minutes:
                durations[key] = durations.get(key, 0) + s.duration_minutes

        now = _utcnow()
        result = []
        for i in range(months - 1, -1, -1):
            m = now.month - i
            y = now.year
            while m <= 0:
                m += 12
                y -= 1
            key = f"{y}-{m:02d}"
            label = datetime(y, m, 1).strftime("%b %y")
            result.append({
                "month": key,
                "label": label,
                "count": counts.get(key, 0),
                "duration_min": round(durations.get(key, 0), 1),
            })
        return result
    finally:
        db.close()


@router.get("/analytics/timeline")
def get_my_timeline(
    days: int = Query(7, ge=1, le=30),
    current_user: dict = Depends(get_current_user),
):
    """Entry and exit event counts per day — for the timeline area chart."""
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        plates = _get_plates(db, user.id)
        if not plates:
            return []

        since = _utcnow() - timedelta(days=days)
        sessions = (
            db.query(VehicleSession)
            .filter(VehicleSession.plate_number.in_(plates), VehicleSession.entry_time >= since)
            .all()
        )

        entries: dict[str, int] = {}
        exits: dict[str, int] = {}
        for s in sessions:
            ekey = s.entry_time.strftime("%Y-%m-%d")
            entries[ekey] = entries.get(ekey, 0) + 1
            if s.exit_time:
                xkey = s.exit_time.strftime("%Y-%m-%d")
                exits[xkey] = exits.get(xkey, 0) + 1

        result = []
        for i in range(days - 1, -1, -1):
            day = _utcnow() - timedelta(days=i)
            key = day.strftime("%Y-%m-%d")
            result.append({
                "date": key,
                "label": day.strftime("%d/%m"),
                "entries": entries.get(key, 0),
                "exits": exits.get(key, 0),
            })
        return result
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
#  SEARCH
# ══════════════════════════════════════════════════════════════

@router.get("/search")
def search_my_plate(
    plate: str = Query(..., min_length=2),
    current_user: dict = Depends(get_current_user),
):
    """
    Search for a plate within the user's registered vehicles.
    Returns live status, today's visits, weekly/monthly summary, and recent sessions.
    """
    db = SessionLocal()
    try:
        user = _get_user(db, current_user["sub"])
        all_plates = _get_plates(db, user.id)

        plate_upper = plate.strip().upper()
        matching = [p for p in all_plates if plate_upper in p]

        if not matching:
            return {
                "found": False,
                "query": plate_upper,
                "plates": [],
                "sessions": [],
            }

        now = _utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        plate_summaries = []
        for p in matching:
            active = (
                db.query(VehicleSession)
                .filter(VehicleSession.plate_number == p, VehicleSession.status == "ENTERED")
                .first()
            )
            today_count = (
                db.query(func.count(VehicleSession.id))
                .filter(VehicleSession.plate_number == p, VehicleSession.entry_time >= today_start)
                .scalar() or 0
            )
            week_count = (
                db.query(func.count(VehicleSession.id))
                .filter(
                    VehicleSession.plate_number == p,
                    VehicleSession.entry_time >= now - timedelta(days=7),
                )
                .scalar() or 0
            )
            month_count = (
                db.query(func.count(VehicleSession.id))
                .filter(
                    VehicleSession.plate_number == p,
                    VehicleSession.entry_time >= now - timedelta(days=30),
                )
                .scalar() or 0
            )
            plate_summaries.append({
                "plate_number": p,
                "is_inside": active is not None,
                "entry_time": _utc_iso(active.entry_time) if active else None,
                "today_visits": today_count,
                "week_visits": week_count,
                "month_visits": month_count,
            })

        recent_sessions = (
            db.query(VehicleSession)
            .filter(VehicleSession.plate_number.in_(matching))
            .order_by(VehicleSession.entry_time.desc())
            .limit(20)
            .all()
        )

        return {
            "found": True,
            "query": plate_upper,
            "plates": plate_summaries,
            "sessions": [
                {
                    "id": s.id,
                    "plate_number": s.plate_number,
                    "entry_time": _utc_iso(s.entry_time),
                    "exit_time": _utc_iso(s.exit_time),
                    "duration_minutes": s.duration_minutes,
                    "status": s.status,
                    "camera_id": s.camera_id,
                }
                for s in recent_sessions
            ],
        }
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
#  PERSONAL MONTHLY REPORT  (PDF download)
# ══════════════════════════════════════════════════════════════

@router.get("/report/monthly")
def get_monthly_report(current_user: dict = Depends(get_current_user)):
    """Generate and return a PDF of the user's visits for the current calendar month."""
    db = SessionLocal()
    try:
        user   = _get_user(db, current_user["sub"])
        plates = _get_plates(db, user.id)
    finally:
        db.close()

    try:
        from backend.app.services.report_service import build_personal_monthly_pdf
        path = build_personal_monthly_pdf(user.username, plates)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {exc}")

    return FileResponse(
        path=str(path),
        media_type="application/pdf",
        filename=path.name,
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )
