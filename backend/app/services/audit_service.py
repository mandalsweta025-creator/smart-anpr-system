"""
audit_service.py
================
Lightweight audit logging.  Call log_action() from any route handler.
All writes are fire-and-forget — errors are swallowed so audit logging
never breaks the operation being audited.

Usage
-----
from backend.app.services.audit_service import log_action

log_action(username="admin", action="BLACKLIST_ADD",
           resource_type="plate", resource_id="MH01AB1234",
           details={"reason": "Stolen vehicle"})
"""

import json
import logging

logger = logging.getLogger(__name__)


def log_action(
    action:        str,
    username:      str | None  = None,
    resource_type: str | None  = None,
    resource_id:   str | None  = None,
    details:       dict | None = None,
    ip_address:    str | None  = None,
) -> None:
    """Persist one audit event.  Never raises."""
    try:
        from backend.app.database.connection import SessionLocal
        from backend.app.models.audit_log import AuditLog
        db = SessionLocal()
        try:
            entry = AuditLog(
                username=username,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                details=json.dumps(details) if details else None,
                ip_address=ip_address,
            )
            db.add(entry)
            db.commit()
        finally:
            db.close()
    except Exception as exc:
        logger.debug("Audit log write failed (non-fatal): %s", exc)
