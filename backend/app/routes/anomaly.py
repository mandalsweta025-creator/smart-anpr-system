"""
anomaly.py
==========
REST API for the anomaly detection module.

Endpoints
---------
GET  /anomalies          — paginated list with filters
GET  /anomalies/count    — open counts by severity (for badges)
GET  /anomalies/stats    — aggregate stats for dashboard widget
PATCH /anomalies/{id}/acknowledge   — mark ACKNOWLEDGED (with username)
PATCH /anomalies/{id}/resolve       — mark RESOLVED
PATCH /anomalies/{id}/false_positive — mark FALSE_POSITIVE
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.app.core.security import get_current_user
from backend.app.database.connection import SessionLocal
from backend.app.models.anomaly import AnomalyEvent

router = APIRouter(prefix="/anomalies", tags=["anomalies"])


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_dict(a: AnomalyEvent) -> dict:
    return {
        "id":               a.id,
        "anomaly_type":     a.anomaly_type,
        "severity":         a.severity,
        "plate_number":     a.plate_number,
        "camera_id":        a.camera_id,
        "description":      a.description,
        "details":          a.details,
        "status":           a.status,
        "acknowledged_by":  a.acknowledged_by,
        "acknowledged_at":  a.acknowledged_at.isoformat() if a.acknowledged_at else None,
        "session_id":       a.session_id,
        "created_at":       a.created_at.isoformat() if a.created_at else None,
    }


# ── GET /anomalies ────────────────────────────────────────────────────────────

@router.get("")
def list_anomalies(
    severity:     str | None = Query(None, description="CRITICAL/HIGH/MEDIUM/LOW"),
    status:       str | None = Query(None, description="OPEN/ACKNOWLEDGED/RESOLVED/FALSE_POSITIVE"),
    anomaly_type: str | None = Query(None),
    plate:        str | None = Query(None),
    days:         int        = Query(7,   ge=1,  le=90),
    limit:        int        = Query(100, ge=1,  le=500),
    offset:       int        = Query(0,   ge=0),
):
    db = SessionLocal()
    try:
        cutoff = _now() - timedelta(days=days)
        q = db.query(AnomalyEvent).filter(AnomalyEvent.created_at >= cutoff)
        if severity:
            q = q.filter(AnomalyEvent.severity == severity.upper())
        if status:
            q = q.filter(AnomalyEvent.status == status.upper())
        if anomaly_type:
            q = q.filter(AnomalyEvent.anomaly_type == anomaly_type.upper())
        if plate:
            q = q.filter(AnomalyEvent.plate_number.ilike(f"%{plate}%"))
        total = q.count()
        rows  = (
            q.order_by(AnomalyEvent.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return {"total": total, "items": [_to_dict(a) for a in rows]}
    finally:
        db.close()


# ── GET /anomalies/count ──────────────────────────────────────────────────────

@router.get("/count")
def get_anomaly_counts():
    """Badge counts: open anomalies broken down by severity."""
    db = SessionLocal()
    try:
        base = db.query(AnomalyEvent).filter(AnomalyEvent.status == "OPEN")
        return {
            "total_open": base.count(),
            "critical":   base.filter(AnomalyEvent.severity == "CRITICAL").count(),
            "high":       base.filter(AnomalyEvent.severity == "HIGH").count(),
            "medium":     base.filter(AnomalyEvent.severity == "MEDIUM").count(),
            "low":        base.filter(AnomalyEvent.severity == "LOW").count(),
        }
    finally:
        db.close()


# ── GET /anomalies/stats ──────────────────────────────────────────────────────

@router.get("/stats")
def get_anomaly_stats(days: int = Query(7, ge=1, le=90)):
    """Aggregate stats for the dashboard anomaly widget."""
    db = SessionLocal()
    try:
        cutoff = _now() - timedelta(days=days)
        rows   = db.query(AnomalyEvent).filter(AnomalyEvent.created_at >= cutoff).all()

        by_type:     dict[str, int] = {}
        by_severity: dict[str, int] = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
        by_status:   dict[str, int] = {}

        for r in rows:
            by_type[r.anomaly_type]        = by_type.get(r.anomaly_type, 0) + 1
            by_status[r.status]            = by_status.get(r.status, 0) + 1
            if r.severity in by_severity:
                by_severity[r.severity]   += 1

        return {
            "total":          len(rows),
            "by_type":        by_type,
            "by_severity":    by_severity,
            "by_status":      by_status,
            "open":           by_status.get("OPEN", 0),
            "acknowledged":   by_status.get("ACKNOWLEDGED", 0),
            "resolved":       by_status.get("RESOLVED", 0),
            "false_positives": by_status.get("FALSE_POSITIVE", 0),
        }
    finally:
        db.close()


# ── PATCH /anomalies/{id}/acknowledge ────────────────────────────────────────

def _update_anomaly_status(anomaly_id: int, new_status: str, username: str) -> dict:
    """Shared helper: update anomaly status + write audit log."""
    db = SessionLocal()
    try:
        ev = db.query(AnomalyEvent).filter(AnomalyEvent.id == anomaly_id).first()
        if not ev:
            raise HTTPException(status_code=404, detail="Anomaly not found")
        ev.status          = new_status
        ev.acknowledged_by = username
        ev.acknowledged_at = _now()
        db.commit()
        db.refresh(ev)
        result = _to_dict(ev)
    finally:
        db.close()

    try:
        from backend.app.services.audit_service import log_action
        action_map = {
            "ACKNOWLEDGED":  "ANOMALY_ACK",
            "RESOLVED":      "ANOMALY_RESOLVE",
            "FALSE_POSITIVE":"ANOMALY_FP",
        }
        log_action(
            action=action_map.get(new_status, "ANOMALY_UPDATE"),
            username=username,
            resource_type="anomaly",
            resource_id=str(anomaly_id),
            details={"anomaly_type": result["anomaly_type"], "plate": result["plate_number"]},
        )
    except Exception:
        pass

    return result


@router.patch("/{anomaly_id}/acknowledge")
def acknowledge_anomaly(anomaly_id: int, current_user: dict = Depends(get_current_user)):
    uname = current_user.get("username") or current_user.get("sub", "unknown")
    return _update_anomaly_status(anomaly_id, "ACKNOWLEDGED", uname)


# ── PATCH /anomalies/{id}/resolve ─────────────────────────────────────────────

@router.patch("/{anomaly_id}/resolve")
def resolve_anomaly(anomaly_id: int, current_user: dict = Depends(get_current_user)):
    uname = current_user.get("username") or current_user.get("sub", "unknown")
    return _update_anomaly_status(anomaly_id, "RESOLVED", uname)


# ── PATCH /anomalies/{id}/false_positive ──────────────────────────────────────

@router.patch("/{anomaly_id}/false_positive")
def mark_false_positive(anomaly_id: int, current_user: dict = Depends(get_current_user)):
    uname = current_user.get("username") or current_user.get("sub", "unknown")
    return _update_anomaly_status(anomaly_id, "FALSE_POSITIVE", uname)


# ── POST /anomalies/bulk-action ───────────────────────────────────────────────

class BulkActionRequest(BaseModel):
    ids: list[int]
    action: str  # "acknowledge" | "resolve" | "false_positive"


_BULK_ACTION_MAP = {
    "acknowledge":    "ACKNOWLEDGED",
    "resolve":        "RESOLVED",
    "false_positive": "FALSE_POSITIVE",
}


@router.post("/bulk-action")
def bulk_anomaly_action(req: BulkActionRequest, current_user: dict = Depends(get_current_user)):
    new_status = _BULK_ACTION_MAP.get(req.action.lower())
    if not new_status:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action '{req.action}'. Must be one of: {', '.join(_BULK_ACTION_MAP)}",
        )
    uname = current_user.get("username") or current_user.get("sub", "unknown")
    results = []
    for anomaly_id in req.ids:
        try:
            _update_anomaly_status(anomaly_id, new_status, uname)
            results.append({"id": anomaly_id, "success": True})
        except HTTPException as exc:
            results.append({"id": anomaly_id, "success": False, "error": exc.detail})
    succeeded = sum(1 for r in results if r["success"])
    return {"processed": len(results), "succeeded": succeeded, "results": results}


# ── POST /anomalies/bulk-fp-by-type ──────────────────────────────────────────

class BulkFpByTypeRequest(BaseModel):
    anomaly_type: str
    days: int = 7  # only affect anomalies from the last N days


@router.post("/bulk-fp-by-type")
def bulk_fp_by_type(req: BulkFpByTypeRequest, current_user: dict = Depends(get_current_user)):
    """Mark all non-FP anomalies of a given type as FALSE_POSITIVE."""
    uname = current_user.get("username") or current_user.get("sub", "unknown")
    db = SessionLocal()
    try:
        cutoff = _now() - timedelta(days=req.days)
        targets = (
            db.query(AnomalyEvent)
            .filter(
                AnomalyEvent.anomaly_type == req.anomaly_type.upper(),
                AnomalyEvent.status != "FALSE_POSITIVE",
                AnomalyEvent.created_at >= cutoff,
            )
            .all()
        )
        now = _now()
        for ev in targets:
            ev.status          = "FALSE_POSITIVE"
            ev.acknowledged_by = uname
            ev.acknowledged_at = now
        db.commit()
        count = len(targets)
    finally:
        db.close()

    try:
        from backend.app.services.audit_service import log_action
        log_action(
            action="ANOMALY_BULK_FP_BY_TYPE",
            username=uname,
            resource_type="anomaly",
            resource_id=req.anomaly_type,
            details={"anomaly_type": req.anomaly_type, "count": count, "days": req.days},
        )
    except Exception:
        pass

    return {"anomaly_type": req.anomaly_type, "marked_fp": count}
