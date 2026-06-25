import asyncio
import logging
import os
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO)
# Show DEBUG logs from ANPR modules so we can see every OCR attempt
logging.getLogger("backend.app.ai_engine.anpr.ocr_engine").setLevel(logging.DEBUG)
logging.getLogger("backend.app.routes.camera_routes").setLevel(logging.DEBUG)

from fastapi import Depends, FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from backend.app.routes.detections import router as detection_router
from backend.app.routes.camera_routes import router as camera_router
from backend.app.routes.vehicle_sessions import router as sessions_router
from backend.app.routes.vehicles import router as vehicles_router
from backend.app.routes.auth import router as auth_router
from backend.app.routes.analytics import router as analytics_router
from backend.app.routes.alerts import router as alerts_router
from backend.app.routes.user_portal import router as portal_router
from backend.app.routes.anomaly  import router as anomaly_router
from backend.app.routes.audit    import router as audit_router
from backend.app.routes.reports  import router as reports_router

from backend.app.infrastructure.websocket_manager import manager
from backend.app.services.session_service import (
    restore_active_sessions,
    session_cleanup_loop,
)
from backend.app.services.websocket_service import set_event_loop
from backend.app.core.config import DETECTION_DIR, DETECTION_MAX_AGE_DAYS, DETECTION_MAX_SIZE_MB
from backend.app.core.security import decode_token, get_current_user, get_stream_user, require_staff, require_admin, limiter
from backend.app.database.connection import Base, engine
from backend.app.ai_engine.anpr.ocr_engine import warmup_easyocr, warmup_fast_ocr


logger = logging.getLogger(__name__)


def _migrate_db_columns() -> None:
    """Add new columns to existing tables without destroying existing data.

    SQLAlchemy's create_all() creates missing tables but never alters columns.
    We handle ALTER TABLE here with try/except so it is safe to run repeatedly
    (SQLite raises OperationalError: 'duplicate column name' if the column exists).
    """
    from sqlalchemy import text as _sql_text
    from backend.app.database.connection import engine

    from backend.app.core.config import DATABASE_URL
    _serial = "SERIAL PRIMARY KEY" if DATABASE_URL.startswith("postgresql") else "INTEGER PRIMARY KEY AUTOINCREMENT"

    _alters = [
        # detections — Phase 2 directional entry/exit
        "ALTER TABLE detections ADD COLUMN camera_id    TEXT",
        "ALTER TABLE detections ADD COLUMN orientation  TEXT DEFAULT 'UNKNOWN'",
        "ALTER TABLE detections ADD COLUMN event_type   TEXT DEFAULT 'DETECTION'",
        # vehicle_sessions — Phase 2 directional entry/exit
        "ALTER TABLE vehicle_sessions ADD COLUMN camera_id      TEXT",
        "ALTER TABLE vehicle_sessions ADD COLUMN exit_camera_id TEXT",
        # Composite indexes — Phase 1 performance
        "CREATE INDEX IF NOT EXISTS ix_det_cam_ts       ON detections (camera_id, timestamp)",
        "CREATE INDEX IF NOT EXISTS ix_ses_plate_status ON vehicle_sessions (plate_number, status)",
        "CREATE INDEX IF NOT EXISTS ix_anom_status_sev  ON anomaly_events (status, severity, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_audit_user_ts    ON audit_logs (username, created_at)",
        # Phase 3 — Security: token invalidation on password change
        "ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0",
        # Phase 3 — Watchlist
        "ALTER TABLE vehicles ADD COLUMN is_watchlisted INTEGER DEFAULT 0",
        "ALTER TABLE vehicles ADD COLUMN watchlist_reason TEXT",
    ]

    _create_anomaly_events = f"""
        CREATE TABLE IF NOT EXISTS anomaly_events (
            id              {_serial},
            anomaly_type    TEXT    NOT NULL,
            severity        TEXT    NOT NULL,
            plate_number    TEXT,
            camera_id       TEXT,
            description     TEXT    NOT NULL,
            details         TEXT,
            status          TEXT    NOT NULL DEFAULT 'OPEN',
            acknowledged_by TEXT,
            acknowledged_at TIMESTAMP,
            session_id      INTEGER,
            created_at      TIMESTAMP
        )
    """
    _create_user_vehicles = f"""
        CREATE TABLE IF NOT EXISTS user_vehicles (
            id               {_serial},
            user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            plate_number     TEXT NOT NULL,
            owner_name       TEXT,
            phone_number     TEXT,
            vehicle_type     TEXT,
            registration_date TIMESTAMP,
            created_at       TIMESTAMP,
            UNIQUE(user_id, plate_number)
        )
    """
    _create_audit_logs = f"""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id            {_serial},
            username      TEXT,
            action        TEXT NOT NULL,
            resource_type TEXT,
            resource_id   TEXT,
            details       TEXT,
            ip_address    TEXT,
            created_at    TIMESTAMP
        )
    """

    with engine.connect() as conn:
        for _create_stmt in (_create_anomaly_events, _create_user_vehicles, _create_audit_logs):
            try:
                conn.execute(_sql_text(_create_stmt))
                conn.commit()
            except Exception:
                pass
        for sql in _alters:
            try:
                conn.execute(_sql_text(sql))
                conn.commit()
            except Exception:
                pass   # column already exists — safe to ignore


