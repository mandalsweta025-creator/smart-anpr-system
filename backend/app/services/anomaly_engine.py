"""
anomaly_engine.py
=================
Detects and records 9 classes of operational anomalies in real time and via
periodic background scans.

Anomaly types
─────────────
CRITICAL  BLACKLIST_ENTRY_ATTEMPT  — confirmed blacklisted plate detection
          PLATE_CLONING_SUSPICION  — same plate on two cameras within 20 s

HIGH      GHOST_EXIT               — exit event but no prior entry session
          DUPLICATE_ENTRY          — entry while same plate already inside
          TAILGATING_SUSPICION     — two different plates on same cam within 5 s

MEDIUM    EXCESSIVE_DURATION       — session active for > EXCESSIVE_DURATION_HOURS
          OVERNIGHT_STAY           — session spans midnight
          REPEATED_ENTRIES         — > REPEATED_ENTRIES_THRESHOLD sessions in 24 h

LOW       QUICK_TURNAROUND         — exit within QUICK_TURNAROUND_SECS of entry

Public hooks
────────────
check_on_detection(plate, camera_id, is_blacklisted) — from camera_routes after vote-confirm
check_on_entry(plate, camera_id, had_active_session) — from session_service on ENTRY
check_on_exit(plate, camera_id, duration_minutes, session_id, had_session) — on EXIT
run_background_scan()                                — called every 5 min from main.py
"""

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

_RUNTIME_CFG = Path(__file__).resolve().parents[2] / "configs" / "runtime.json"

logger = logging.getLogger(__name__)


# ── email alert ───────────────────────────────────────────────────────────────

def _send_email_alert(subject: str, body: str) -> None:
    """Send an SMTP email in a background thread.  No-ops if SMTP is unconfigured."""
    try:
        from backend.app.core.config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL_TO
        if not SMTP_HOST or not SMTP_USER or not ALERT_EMAIL_TO:
            return
        import smtplib, ssl
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        recipients = [r.strip() for r in ALERT_EMAIL_TO.split(",") if r.strip()]
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = SMTP_USER
        msg["To"]      = ", ".join(recipients)
        msg.attach(MIMEText(body, "plain"))

        ctx = ssl.create_default_context()
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx) as srv:
                srv.login(SMTP_USER, SMTP_PASSWORD)
                srv.sendmail(SMTP_USER, recipients, msg.as_string())
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as srv:
                srv.ehlo()
                srv.starttls(context=ctx)
                srv.login(SMTP_USER, SMTP_PASSWORD)
                srv.sendmail(SMTP_USER, recipients, msg.as_string())

        logger.info("Email alert sent: %s", subject)
    except Exception as exc:
        logger.warning("Email alert failed: %s", exc)


# ── tunables ─────────────────────────────────────────────────────────────────
EXCESSIVE_DURATION_HOURS    = 8      # background: flag sessions older than N hours
REPEATED_ENTRIES_THRESHOLD  = 5      # flag plates with ≥ N sessions in 24 h
QUICK_TURNAROUND_SECS       = 120    # flag exits within N seconds of entry (2 min minimum)
TAILGATING_GAP_SECS         = 10     # flag two different plates on same cam within N s
CLONING_GAP_SECS            = 30     # flag same plate on two different cams within N s
DEDUP_WINDOW_HOURS          = 1      # suppress re-raising same open anomaly for N h
GHOST_EXIT_DB_WINDOW_MINS   = 60     # ghost exit: suppress if a DB session exists within N min

# ── camera topology ───────────────────────────────────────────────────────────
# Pairs of camera IDs that are physically adjacent (e.g. entry/exit at the same gate).
# Plate cloning is NEVER raised between cameras in the same pair, regardless of timing,
# because it is physically normal for the same vehicle to appear on both within seconds.
# Format: set of frozensets — order of IDs within a pair doesn't matter.
# Example: {frozenset({"1", "2"}), frozenset({"3", "4"})}
# Leave empty to disable topology-aware suppression (cloning fires between ALL camera pairs).
ADJACENT_CAMERA_PAIRS: set[frozenset] = set()


def _load_adjacent_pairs() -> None:
    """Load ADJACENT_CAMERA_PAIRS from runtime.json (called at startup and on update)."""
    global ADJACENT_CAMERA_PAIRS
    try:
        if _RUNTIME_CFG.exists():
            data = json.loads(_RUNTIME_CFG.read_text())
            raw = data.get("adjacent_camera_pairs", [])
            ADJACENT_CAMERA_PAIRS = {frozenset(pair) for pair in raw if len(pair) == 2}
    except Exception:
        pass


def get_adjacent_pairs() -> list[list[str]]:
    """Return adjacent pairs as a serialisable list of 2-element lists."""
    return [sorted(p) for p in ADJACENT_CAMERA_PAIRS]


