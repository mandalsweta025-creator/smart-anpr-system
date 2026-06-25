import asyncio
import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.app.database.crud import (
    create_vehicle_session,
    update_vehicle_exit,
    get_open_sessions,
)

from backend.app.core.config import VEHICLE_EXIT_TIMEOUT  # kept for config API compat

logger = logging.getLogger(__name__)

_RUNTIME_CFG = Path(__file__).resolve().parents[2] / "configs" / "runtime.json"

# ==========================================
# ACTIVE SESSIONS (IN-MEMORY CACHE)
# ==========================================

active_sessions: dict = {}
# Protects all compound read-check-write operations on active_sessions.
# Multiple ANPR threads (one per camera) call handle_vehicle_session concurrently.
_session_lock = threading.Lock()


def _load_exit_timeout() -> int:
    try:
        if _RUNTIME_CFG.exists():
            data = json.loads(_RUNTIME_CFG.read_text())
            val = int(data.get("exit_timeout_seconds", VEHICLE_EXIT_TIMEOUT))
            return max(30, val)
    except Exception:
        pass
    return VEHICLE_EXIT_TIMEOUT


def _save_exit_timeout(seconds: int) -> None:
    try:
        data = {}
        if _RUNTIME_CFG.exists():
            data = json.loads(_RUNTIME_CFG.read_text())
        data["exit_timeout_seconds"] = seconds
        _RUNTIME_CFG.write_text(json.dumps(data, indent=2))
    except Exception:
        pass


_exit_timeout_seconds = _load_exit_timeout()


def set_exit_timeout(seconds: int) -> None:
    global _exit_timeout_seconds
    _exit_timeout_seconds = max(30, int(seconds))
    _save_exit_timeout(_exit_timeout_seconds)


def get_exit_timeout() -> int:
    return _exit_timeout_seconds


def normalize_plate(plate_number: str) -> str:
    return plate_number.strip().upper()


def _fuzzy_find_active_session(plate: str) -> str | None:
    """
    Return the key of an existing active_sessions entry whose plate is within
    Levenshtein distance 1 of `plate`, or None if no such session exists.

    This prevents two separate sessions being created for the same physical
    vehicle when OCR produces slightly different readings across frames
    (e.g. KL58AH0969 vs KL58AM0969).
    """
    from backend.app.ai_engine.anpr.duplicate_guard import plate_edit_distance
    for existing in active_sessions:
        if plate_edit_distance(plate, existing) <= 1:
            return existing
    return None


def now_utc():
    """Timezone-safe UTC timestamp"""
    return datetime.now(timezone.utc)


# ==========================================
# RESTORE SESSIONS
# ==========================================