def _seed_default_admin() -> None:
    """Create admin/Admin@1234 on first run when the users table is empty."""
    from backend.app.database.connection import SessionLocal
    from backend.app.models.user import User
    from backend.app.core.security import hash_password
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            db.add(User(
                username="admin",
                email="admin@anpr.local",
                hashed_password=hash_password("Admin@1234"),
                role="admin",
            ))
            db.commit()
            logger.warning("=" * 58)
            logger.warning("FIRST RUN — default admin account created:")
            logger.warning("  Username : admin")
            logger.warning("  Password : Admin@1234")
            logger.warning("  Change this password immediately after first login.")
            logger.warning("=" * 58)
    finally:
        db.close()


def _prune_detection_storage() -> None:
    """Remove old/excess detection snapshots.

    Policy (both applied each call):
      • Delete files older than DETECTION_MAX_AGE_DAYS days.
      • If total size still exceeds DETECTION_MAX_SIZE_MB, delete the oldest
        files by mtime until the directory is within the size budget.
    """
    cutoff = time.time() - DETECTION_MAX_AGE_DAYS * 86_400
    size_limit_bytes = DETECTION_MAX_SIZE_MB * 1024 * 1024

    files = sorted(DETECTION_DIR.glob("*.jpg"), key=lambda f: f.stat().st_mtime)

    deleted_age = deleted_size = 0
    remaining: list[Path] = []
    for f in files:
        if f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)
            deleted_age += 1
        else:
            remaining.append(f)

    total_bytes = sum(f.stat().st_size for f in remaining if f.exists())
    for f in remaining:
        if total_bytes <= size_limit_bytes:
            break
        try:
            sz = f.stat().st_size
            f.unlink()
            total_bytes -= sz
            deleted_size += 1
        except OSError:
            pass

    if deleted_age or deleted_size:
        logger.info(
            f"Storage pruned: {deleted_age} files > {DETECTION_MAX_AGE_DAYS}d, "
            f"{deleted_size} files over size cap "
            f"({DETECTION_MAX_SIZE_MB} MB). "
            f"Remaining: {len(remaining) - deleted_size} files, "
            f"{total_bytes // 1024 // 1024} MB"
        )


async def _storage_prune_loop() -> None:
    """Run storage pruning once at startup, then every hour."""
    await asyncio.sleep(60)          # wait 1 min after boot for things to settle
    while True:
        try:
            _prune_detection_storage()
        except Exception:
            logger.exception("Storage pruning error")
        await asyncio.sleep(3600)    # run hourly


async def _anomaly_scan_loop() -> None:
    """Run anomaly background scan every 5 minutes."""
    await asyncio.sleep(120)         # wait 2 min after boot
    while True:
        try:
            from backend.app.services.anomaly_engine import run_background_scan
            run_background_scan()
        except Exception:
            logger.exception("Anomaly scan error")
        await asyncio.sleep(300)     # every 5 minutes


