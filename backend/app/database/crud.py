import logging
from datetime import datetime, timezone
from backend.app.database.connection import SessionLocal
from backend.app.models.vehicle_sessions import VehicleSession
from backend.app.models.detections import Detection
from backend.app.models.alert import Alert

logger = logging.getLogger(__name__)


def _now() -> datetime:
    """Naive UTC — matches what SQLite stores (tzinfo is stripped on write anyway)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ==========================================
# CREATE VEHICLE SESSION
# ==========================================

def create_vehicle_session(
    plate_number,
    entry_time,
    snapshot_path=None,
    camera_id=None,
):
    db = SessionLocal()
    try:
        active_session = (
            db.query(VehicleSession)
            .filter(
                VehicleSession.plate_number == plate_number,
                VehicleSession.status == "ENTERED",
            )
            .first()
        )

        if active_session:
            return active_session

        session = VehicleSession(
            plate_number=plate_number,
            entry_time=entry_time,
            status="ENTERED",
            snapshot_path=snapshot_path,
            camera_id=camera_id,
        )

        db.add(session)
        db.commit()
        db.refresh(session)
        logger.debug(f"Vehicle entered: {plate_number}")
        return session

    except Exception as e:
        db.rollback()
        logger.error(f"Vehicle session error: {e}")
        return None

    finally:
        db.close()


# ==========================================
# UPDATE VEHICLE EXIT
# ==========================================

def update_vehicle_exit(
    plate_number,
    exit_time,
    duration_minutes=None,
    exit_camera_id=None,
):
    db = SessionLocal()
    try:
        session = (
            db.query(VehicleSession)
            .filter(
                VehicleSession.plate_number == plate_number,
                VehicleSession.status == "ENTERED",
            )
            .first()
        )

        if not session:
            return None

        session.exit_time        = exit_time
        session.status           = "EXITED"
        session.duration_minutes = duration_minutes
        if exit_camera_id:
            session.exit_camera_id = exit_camera_id

        db.commit()
        db.refresh(session)
        logger.debug(f"Vehicle exited: {plate_number}")
        return session

    except Exception as e:
        db.rollback()
        logger.error(f"Vehicle exit update error: {e}")
        return None

    finally:
        db.close()



# ==========================================
# GET OPEN VEHICLE SESSIONS
# ==========================================

def get_open_sessions():
    db = SessionLocal()
    try:
        sessions = (
            db.query(VehicleSession)
            .filter(VehicleSession.status == "ENTERED")
            .all()
        )
        return sessions

    except Exception as e:
        logger.error(f"Get open sessions error: {e}")
        return []

    finally:
        db.close()


# ==========================================
# SAVE DETECTION
# ==========================================

def save_detection(
    plate_number,
    confidence,
    image_path=None,
    camera_id=None,
    orientation="UNKNOWN",
    event_type="DETECTION",
):
    db = SessionLocal()
    try:
        detection = Detection(
            plate_number=plate_number,
            confidence=confidence,
            image_path=image_path,
            timestamp=_now(),
            camera_id=camera_id,
            orientation=orientation,
            event_type=event_type,
        )

        db.add(detection)
        db.commit()
        db.refresh(detection)
        return detection

    except Exception as e:
        db.rollback()
        logger.error(f"Save detection error: {e}")
        return None

    finally:
        db.close()


# ==========================================
# SAVE ALERT
# ==========================================

def save_alert(plate_number: str, message: str, camera_id: str = None):
    db = SessionLocal()
    try:
        alert = Alert(
            plate_number=plate_number,
            message=message,
            camera_id=camera_id,
            timestamp=_now(),
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert
    except Exception as e:
        db.rollback()
        logger.error(f"Save alert error: {e}")
        return None
    finally:
        db.close()


# ==========================================
# GET ALL DETECTIONS
# ==========================================

def get_all_detections():
    db = SessionLocal()
    try:
        return (
            db.query(Detection)
            .order_by(Detection.timestamp.desc())
            .all()
        )

    except Exception as e:
        logger.error(f"Get all detections error: {e}")
        return []

    finally:
        db.close()


# ==========================================
# SEARCH DETECTION BY PLATE
# ==========================================

def search_detection_by_plate(plate_number):
    db = SessionLocal()
    try:
        return (
            db.query(Detection)
            .filter(
                Detection.plate_number.ilike(
                    f"%{plate_number}%"
                )
            )
            .order_by(Detection.timestamp.desc())
            .all()
        )

    except Exception as e:
        logger.error(f"Search detection error: {e}")
        return []

    finally:
        db.close()