def set_adjacent_pairs(pairs: list[list[str]]) -> None:
    """Update in-memory adjacent pairs AND persist to runtime.json."""
    global ADJACENT_CAMERA_PAIRS
    validated = []
    for pair in pairs:
        if len(pair) == 2 and pair[0] != pair[1]:
            validated.append([str(pair[0]), str(pair[1])])
    ADJACENT_CAMERA_PAIRS = {frozenset(p) for p in validated}
    try:
        data: dict = {}
        if _RUNTIME_CFG.exists():
            data = json.loads(_RUNTIME_CFG.read_text())
        data["adjacent_camera_pairs"] = validated
        _RUNTIME_CFG.write_text(json.dumps(data, indent=2))
    except Exception as exc:
        logger.warning("Could not persist adjacent_camera_pairs: %s", exc)


# Load pairs at import time (on server start)
_load_adjacent_pairs()


def _are_adjacent(cam_a: str | None, cam_b: str | None) -> bool:
    """Return True if cam_a and cam_b form a known adjacent pair."""
    if not cam_a or not cam_b or cam_a == cam_b:
        return False
    return frozenset({cam_a, cam_b}) in ADJACENT_CAMERA_PAIRS

# ── in-memory state for real-time checks ─────────────────────────────────────
_last_plate_per_cam: dict[str, tuple[str, float]] = {}   # cam_id  → (plate, monotonic_ts)
_plate_last_cam:     dict[str, tuple[str, float]] = {}   # plate   → (cam_id, monotonic_ts)
_state_lock = Lock()


# ── helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _dedup(db, anomaly_type: str, plate: str | None) -> bool:
    """Return True if a recent OPEN anomaly of (type, plate) already exists."""
    from backend.app.models.anomaly import AnomalyEvent
    cutoff = _now() - timedelta(hours=DEDUP_WINDOW_HOURS)
    q = db.query(AnomalyEvent).filter(
        AnomalyEvent.anomaly_type == anomaly_type,
        AnomalyEvent.status       == "OPEN",
        AnomalyEvent.created_at   >= cutoff,
    )
    if plate:
        q = q.filter(AnomalyEvent.plate_number == plate)
    return q.first() is not None


def _emit(
    anomaly_type: str,
    severity:     str,
    description:  str,
    plate_number: str | None = None,
    camera_id:    str | None = None,
    details:      dict | None = None,
    session_id:   int  | None = None,
) -> None:
    """Persist one anomaly event and broadcast it over WebSocket."""
    try:
        from backend.app.database.connection import SessionLocal
        from backend.app.models.anomaly import AnomalyEvent
        from backend.app.services.websocket_service import broadcast_detection_event

        db = SessionLocal()
        try:
            if _dedup(db, anomaly_type, plate_number):
                return
            ev = AnomalyEvent(
                anomaly_type=anomaly_type,
                severity=severity,
                plate_number=plate_number,
                camera_id=camera_id,
                description=description,
                details=json.dumps(details) if details else None,
                status="OPEN",
                session_id=session_id,
            )
            db.add(ev)
            db.commit()
            db.refresh(ev)
            ev_id = ev.id
        finally:
            db.close()

        broadcast_detection_event({
            "type":         "anomaly",
            "id":           ev_id,
            "anomaly_type": anomaly_type,
            "severity":     severity,
            "plate_number": plate_number,
            "camera_id":    camera_id,
            "description":  description,
            "created_at":   _now().isoformat(),
        })

        logger.warning(
            "ANOMALY [%s] %s: %s  plate=%s  cam=%s",
            severity, anomaly_type, description, plate_number, camera_id,
        )

        # Fire-and-forget email for CRITICAL / HIGH anomalies
        if severity in ("CRITICAL", "HIGH"):
            import threading
            threading.Thread(
                target=_send_email_alert,
                args=(
                    f"[ANPR ALERT] {severity} — {anomaly_type}",
                    f"{description}\n\nPlate: {plate_number or '—'}\nCamera: {camera_id or '—'}\nTime: {_now().isoformat()}",
                ),
                daemon=True,
            ).start()

    except Exception as exc:
        logger.error("_emit failed for %s: %s", anomaly_type, exc)


# ── public hooks ──────────────────────────────────────────────────────────────