async def _report_scheduler_loop() -> None:
    """Check every 60 s whether any scheduled report is due and send it."""
    await asyncio.sleep(180)
    while True:
        try:
            from sqlalchemy import text as _t
            from backend.app.database.connection import engine as _eng
            now = asyncio.get_event_loop().time()
            import datetime as _dt
            _now = _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)

            with _eng.connect() as conn:
                rows = conn.execute(_t(
                    "SELECT id, name, report_type, format, schedule, hour, recipients, last_run "
                    "FROM report_schedules WHERE active = 1"
                )).fetchall()

            for row in rows:
                rid, name, rtype, fmt, schedule, hour, recipients, last_run = row
                if _now.hour != hour:
                    continue
                # Check if already ran today (daily) or this week (weekly)
                if last_run is not None:
                    lr = last_run if isinstance(last_run, _dt.datetime) else _dt.datetime.fromisoformat(str(last_run))
                    if schedule == "daily" and lr.date() >= _now.date():
                        continue
                    if schedule == "weekly":
                        days_since = (_now.date() - lr.date()).days
                        if days_since < 7:
                            continue
                # Generate report
                try:
                    from backend.app.services.report_service import build_report
                    to_dt   = _now
                    from_dt = _now - _dt.timedelta(days=7 if schedule == "weekly" else 1)
                    path = build_report(rtype, fmt, from_dt, to_dt)
                    logger.info(f"Scheduled report '{name}' generated: {path.name}")

                    # Email if recipients configured
                    if recipients.strip():
                        from backend.app.core.config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
                        if SMTP_HOST and SMTP_USER:
                            import smtplib
                            from email.message import EmailMessage
                            msg = EmailMessage()
                            msg["Subject"] = f"ANPR Report: {name}"
                            msg["From"]    = SMTP_USER
                            msg["To"]      = recipients
                            msg.set_content(f"Please find the scheduled report '{name}' attached.")
                            with open(path, "rb") as f:
                                msg.add_attachment(
                                    f.read(),
                                    maintype="application",
                                    subtype="octet-stream",
                                    filename=path.name,
                                )
                            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
                                s.starttls()
                                s.login(SMTP_USER, SMTP_PASSWORD)
                                s.send_message(msg)
                            logger.info(f"Scheduled report emailed to {recipients}")

                    with _eng.connect() as conn:
                        conn.execute(_t(
                            "UPDATE report_schedules SET last_run = :now WHERE id = :id"
                        ), {"now": _now, "id": rid})
                        conn.commit()
                except Exception:
                    logger.exception(f"Scheduled report '{name}' (id={rid}) failed")
        except Exception:
            logger.exception("Report scheduler loop error")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ─────────────────────────────────────────────
    # Store the running event loop so background threads can broadcast WS events
    set_event_loop(asyncio.get_running_loop())

    # Create all DB tables (safe: no-op if already exist)
    Base.metadata.create_all(bind=engine)

    # Import all models so their tables are registered
    import backend.app.models.detections          # noqa: F401
    import backend.app.models.vehicle_sessions    # noqa: F401
    import backend.app.models.vehicle             # noqa: F401
    import backend.app.models.user                # noqa: F401
    import backend.app.models.alert               # noqa: F401
    import backend.app.models.user_vehicle        # noqa: F401
    import backend.app.models.anomaly             # noqa: F401
    import backend.app.models.audit_log          # noqa: F401

    Base.metadata.create_all(bind=engine)

    # Migrate DB columns added after initial schema (safe to run repeatedly)
    _migrate_db_columns()

    # Seed default admin on first run (no-op if users already exist)
    _seed_default_admin()

    # Restore open sessions from DB into memory (sync — runs before first request)
    restore_active_sessions()

    # Background tasks
    asyncio.create_task(session_cleanup_loop())
    asyncio.create_task(_storage_prune_loop())
    asyncio.create_task(_anomaly_scan_loop())
    asyncio.create_task(_report_scheduler_loop())

    # Pre-load EasyOCR model in background so first detection isn't delayed 50+ s
    warmup_easyocr()
    # Pre-load fast-plate-ocr so first live frame doesn't pay the 8-10 s cold-load penalty
    warmup_fast_ocr()

    yield
    # ── Shutdown (nothing to clean up yet) ──────────────────


