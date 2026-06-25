from fastapi import APIRouter, Query
from backend.app.database.connection import SessionLocal
from backend.app.models.alert import Alert

router = APIRouter()


@router.get("/alerts")
def get_alerts(limit: int = Query(100, ge=1, le=1000)):
    db = SessionLocal()
    try:
        rows = db.query(Alert).order_by(Alert.timestamp.desc()).limit(limit).all()
        return [
            {
                "id": a.id,
                "plate_number": a.plate_number,
                "message": a.message,
                "camera_id": a.camera_id,
                "timestamp": a.timestamp.isoformat() if a.timestamp else None,
            }
            for a in rows
        ]
    finally:
        db.close()


@router.get("/alerts/count")
def get_alert_count():
    db = SessionLocal()
    try:
        return {"count": db.query(Alert).count()}
    finally:
        db.close()
