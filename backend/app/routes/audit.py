"""
audit.py
========
Read-only REST API for the audit log (admin/operator access only via _staff dep).
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query

from backend.app.database.connection import SessionLocal
from backend.app.models.audit_log import AuditLog

router = APIRouter(prefix="/audit", tags=["audit"])


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _row(a: AuditLog) -> dict:
    return {
        "id":            a.id,
        "username":      a.username,
        "action":        a.action,
        "resource_type": a.resource_type,
        "resource_id":   a.resource_id,
        "details":       a.details,
        "ip_address":    a.ip_address,
        "created_at":    a.created_at.isoformat() if a.created_at else None,
    }


@router.get("")
def list_audit_logs(
    username: str | None = Query(None),
    action:   str | None = Query(None),
    days:     int        = Query(7,   ge=1,  le=90),
    limit:    int        = Query(100, ge=1,  le=500),
    offset:   int        = Query(0,   ge=0),
):
    db = SessionLocal()
    try:
        cutoff = _now() - timedelta(days=days)
        q = db.query(AuditLog).filter(AuditLog.created_at >= cutoff)
        if username:
            q = q.filter(AuditLog.username.ilike(f"%{username}%"))
        if action:
            q = q.filter(AuditLog.action == action.upper())
        total = q.count()
        rows  = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
        return {"total": total, "items": [_row(a) for a in rows]}
    finally:
        db.close()


@router.get("/actions")
def list_distinct_actions():
    """Return the set of action types present in the audit log for filter dropdowns."""
    db = SessionLocal()
    try:
        from sqlalchemy import distinct
        rows = db.query(distinct(AuditLog.action)).all()
        return sorted(r[0] for r in rows if r[0])
    finally:
        db.close()