def check_on_detection(
    plate:          str,
    camera_id:      str | None,
    is_blacklisted: bool = False,
) -> None:
    """
    Call this for every vote-confirmed plate detection (after DuplicateGuard passes).
    Checks: BLACKLIST_ENTRY_ATTEMPT, TAILGATING_SUSPICION, PLATE_CLONING_SUSPICION.
    """
    try:
        if is_blacklisted:
            _emit(
                anomaly_type="BLACKLIST_ENTRY_ATTEMPT",
                severity="CRITICAL",
                plate_number=plate,
                camera_id=camera_id,
                description=f"BLACKLISTED vehicle {plate} detected at camera {camera_id}",
                details={"camera_id": camera_id},
            )

        # ── WATCHLIST SIGHTING ─────────────────────────────────────────────────
        try:
            from backend.app.database.connection import SessionLocal as _SL
            from backend.app.models.vehicle import Vehicle as _V
            _db = _SL()
            try:
                _veh = _db.query(_V).filter(_V.plate_number == plate).first()
                if _veh and getattr(_veh, "is_watchlisted", False):
                    _emit(
                        anomaly_type="WATCHLIST_SIGHTING",
                        severity="MEDIUM",
                        plate_number=plate,
                        camera_id=camera_id,
                        description=f"Watched vehicle {plate} sighted at camera {camera_id}",
                        details={"reason": getattr(_veh, "watchlist_reason", None)},
                    )
            finally:
                _db.close()
        except Exception:
            pass

        now_ts = time.monotonic()
        with _state_lock:
            # ── TAILGATING: different plate on same cam within gap ──────────────
            if camera_id and camera_id in _last_plate_per_cam:
                prev_plate, prev_ts = _last_plate_per_cam[camera_id]
                gap = now_ts - prev_ts
                if prev_plate != plate and gap < TAILGATING_GAP_SECS:
                    _emit(
                        anomaly_type="TAILGATING_SUSPICION",
                        severity="HIGH",
                        plate_number=plate,
                        camera_id=camera_id,
                        description=(
                            f"Possible tailgating at {camera_id}: "
                            f"{plate} detected {gap:.1f}s after {prev_plate}"
                        ),
                        details={
                            "preceding_plate": prev_plate,
                            "gap_seconds":     round(gap, 1),
                            "camera_id":       camera_id,
                        },
                    )
            if camera_id:
                _last_plate_per_cam[camera_id] = (plate, now_ts)

            # ── PLATE_CLONING: same plate on two cameras within gap ─────────────
            if plate in _plate_last_cam:
                prev_cam, prev_ts2 = _plate_last_cam[plate]
                gap2 = now_ts - prev_ts2
                if (
                    prev_cam and camera_id
                    and prev_cam != camera_id
                    and gap2 < CLONING_GAP_SECS
                    and not _are_adjacent(prev_cam, camera_id)
                ):
                    _emit(
                        anomaly_type="PLATE_CLONING_SUSPICION",
                        severity="CRITICAL",
                        plate_number=plate,
                        camera_id=camera_id,
                        description=(
                            f"Plate {plate} seen on {camera_id} only {gap2:.1f}s after "
                            f"{prev_cam} — possible cloning or replay attack"
                        ),
                        details={
                            "camera_a":    prev_cam,
                            "camera_b":    camera_id,
                            "gap_seconds": round(gap2, 1),
                        },
                    )
            if camera_id:
                _plate_last_cam[plate] = (camera_id, now_ts)

    except Exception as exc:
        logger.error("check_on_detection error: %s", exc)


def check_on_entry(
    plate:              str,
    camera_id:          str | None,
    had_active_session: bool,
) -> None:
    """
    Call this when a ENTRY event is being processed by session_service.
    Checks: DUPLICATE_ENTRY, REPEATED_ENTRIES.
    """
    try:
        if had_active_session:
            _emit(
                anomaly_type="DUPLICATE_ENTRY",
                severity="HIGH",
                plate_number=plate,
                camera_id=camera_id,
                description=(
                    f"Vehicle {plate} triggered entry on {camera_id} "
                    "while an active session already exists"
                ),
                details={"camera_id": camera_id},
            )

        # Repeated entries: count sessions in last 24 h
        try:
            from backend.app.database.connection import SessionLocal
            from backend.app.models.vehicle_sessions import VehicleSession
            db = SessionLocal()
            try:
                cutoff = _now() - timedelta(hours=24)
                cnt = (
                    db.query(VehicleSession)
                    .filter(
                        VehicleSession.plate_number == plate,
                        VehicleSession.entry_time   >= cutoff,
                    )
                    .count()
                )
                if cnt >= REPEATED_ENTRIES_THRESHOLD:
                    _emit(
                        anomaly_type="REPEATED_ENTRIES",
                        severity="MEDIUM",
                        plate_number=plate,
                        camera_id=camera_id,
                        description=(
                            f"{plate} has {cnt} entries in the last 24 h "
                            f"(threshold: {REPEATED_ENTRIES_THRESHOLD})"
                        ),
                        details={
                            "count_24h":  cnt,
                            "threshold":  REPEATED_ENTRIES_THRESHOLD,
                            "camera_id":  camera_id,
                        },
                    )
            finally:
                db.close()
        except Exception as exc:
            logger.error("check_on_entry repeated-entries query: %s", exc)

    except Exception as exc:
        logger.error("check_on_entry error: %s", exc)