app = FastAPI(
    title="Smart ANPR System",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach security headers to every response."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        return response


app.add_middleware(_SecurityHeadersMiddleware)

_cors_origins = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Route registration ───────────────────────────────────────
_protected = [Depends(get_current_user)]
_staff     = [Depends(require_staff)]   # admin + operator — blocks vehicle owners
_admin     = [Depends(require_admin)]   # admin only

app.include_router(auth_router)                                   # public + inline admin checks
app.include_router(portal_router,     dependencies=_protected)    # /me/* — all authenticated users
app.include_router(detection_router,  dependencies=_staff)        # staff only
app.include_router(sessions_router,   dependencies=_staff)        # staff only
app.include_router(vehicles_router,   dependencies=_staff)        # staff only
app.include_router(analytics_router,  dependencies=_staff)        # staff only
app.include_router(alerts_router,     dependencies=_staff)        # staff only
app.include_router(anomaly_router,    dependencies=_staff)        # staff only
app.include_router(audit_router,      dependencies=_admin)        # admin only
app.include_router(reports_router,    dependencies=_staff)        # staff only (admin for /schedules)
app.include_router(camera_router)     # per-route auth in camera_routes.py


# ── Database Backup endpoints ────────────────────────────────
@app.get("/admin/backup", dependencies=_admin, tags=["admin"])
async def create_backup():
    """Backup the database. SQLite: file copy. PostgreSQL: pg_dump to SQL file."""
    import datetime as _dt
    import subprocess
    import urllib.parse
    from fastapi import HTTPException
    from backend.app.core.config import BACKUPS_DIR, DATABASE_URL

    ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")

    if DATABASE_URL.startswith("postgresql"):
        parsed = urllib.parse.urlparse(
            DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://")
        )
        dest = BACKUPS_DIR / f"anpr_{ts}.sql"
        cmd = [
            "pg_dump",
            f"--host={parsed.hostname}",
            f"--port={parsed.port or 5432}",
            f"--username={parsed.username}",
            f"--dbname={parsed.path.lstrip('/')}",
            f"--file={dest}",
            "--format=plain",
        ]
        env = {**os.environ, "PGPASSWORD": parsed.password or ""}
        result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"pg_dump failed: {result.stderr[:500]}")
        size_mb = round(dest.stat().st_size / (1024 * 1024), 2)
        return {"filename": dest.name, "size_mb": size_mb, "created_at": ts}
    else:
        db_path = Path(DATABASE_URL.replace("sqlite:///", ""))
        if not db_path.is_file():
            raise HTTPException(status_code=404, detail="Database file not found")
        dest = BACKUPS_DIR / f"anpr_{ts}.db"
        shutil.copy2(str(db_path), str(dest))
        size_mb = round(dest.stat().st_size / (1024 * 1024), 2)
        return {"filename": dest.name, "size_mb": size_mb, "created_at": ts}


