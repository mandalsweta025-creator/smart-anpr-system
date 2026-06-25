"""
tests/test_session_cross_camera.py
====================================
Integration test: simulates a real entry-camera → exit-camera session cycle
against the actual SQLite database.

Scenario
--------
  cam-entry  (role=entry)  sees MH99ZZ0001 → session opens
  cam-exit   (role=exit)   sees MH99ZZ0001 5 s later → session closes
  cam-exit   sees a different plate MH99ZZ0002 (never entered) → logs as DETECTION

Verifies
--------
  1. ENTRY  event_type returned
  2. A DB session row was created with camera_id = "cam-entry"
  3. EXIT   event_type returned (not "DETECTION")
  4. Session row has exit_time set and exit_camera_id = "cam-exit"
  5. Plate that was never entered → force_exit returns "DETECTION", no crash

Cleanup: deletes the test rows it created so the real DB stays clean.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone

# ── use the real DB (same one the server uses) ─────────────────────
from backend.app.database.connection import SessionLocal, Base, engine
from backend.app.models.vehicle_sessions import VehicleSession  # noqa: F401
from backend.app.models.detections import Detection            # noqa: F401
from backend.app.models.user import User                       # noqa: F401
from backend.app.models.alert import Alert                     # noqa: F401

# ensure tables exist
Base.metadata.create_all(bind=engine)

from backend.app.services.session_service import (
    handle_vehicle_session,
    active_sessions,
    force_exit_vehicle,
    normalize_plate,
)

# ── unique plate numbers so this test never clashes with real data ──
PLATE_ENTRY_EXIT = "MH99ZZ0001"
PLATE_NO_ENTRY   = "MH99ZZ0002"
CAM_ENTRY = "test-cam-entry"
CAM_EXIT  = "test-cam-exit"


def _cleanup():
    db = SessionLocal()
    try:
        for p in [PLATE_ENTRY_EXIT, PLATE_NO_ENTRY]:
            db.query(VehicleSession).filter(VehicleSession.plate_number == p).delete()
        db.commit()
    finally:
        db.close()
    # also remove from in-memory cache
    active_sessions.pop(normalize_plate(PLATE_ENTRY_EXIT), None)
    active_sessions.pop(normalize_plate(PLATE_NO_ENTRY), None)


def _fetch_session(plate: str):
    db = SessionLocal()
    try:
        return (
            db.query(VehicleSession)
            .filter(VehicleSession.plate_number == plate)
            .order_by(VehicleSession.entry_time.desc())
            .first()
        )
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────
def test_entry_creates_session():
    _cleanup()
    ev = handle_vehicle_session(PLATE_ENTRY_EXIT, camera_id=CAM_ENTRY, camera_role="entry")
    assert ev == "ENTRY", f"Expected ENTRY, got {ev!r}"

    row = _fetch_session(PLATE_ENTRY_EXIT)
    assert row is not None, "No session row created in DB"
    assert row.camera_id == CAM_ENTRY, f"Expected camera_id={CAM_ENTRY!r}, got {row.camera_id!r}"
    assert row.status == "ENTERED", f"Expected ENTERED, got {row.status!r}"
    assert row.exit_time is None, "exit_time should be None for active session"
    print(f"TEST 1 PASSED — session created: id={row.id}, cam={row.camera_id}")


def test_exit_on_different_camera_closes_session():
    # session must exist from test 1 — run after it
    ev = handle_vehicle_session(PLATE_ENTRY_EXIT, camera_id=CAM_EXIT, camera_role="exit")
    assert ev == "EXIT", (
        f"Expected EXIT, got {ev!r}. "
        "If this is 'DETECTION', the session was not found — "
        "possibly the DuplicateGuard is still shared."
    )

    row = _fetch_session(PLATE_ENTRY_EXIT)
    assert row.status == "EXITED", f"Session status should be EXITED, got {row.status!r}"
    assert row.exit_time is not None, "exit_time must be set"
    assert row.exit_camera_id == CAM_EXIT, (
        f"exit_camera_id should be {CAM_EXIT!r}, got {row.exit_camera_id!r}"
    )
    assert row.camera_id == CAM_ENTRY, (
        f"entry camera_id should still be {CAM_ENTRY!r}, got {row.camera_id!r}"
    )
    assert row.duration_minutes is not None, "duration_minutes should be set"
    print(
        f"TEST 2 PASSED — session closed: "
        f"entry_cam={row.camera_id}, exit_cam={row.exit_camera_id}, "
        f"duration={row.duration_minutes:.2f} min"
    )


def test_exit_without_prior_entry_returns_detection():
    _cleanup()  # make sure no leftover session
    ev = handle_vehicle_session(PLATE_NO_ENTRY, camera_id=CAM_EXIT, camera_role="exit")
    assert ev == "DETECTION", (
        f"Expected DETECTION (no active session), got {ev!r}"
    )
    row = _fetch_session(PLATE_NO_ENTRY)
    assert row is None, "No session should have been created for an exit-only plate"
    print("TEST 3 PASSED — exit with no prior entry → DETECTION, no session row created")


def test_entry_camera_does_not_duplicate_session():
    _cleanup()
    ev1 = handle_vehicle_session(PLATE_ENTRY_EXIT, camera_id=CAM_ENTRY, camera_role="entry")
    ev2 = handle_vehicle_session(PLATE_ENTRY_EXIT, camera_id=CAM_ENTRY, camera_role="entry")
    assert ev1 == "ENTRY",     f"First detection should be ENTRY, got {ev1!r}"
    assert ev2 == "DETECTION", f"Second detection at entry gate should be DETECTION, got {ev2!r}"

    db = SessionLocal()
    try:
        count = db.query(VehicleSession).filter(
            VehicleSession.plate_number == PLATE_ENTRY_EXIT
        ).count()
    finally:
        db.close()
    assert count == 1, f"Only one session should exist, found {count}"
    print("TEST 4 PASSED — entry camera fires twice → only one session created")
    _cleanup()


# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        test_entry_creates_session,
        test_exit_on_different_camera_closes_session,
        test_exit_without_prior_entry_returns_detection,
        test_entry_camera_does_not_duplicate_session,
    ]

    passed = failed = 0
    print("\n" + "="*60)
    print("  Session cross-camera integration tests")
    print("="*60)
    for t in tests:
        try:
            t()
            passed += 1
        except AssertionError as e:
            print(f"FAILED  {t.__name__}:\n         {e}")
            failed += 1
        except Exception as e:
            import traceback
            print(f"ERROR   {t.__name__}:")
            traceback.print_exc()
            failed += 1

    _cleanup()   # always clean up regardless of result
    print("="*60)
    print(f"  {passed} passed, {failed} failed")
    print("="*60 + "\n")
    sys.exit(0 if failed == 0 else 1)