def check_on_exit(
    plate:            str,
    camera_id:        str | None,
    duration_minutes: float | None,
    session_id:       int   | None = None,
    had_session:      bool         = True,
    camera_role:      str          = "exit",
) -> None:
    """
    Call this when an EXIT event is being processed by session_service.
    Checks: GHOST_EXIT, QUICK_TURNAROUND.

    camera_role: passed through so "smart" cameras never raise GHOST_EXIT
    (a smart camera's first detection may legitimately be an exit when no
    prior entry was recorded — e.g. vehicle arrived before camera was running).
    """
    try:
        if not had_session:
            # Smart cameras handle ENTRY and EXIT on the same device — a vehicle
            # that was parked before the camera started has no session, but that
            # is expected behaviour, not a ghost exit.
            if camera_role == "smart":
                logger.debug(
                    "GHOST_EXIT suppressed for smart-cam %s plate=%s "
                    "(no prior session is expected in single-gate mode)",
                    camera_id, plate,
                )
                return

            # Before flagging, check DB for a recent session — in-memory state can be
            # lost on server restart, causing spurious GHOST_EXIT for every exit.
            try:
                from backend.app.database.connection import SessionLocal as _SL2
                from backend.app.models.vehicle_sessions import VehicleSession as _VS
                _db2 = _SL2()
                try:
                    cutoff = _now() - timedelta(minutes=GHOST_EXIT_DB_WINDOW_MINS)
                    _recent = (
                        _db2.query(_VS)
                        .filter(
                            _VS.plate_number == plate,
                            _VS.entry_time   >= cutoff,
                        )
                        .first()
                    )
                    if _recent:
                        return   # legitimate session found in DB — not a ghost exit
                finally:
                    _db2.close()
            except Exception:
                pass
            _emit(
                anomaly_type="GHOST_EXIT",
                severity="HIGH",
                plate_number=plate,
                camera_id=camera_id,
                description=(
                    f"Vehicle {plate} triggered exit on {camera_id} "
                    "but no entry session was found"
                ),
                details={"camera_id": camera_id},
            )
            return

        if duration_minutes is not None and (duration_minutes * 60) < QUICK_TURNAROUND_SECS:
            _emit(
                anomaly_type="QUICK_TURNAROUND",
                severity="LOW",
                plate_number=plate,
                camera_id=camera_id,
                description=(
                    f"Vehicle {plate} exited only {duration_minutes * 60:.0f}s "
                    f"after entry — unusually short visit (threshold: {QUICK_TURNAROUND_SECS}s)"
                ),
                details={
                    "duration_seconds": round(duration_minutes * 60, 1),
                    "session_id":       session_id,
                },
                session_id=session_id,
            )

    except Exception as exc:
        logger.error("check_on_exit error: %s", exc)


def run_background_scan() -> None:
    """
    Scan all open sessions for time-based anomalies.
    Called every 5 minutes from the main.py background loop.
    Checks: EXCESSIVE_DURATION, OVERNIGHT_STAY.
    """
    try:
        from backend.app.database.connection import SessionLocal
        from backend.app.models.vehicle_sessions import VehicleSession

        db = SessionLocal()
        now   = _now()
        today = now.date()
        try:
            open_sessions = (
                db.query(VehicleSession)
                .filter(VehicleSession.status == "ENTERED")
                .all()
            )
            for s in open_sessions:
                if not s.entry_time:
                    continue
                duration_h = (now - s.entry_time).total_seconds() / 3600

                if duration_h >= EXCESSIVE_DURATION_HOURS:
                    _emit(
                        anomaly_type="EXCESSIVE_DURATION",
                        severity="MEDIUM",
                        plate_number=s.plate_number,
                        camera_id=s.camera_id,
                        description=(
                            f"Vehicle {s.plate_number} has been parked for "
                            f"{duration_h:.1f} h "
                            f"(threshold: {EXCESSIVE_DURATION_HOURS} h)"
                        ),
                        details={
                            "duration_hours":    round(duration_h, 2),
                            "entry_time":        s.entry_time.isoformat(),
                            "threshold_hours":   EXCESSIVE_DURATION_HOURS,
                        },
                        session_id=s.id,
                    )

                if s.entry_time.date() < today:
                    _emit(
                        anomaly_type="OVERNIGHT_STAY",
                        severity="MEDIUM",
                        plate_number=s.plate_number,
                        camera_id=s.camera_id,
                        description=(
                            f"Vehicle {s.plate_number} has stayed overnight "
                            f"(entered {s.entry_time.date()})"
                        ),
                        details={
                            "entry_date": str(s.entry_time.date()),
                            "session_id": s.id,
                        },
                        session_id=s.id,
                    )
        finally:
            db.close()

    except Exception as exc:
        logger.error("Anomaly background scan error: %s", exc)