@app.get("/admin/backups", dependencies=_admin, tags=["admin"])
async def list_backups():
    """List all backup files in storage/backups/."""
    from backend.app.core.config import BACKUPS_DIR
    files = sorted(
        [f for f in BACKUPS_DIR.iterdir() if f.suffix in {".db", ".sql"}],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    return [
        {
            "filename": f.name,
            "size_mb": round(f.stat().st_size / (1024 * 1024), 2),
            "created_at": f.stat().st_mtime,
        }
        for f in files
    ]


@app.get("/admin/backups/{filename}", dependencies=_admin, tags=["admin"])
async def download_backup(filename: str):
    """Download a specific backup file."""
    from fastapi import HTTPException
    from backend.app.core.config import BACKUPS_DIR
    safe = Path(filename).name
    path = BACKUPS_DIR / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(str(path), filename=safe,
                        media_type="application/octet-stream",
                        headers={"Content-Disposition": f'attachment; filename="{safe}"'})


# ── Health endpoint ──────────────────────────────────────────
@app.get("/health", include_in_schema=True, tags=["system"])
async def health_check():
    """
    System liveness check.  Returns component status for monitoring tools.
    Always returns HTTP 200; check the 'status' field in the response body.
    """
    from sqlalchemy import text as _t

    # ── DB ──────────────────────────────────────────────────────
    db_ok = False
    try:
        with engine.connect() as _conn:
            _conn.execute(_t("SELECT 1"))
        db_ok = True
    except Exception:
        pass

    # ── AI models ───────────────────────────────────────────────
    try:
        from backend.app.ai_engine.anpr.ocr_engine import _easyocr_reader, _fast_plate_model
        easy_ok  = _easyocr_reader is not None
        fast_ok  = _fast_plate_model is not None
    except Exception:
        easy_ok = fast_ok = False

    # ── Camera threads ──────────────────────────────────────────
    try:
        from backend.app.routes.camera_routes import _ANPR_ACTIVE, _ANPR_THREADS
        cam_status = {
            cid: ("running" if active and (t := _ANPR_THREADS.get(cid)) and t.is_alive() else "stopped")
            for cid, active in _ANPR_ACTIVE.items()
        }
    except Exception:
        cam_status = {}

    # ── Active sessions ─────────────────────────────────────────
    try:
        from backend.app.services.session_service import get_active_vehicles
        active_count = len(get_active_vehicles())
    except Exception:
        active_count = -1

    # ── Open anomalies ──────────────────────────────────────────
    try:
        from backend.app.database.connection import SessionLocal
        from backend.app.models.anomaly import AnomalyEvent
        _db = SessionLocal()
        try:
            open_anomalies = _db.query(AnomalyEvent).filter(AnomalyEvent.status == "OPEN").count()
        finally:
            _db.close()
    except Exception:
        open_anomalies = -1

    overall = "healthy" if db_ok else "degraded"
    return {
        "status":           overall,
        "db":               "ok"         if db_ok    else "error",
        "easyocr":          "loaded"     if easy_ok  else "not_loaded",
        "fast_plate_ocr":   "loaded"     if fast_ok  else "not_loaded",
        "cameras":          cam_status,
        "active_cameras":   sum(1 for v in cam_status.values() if v == "running"),
        "active_sessions":  active_count,
        "open_anomalies":   open_anomalies,
    }


# ── WebSocket endpoint ───────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    if not token or decode_token(token) is None:
        await websocket.close(code=4001)
        return
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket)


# ── Authenticated snapshot serving ───────────────────────────
# Replaces the open StaticFiles mount — requires a valid JWT so raw
# URLs cannot be shared or scraped without credentials.
@app.get("/static/detections/{filename}", include_in_schema=False)
async def serve_detection_snapshot(
    filename: str,
    _user: dict = Depends(get_stream_user),   # accepts Bearer header OR ?token=
):
    # Prevent path traversal — only bare filenames allowed
    safe = Path(filename).name
    path = DETECTION_DIR / safe
    if not path.is_file():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(str(path))

# ── Serve built React frontend (production) ───────────────────
# When running in dev mode (npm run dev), this is bypassed because
# API routes above take priority and the Vite dev server runs separately.
_DIST = Path(__file__).resolve().parents[2] / "smart-anpr-dashboard" / "dist"

if _DIST.exists():
    # JS/CSS/image assets produced by `npm run build`
    if (_DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="spa-assets")

    @app.get("/", include_in_schema=False)
    async def spa_root():
        return FileResponse(str(_DIST / "index.html"))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # Serve specific files that exist (favicon, manifest, etc.)
        candidate = _DIST / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        # Everything else → index.html (React Router handles the rest)
        return FileResponse(str(_DIST / "index.html"))
