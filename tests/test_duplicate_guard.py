"""
tests/test_duplicate_guard.py
==============================
Verifies that the per-camera DuplicateGuard fix works correctly.

The critical case being tested:
  - Camera A (ENTRY gate) sees MH12AB1234 at T=0
  - Camera B (EXIT gate)  sees MH12AB1234 at T=5s  (well within 120s cooldown)

OLD behaviour (shared guard): Camera B is SUPPRESSED — exit is never recorded.
NEW behaviour (per-cam guard): Camera B has its own clean guard — exit fires correctly.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
from backend.app.ai_engine.anpr.duplicate_guard import DuplicateGuard

PLATE = "MH12AB1234"

# ─────────────────────────────────────────────────────────────────
# TEST 1 — Shared guard (the old broken design, for reference)
# ─────────────────────────────────────────────────────────────────
def test_shared_guard_blocks_exit():
    """Demonstrate what the OLD single shared guard did wrong."""
    shared = DuplicateGuard()

    # ENTRY camera fires
    allowed_entry = shared.should_save(PLATE, 0.90)
    assert allowed_entry, "Entry should be allowed"

    # EXIT camera fires 5 seconds later — still within 120s cooldown
    allowed_exit = shared.should_save(PLATE, 0.85)

    # With a shared guard, exit IS blocked
    assert not allowed_exit, (
        "Shared guard DOES suppress the exit — this is the bug we fixed"
    )
    print("TEST 1 PASSED — confirmed: shared guard blocks exit (expected old bug)")


# ─────────────────────────────────────────────────────────────────
# TEST 2 — Per-camera guards (the new correct design)
# ─────────────────────────────────────────────────────────────────
def test_per_camera_guards_allow_exit():
    """Per-camera guards: cam-A cooldown never affects cam-B."""
    cam_guards = {}   # mirrors _duplicate_guards in camera_routes.py

    cam_a_guard = cam_guards.setdefault("cam-entry", DuplicateGuard())
    cam_b_guard = cam_guards.setdefault("cam-exit",  DuplicateGuard())

    # ENTRY camera fires at T=0
    allowed_entry = cam_a_guard.should_save(PLATE, 0.90)
    assert allowed_entry, "Entry should be allowed on cam-entry"

    # EXIT camera fires 5 seconds later
    # cam-exit has never seen this plate → should allow
    allowed_exit = cam_b_guard.should_save(PLATE, 0.85)
    assert allowed_exit, (
        "EXIT camera must NOT be blocked by the entry camera's cooldown"
    )
    print("TEST 2 PASSED — per-camera guards: exit allowed independently of entry")


# ─────────────────────────────────────────────────────────────────
# TEST 3 — Same camera still deduplicates correctly
# ─────────────────────────────────────────────────────────────────
def test_same_camera_still_deduplicates():
    """A single camera still suppresses the same plate within its own cooldown."""
    cam_guards = {}
    guard = cam_guards.setdefault("cam-entry", DuplicateGuard())

    first  = guard.should_save(PLATE, 0.90)
    second = guard.should_save(PLATE, 0.88)   # same camera, same plate, < 120s

    assert first,  "First detection should be saved"
    assert not second, "Second detection on same camera should be suppressed"
    print("TEST 3 PASSED — same camera still deduplicates within cooldown")


# ─────────────────────────────────────────────────────────────────
# TEST 4 — Two EXIT cameras for the same plate
# ─────────────────────────────────────────────────────────────────
def test_two_exit_cameras_independent():
    """
    If somehow two cameras both configured as EXIT see the same plate,
    each makes its own independent decision. The second one will also
    fire (session_service handles the 'no active session' case gracefully).
    """
    cam_guards = {}
    guard_exit1 = cam_guards.setdefault("cam-exit-1", DuplicateGuard())
    guard_exit2 = cam_guards.setdefault("cam-exit-2", DuplicateGuard())

    allowed1 = guard_exit1.should_save(PLATE, 0.85)
    allowed2 = guard_exit2.should_save(PLATE, 0.82)

    assert allowed1, "First exit camera should fire"
    assert allowed2, "Second exit camera should also fire independently"
    print("TEST 4 PASSED — two exit cameras are independent (session_service handles gracefully)")


# ─────────────────────────────────────────────────────────────────
# TEST 5 — Fuzzy plate variant across cameras
# ─────────────────────────────────────────────────────────────────
def test_fuzzy_variant_cross_camera():
    """
    OCR on entry cam reads MH12AB1234; exit cam reads MH12AB1Z34 (I→Z confusion).
    Per-camera guards: exit cam guard has never seen either → exit fires.
    session_service.force_exit_vehicle uses fuzzy match to find the session.
    """
    cam_guards = {}
    entry_guard = cam_guards.setdefault("cam-entry", DuplicateGuard())
    exit_guard  = cam_guards.setdefault("cam-exit",  DuplicateGuard())

    entry_guard.should_save("MH12AB1234", 0.90)   # entry cam, clean read

    # Exit cam reads a 1-char variant — never seen it, should allow
    allowed = exit_guard.should_save("MH12AB1Z34", 0.82)
    assert allowed, "Exit cam variant should not be blocked by entry cam guard"
    print("TEST 5 PASSED — fuzzy variant on exit cam is not blocked by entry cam guard")


# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        test_shared_guard_blocks_exit,
        test_per_camera_guards_allow_exit,
        test_same_camera_still_deduplicates,
        test_two_exit_cameras_independent,
        test_fuzzy_variant_cross_camera,
    ]

    passed = failed = 0
    print("\n" + "="*60)
    print("  DuplicateGuard cross-camera isolation tests")
    print("="*60)
    for t in tests:
        try:
            t()
            passed += 1
        except AssertionError as e:
            print(f"FAILED  {t.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"ERROR   {t.__name__}: {e}")
            failed += 1

    print("="*60)
    print(f"  {passed} passed, {failed} failed")
    print("="*60 + "\n")
    sys.exit(0 if failed == 0 else 1)
