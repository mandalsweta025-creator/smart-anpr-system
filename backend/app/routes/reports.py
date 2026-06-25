"""
Report generation API.

POST /reports/generate   — build and download a report
GET  /reports/schedules  — list scheduled reports      (admin only)
POST /reports/schedules  — create a schedule           (admin only)
DELETE /reports/schedules/{id} — remove a schedule     (admin only)
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import text as _sql_text

from backend.app.core.security import require_admin, get_current_user
from backend.app.database.connection import SessionLocal, engine

router = APIRouter(prefix="/reports", tags=["reports"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Request models ────────────────────────────────────────────

class ReportRequest(BaseModel):
    type: str                    # traffic_summary | anomaly_log | session_export
    format: str = "pdf"          # pdf | xlsx
    from_dt: str                 # ISO 8601 datetime string
    to_dt: str                   # ISO 8601 datetime string


class ScheduleCreate(BaseModel):
    name: str
    report_type: str             # traffic_summary | anomaly_log | session_export
    format: str = "pdf"
    schedule: str = "daily"      # daily | weekly
    hour: int = 8                # 0–23
    recipients: str = ""         # comma-separated emails
    active: bool = True


# ── Ensure schedule table exists ──────────────────────────────

def _ensure_schedule_table() -> None:
    from backend.app.core.config import DATABASE_URL
    _serial = "SERIAL PRIMARY KEY" if DATABASE_URL.startswith("postgresql") else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with engine.connect() as conn:
        try:
            conn.execute(_sql_text(f"""
                CREATE TABLE IF NOT EXISTS report_schedules (
                    id          {_serial},
                    name        TEXT    NOT NULL,
                    report_type TEXT    NOT NULL,
                    format      TEXT    NOT NULL DEFAULT 'pdf',
                    schedule    TEXT    NOT NULL DEFAULT 'daily',
                    hour        INTEGER NOT NULL DEFAULT 8,
                    recipients  TEXT    NOT NULL DEFAULT '',
                    last_run    TIMESTAMP,
                    created_by  TEXT,
                    active      INTEGER NOT NULL DEFAULT 1,
                    created_at  TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass


_ensure_schedule_table()


# ══════════════════════════════════════════════════════════════
#  REPORT GENERATION
# ══════════════════════════════════════════════════════════════

_VALID_TYPES = {"traffic_summary", "anomaly_log", "session_export"}
_VALID_FMT   = {"pdf", "xlsx"}

_MIME = {
    "pdf":  "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@router.post("/generate")
def generate_report(
    req: ReportRequest,
    current_user: dict = Depends(get_current_user),
):
    """Build and stream a report file back to the caller."""
    if req.type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid report type. Choose: {_VALID_TYPES}")
    if req.format not in _VALID_FMT:
        raise HTTPException(status_code=400, detail=f"Invalid format. Choose: pdf or xlsx")

    try:
        from_dt = datetime.fromisoformat(req.from_dt)
        to_dt   = datetime.fromisoformat(req.to_dt)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO 8601.")

    if from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from_dt must be before to_dt.")

    # Strip timezone for SQLite compatibility
    from_dt = from_dt.replace(tzinfo=None)
    to_dt   = to_dt.replace(tzinfo=None)

    try:
        from backend.app.services.report_service import build_report
        path = build_report(req.type, req.format, from_dt, to_dt)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {exc}")

    return FileResponse(
        path=str(path),
        media_type=_MIME[req.format],
        filename=path.name,
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )


# ══════════════════════════════════════════════════════════════
#  SCHEDULED REPORTS  (admin only)
# ══════════════════════════════════════════════════════════════

@router.get("/schedules", dependencies=[Depends(require_admin)])
def list_schedules():
    with engine.connect() as conn:
        rows = conn.execute(_sql_text(
            "SELECT id, name, report_type, format, schedule, hour, recipients, "
            "last_run, created_by, active, created_at FROM report_schedules ORDER BY id"
        )).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/schedules", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_schedule(
    req: ScheduleCreate,
    current_user: dict = Depends(get_current_user),
):
    if req.report_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail="Invalid report_type")
    if req.format not in _VALID_FMT:
        raise HTTPException(status_code=400, detail="Invalid format")
    if req.schedule not in {"daily", "weekly"}:
        raise HTTPException(status_code=400, detail="schedule must be daily or weekly")
    if not (0 <= req.hour <= 23):
        raise HTTPException(status_code=400, detail="hour must be 0–23")

    with engine.connect() as conn:
        conn.execute(_sql_text("""
            INSERT INTO report_schedules
              (name, report_type, format, schedule, hour, recipients, created_by, active, created_at)
            VALUES (:name, :rt, :fmt, :sched, :hour, :recip, :creator, :active, :now)
        """), {
            "name": req.name, "rt": req.report_type, "fmt": req.format,
            "sched": req.schedule, "hour": req.hour, "recip": req.recipients,
            "creator": current_user.get("sub", "unknown"),
            "active": 1 if req.active else 0,
            "now": _utcnow(),
        })
        conn.commit()
        row_id = conn.execute(_sql_text("SELECT last_insert_rowid()")).scalar()
    return {"success": True, "id": row_id}


@router.delete("/schedules/{schedule_id}", dependencies=[Depends(require_admin)])
def delete_schedule(schedule_id: int):
    with engine.connect() as conn:
        result = conn.execute(
            _sql_text("DELETE FROM report_schedules WHERE id = :id"),
            {"id": schedule_id},
        )
        conn.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"success": True}