def _make_aware(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware (UTC). DB stores naive datetimes."""
    if dt is None:
        return now_utc()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def restore_active_sessions():
    try:
        open_sessions = get_open_sessions()

        for session in open_sessions:
            plate = normalize_plate(session.plate_number)
            entry = _make_aware(session.entry_time)

            active_sessions[plate] = {
                "entry_time": entry,
                "last_seen": entry,
                "status": "ENTERED",
            }

        logger.info(f"Restored {len(open_sessions)} active sessions")

    except Exception as e:
        logger.error(f"Restore failed: {e}")


# ==========================================
# CREATE ENTRY
# ==========================================

def create_vehicle_entry(plate_number, snapshot_path=None, camera_id=None):
    plate_number = normalize_plate(plate_number)
    current_time = now_utc()

    try:
        create_vehicle_session(
            plate_number=plate_number,
            entry_time=current_time,
            snapshot_path=snapshot_path,
            camera_id=camera_id,
        )

        active_sessions[plate_number] = {
            "entry_time": current_time,
            "last_seen": current_time,
            "status": "ENTERED",
            "snapshot_path": snapshot_path,
            "camera_id": camera_id,
        }

        logger.info(f"Vehicle ENTERED: {plate_number} (cam={camera_id})")

        # Anomaly check: repeated entries (runs off the hot path in a try block)
        try:
            from backend.app.services.anomaly_engine import check_on_entry
            check_on_entry(plate_number, camera_id, had_active_session=False)
        except Exception:
            pass

    except Exception as e:
        logger.error(f"Failed creating entry for {plate_number}: {e}")


# ==========================================
# UPDATE SESSION
# ==========================================

def update_vehicle_session(plate_number, snapshot_path=None, camera_id=None):
    plate_number = normalize_plate(plate_number)
    current_time = now_utc()

    with _session_lock:
        if plate_number not in active_sessions:
            # Check for a fuzzy-similar active session before creating a new entry.
            # Prevents duplicate sessions when OCR reads slightly different variants
            # of the same physical plate (e.g. KL58AH0969 vs KL58AM0969).
            fuzzy_key = _fuzzy_find_active_session(plate_number)
            if fuzzy_key:
                logger.debug(
                    f"Session fuzzy-merge: '{plate_number}' → '{fuzzy_key}' "
                    f"(updating last_seen instead of new entry)"
                )
                active_sessions[fuzzy_key]["last_seen"] = current_time
                return
            # create_vehicle_entry also writes to active_sessions — must be under lock
            create_vehicle_entry(plate_number, snapshot_path=snapshot_path, camera_id=camera_id)
            return

        last_seen = active_sessions[plate_number]["last_seen"]

        if (current_time - last_seen).total_seconds() < 2:
            return

        active_sessions[plate_number]["last_seen"] = current_time


# ==========================================
# MANUAL EXIT
# ==========================================

def force_exit_vehicle(
    plate_number: str,
    camera_id: str | None = None,
    camera_role: str = "exit",
) -> str:
    """Immediately close the active session for a plate (used by EXIT cameras).

    Returns the event_type: "EXIT" if a session was found and closed, "DETECTION"
    if no active session exists (vehicle seen on exit cam with no prior entry recorded).
    """
    plate_number = normalize_plate(plate_number)
    with _session_lock:
        # Try exact match first, then fuzzy
        key = plate_number if plate_number in active_sessions else _fuzzy_find_active_session(plate_number)
        if key is None:
            logger.debug(f"EXIT cam: no active session for {plate_number} — logging as DETECTION")
            try:
                from backend.app.services.anomaly_engine import check_on_exit
                check_on_exit(
                    plate_number, camera_id,
                    duration_minutes=None, had_session=False, camera_role=camera_role,
                )
            except Exception:
                pass
            return "DETECTION"

        session   = active_sessions[key]
        exit_time = now_utc()
        duration_sec = (exit_time - session["entry_time"]).total_seconds()
        duration_min = round(duration_sec / 60, 2)

        update_vehicle_exit(
            plate_number=key,
            exit_time=exit_time,
            duration_minutes=duration_min,
            exit_camera_id=camera_id,
        )

        active_sessions.pop(key, None)
        logger.info(
            f"Vehicle EXITED (cam={camera_id} role={camera_role}): {key} | {duration_min:.1f} min"
        )
        try:
            from backend.app.services.anomaly_engine import check_on_exit
            check_on_exit(
                key, camera_id,
                duration_minutes=duration_min, had_session=True, camera_role=camera_role,
            )
        except Exception:
            pass
    return "EXIT"


def manual_exit_vehicle(plate_number: str):
    """Mark a vehicle as exited immediately (bypasses the timeout)."""
    plate_number = normalize_plate(plate_number)
    with _session_lock:
        if plate_number not in active_sessions:
            return None

        session = active_sessions[plate_number]
        exit_time = now_utc()
        duration_sec = (exit_time - session["entry_time"]).total_seconds()
        duration_min = round(duration_sec / 60, 2)

        update_vehicle_exit(
            plate_number=plate_number,
            exit_time=exit_time,
            duration_minutes=duration_min,
        )

        active_sessions.pop(plate_number, None)
    logger.info(f"Vehicle manually EXITED: {plate_number}")
    return {"plate": plate_number, "exit_time": exit_time.isoformat(), "duration_minutes": duration_min}


# ==========================================
# BACKGROUND CLEANUP LOOP
# ==========================================
# NOTE: Automatic session timeout / auto-exit has been intentionally removed.
# A vehicle session is closed ONLY by:
#   1. A real exit-camera or smart-camera detection (force_exit_vehicle)
#   2. Admin manually closing the session via the UI/API
# This prevents the false "Vehicle exited after 5 min" bug caused by the
# DuplicateGuard (120 s) keeping last_seen stale.

async def session_cleanup_loop():
    logger.info("Session cleanup loop started")

    while True:
        try:
            # Prune stale duplicate-guard entries (import is lazy to avoid circular)
            from backend.app.routes.camera_routes import cleanup_duplicate_guard
            cleanup_duplicate_guard()
        except Exception as e:
            logger.error(f"Cleanup loop crashed: {e}")

        await asyncio.sleep(30)


# ==========================================
# HANDLE SESSION
# ==========================================

def handle_vehicle_session(
    plate_number,
    snapshot_path=None,
    camera_id: str | None = None,
    camera_role: str = "mixed",
) -> str:
    """Update or create a vehicle session.

    Returns event_type string: "ENTRY" | "EXIT" | "DETECTION"

    camera_role:
      "entry"  → always create/update entry session → returns "ENTRY" (new) or "DETECTION" (already inside)
      "exit"   → immediately close any active session → returns "EXIT" or "DETECTION" (no session found)
      "smart"  → single-gate mode: first detection = ENTRY, next detection = EXIT
      "mixed"  → legacy: entry-only with timeout-based exit (not recommended for production)
    """
    if not plate_number or not isinstance(plate_number, str):
        return "DETECTION"

    plate_number = normalize_plate(plate_number)

    if camera_role == "exit":
        return force_exit_vehicle(plate_number, camera_id=camera_id, camera_role="exit")

    if camera_role == "entry":
        with _session_lock:
            if plate_number not in active_sessions and _fuzzy_find_active_session(plate_number) is None:
                create_vehicle_entry(plate_number, snapshot_path=snapshot_path, camera_id=camera_id)
                return "ENTRY"
            else:
                # Update last_seen so operators watching live feed see the vehicle is still present
                key = plate_number if plate_number in active_sessions else _fuzzy_find_active_session(plate_number)
                if key and key in active_sessions:
                    active_sessions[key]["last_seen"] = now_utc()
                try:
                    from backend.app.services.anomaly_engine import check_on_entry
                    check_on_entry(plate_number, camera_id, had_active_session=True)
                except Exception:
                    pass
                return "DETECTION"

    if camera_role == "smart":
        # Smart single-gate mode:
        #   No active session  → vehicle arriving → ENTRY
        #   Active session exists → vehicle leaving → EXIT
        with _session_lock:
            key = plate_number if plate_number in active_sessions else _fuzzy_find_active_session(plate_number)
            if key is None:
                # No active session — this is an ENTRY
                create_vehicle_entry(plate_number, snapshot_path=snapshot_path, camera_id=camera_id)
                logger.info(f"[SMART] ENTRY: {plate_number} (cam={camera_id})")
                return "ENTRY"
            else:
                # Active session found — this is an EXIT
                session = active_sessions[key]
                exit_time = now_utc()
                duration_sec = (exit_time - session["entry_time"]).total_seconds()
                duration_min = round(duration_sec / 60, 2)
                update_vehicle_exit(
                    plate_number=key,
                    exit_time=exit_time,
                    duration_minutes=duration_min,
                    exit_camera_id=camera_id,
                )
                active_sessions.pop(key, None)
                logger.info(f"[SMART] EXIT: {key} | {duration_min:.1f} min (cam={camera_id})")
                try:
                    from backend.app.services.anomaly_engine import check_on_exit
                    check_on_exit(key, camera_id, duration_minutes=duration_min,
                                  had_session=True, camera_role="smart")
                except Exception:
                    pass
                return "EXIT"

    # camera_role == "mixed" (legacy): entry-only, no auto-exit via detection
    is_new = plate_number not in active_sessions and _fuzzy_find_active_session(plate_number) is None
    update_vehicle_session(plate_number, snapshot_path=snapshot_path, camera_id=camera_id)
    return "ENTRY" if is_new else "DETECTION"


# ==========================================
# GET ACTIVE VEHICLES
# ==========================================

def get_active_vehicles():
    return active_sessions
