import io
import pandas as pd
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List

from backend.app.database.connection import SessionLocal
from backend.app.models.vehicle_sessions import VehicleSession
from backend.app.schemas.detection_schema import VehicleSessionResponse
from backend.app.services.session_service import (
    manual_exit_vehicle,
    set_exit_timeout,
    get_exit_timeout,
)

router = APIRouter()


@router.get("/sessions", response_model=List[VehicleSessionResponse])
def get_all_sessions():
    db: Session = SessionLocal()
    try:
        return (
            db.query(VehicleSession)
            .order_by(VehicleSession.entry_time.desc())
            .all()
        )
    finally:
        db.close()


@router.get("/sessions/counts")
def get_session_counts():
    db: Session = SessionLocal()
    try:
        active  = db.query(VehicleSession).filter(VehicleSession.status == "ENTERED").count()
        exited  = db.query(VehicleSession).filter(VehicleSession.status == "EXITED").count()
        return {"active": active, "exited": exited, "total": active + exited}
    finally:
        db.close()


@router.get("/sessions/active")
def get_active_sessions():
    db: Session = SessionLocal()
    try:
        sessions = (
            db.query(VehicleSession)
            .filter(VehicleSession.status == "ENTERED")
            .order_by(VehicleSession.entry_time.desc())
            .all()
        )
        serialized = [VehicleSessionResponse.model_validate(s) for s in sessions]
        return {
            "active_count": len(sessions),
            "vehicles": [s.model_dump() for s in serialized],
        }
    finally:
        db.close()


@router.get("/sessions/exited", response_model=List[VehicleSessionResponse])
def get_exited_sessions(limit: int = Query(100, ge=1, le=1000)):
    db: Session = SessionLocal()
    try:
        return (
            db.query(VehicleSession)
            .filter(VehicleSession.status == "EXITED")
            .order_by(VehicleSession.exit_time.desc())
            .limit(limit)
            .all()
        )
    finally:
        db.close()


@router.get("/sessions/history/{plate}", response_model=List[VehicleSessionResponse])
def get_vehicle_session_history(plate: str):
    db: Session = SessionLocal()
    try:
        return (
            db.query(VehicleSession)
            .filter(VehicleSession.plate_number == plate)
            .order_by(VehicleSession.entry_time.desc())
            .all()
        )
    finally:
        db.close()


@router.post("/sessions/{plate}/exit")
def manual_exit_session(plate: str):
    result = manual_exit_vehicle(plate)
    if result is None:
        raise HTTPException(status_code=404, detail="No active session for this plate")
    return {"success": True, **result}


@router.get("/export/sessions")
def export_sessions_xlsx():
    """Return all sessions as a downloadable Excel file."""
    db: Session = SessionLocal()
    try:
        rows = db.query(VehicleSession).order_by(VehicleSession.entry_time.desc()).all()
    finally:
        db.close()

    data = [
        {
            "Plate Number":     s.plate_number,
            "Status":           s.status,
            "Entry Time":       s.entry_time.strftime("%Y-%m-%d %H:%M:%S") if s.entry_time else "",
            "Exit Time":        s.exit_time.strftime("%Y-%m-%d %H:%M:%S") if s.exit_time else "",
            "Duration (min)":   round(s.duration_minutes, 2) if s.duration_minutes else "",
            "Entry Camera":     s.camera_id or "",
            "Exit Camera":      s.exit_camera_id or "",
        }
        for s in rows
    ]

    df = pd.DataFrame(data)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Sessions")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=anpr_sessions.xlsx"},
    )


@router.get("/config/exit-timeout")
def read_exit_timeout():
    return {
        "exit_timeout_seconds": get_exit_timeout(),
        "note": "Automatic session timeout has been disabled. Sessions close only on real exit-camera detection or manual admin close.",
    }


@router.patch("/config/exit-timeout")
def update_exit_timeout(payload: dict = Body(...)):
    seconds = payload.get("seconds")
    if seconds is None or not isinstance(seconds, (int, float)) or seconds < 30:
        raise HTTPException(status_code=400, detail="seconds must be an integer >= 30")
    set_exit_timeout(int(seconds))
    return {
        "success": True,
        "exit_timeout_seconds": get_exit_timeout(),
        "note": "Automatic session timeout has been disabled. This value is stored but not used.",
    }
