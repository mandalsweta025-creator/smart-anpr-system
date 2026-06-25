"""
camera_routes.py
================
REST API for multi-camera management.
"""

import asyncio
import logging
import socket
import threading
import time
from collections import deque
from datetime import datetime, timezone
from urllib.parse import urlparse

import cv2
from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from backend.app.core.security import get_current_user, get_stream_user

from backend.app.infrastructure.camera_manager import CameraManager
from backend.app.infrastructure.camera_registry import CameraRegistry
from backend.app.ai_engine.anpr.ocr_engine import (
    detect_plates_in_frame, extract_best_result, _is_frame_usable,
    easyocr_run_count as _easyocr_run_count,
)
from backend.app.ai_engine.anpr.duplicate_guard import DuplicateGuard, plate_edit_distance
from backend.app.database.crud import save_detection, save_alert
from backend.app.services.session_service import handle_vehicle_session
from backend.app.services.websocket_service import broadcast_detection_event
from backend.app.services.alert_service import AlertService
from backend.app.core.config import (
    DETECTION_DIR,
    MIN_FAST_OCR_CONFIDENCE,
    VOTE_WINDOW,
    VOTE_MIN,
    VOTE_BYPASS,
    RECONFIRM_SUPPRESS_SECS,
    FRAME_BLUR_THRESHOLD,
)

logger = logging.getLogger(__name__)

router = APIRouter()
manager = CameraManager()
camera_registry = CameraRegistry()
# Per-camera DuplicateGuards — keyed by cam_id.
# ONE guard per camera so that Camera-A's 120 s cooldown never blocks Camera-B
# from recording an EXIT event for the same plate.  Without this, a vehicle that
# enters via cam-A and exits via cam-B within 120 s would have its EXIT swallowed.
_duplicate_guards: dict[str, DuplicateGuard] = {}
_alert_service = AlertService()

_ANPR_THREADS: dict[str, threading.Thread] = {}
_ANPR_ACTIVE: dict[str, bool] = {}
_anpr_start_lock = threading.Lock()   # prevents race-condition double-starts (Issue 7)
OCR_FRAME_SKIP = 1   # run OCR every frame (EasyOCR itself takes ~3s, no point skipping)

# Per-camera adaptive blur threshold.  Starts at the global config value and is
# halved automatically when the quality gate is rejecting > 80% of frames over a
# 50-frame window.  Floor is 10.0 to avoid accepting completely unusable frames.
_cam_blur_threshold: dict[str, float] = {}
_BLUR_FLOOR = 10.0
_BLUR_AUTOCALIB_WINDOW  = 50    # frames to observe before adjusting
_BLUR_AUTOCALIB_TRIGGER = 0.80  # reject-rate that triggers a halving

# ── Per-camera runtime statistics ─────────────────────────────
# Accumulated by _anpr_loop; exposed via GET /metrics.
# Reset on camera stop so numbers reflect the current session only.
_cam_stats: dict[str, dict] = {}


def _get_stats(cam_id: str) -> dict:
    return _cam_stats.setdefault(cam_id, {
        "frames_total":            0,
        "frames_accepted":         0,
        "frames_rejected_quality": 0,
        "ocr_runs":                0,
        "plates_detected":         0,   # frames where OCR found ≥1 valid plate
        "plates_confirmed":        0,   # plates that passed voting + DupGuard
        "vote_confirmed":          0,   # confirmed via vote path
        "bypass_confirmed":        0,   # confirmed via high-conf bypass
        "duplicate_suppressed":    0,   # DuplicateGuard rejections
        "latencies_ms":            [],  # rolling last-100 OCR latencies
        "last_detection_ts":       None,  # epoch float of last saved detection
        "start_time":              time.time(),
        # Confidence histogram: buckets [0.5–0.6, 0.6–0.7, 0.7–0.8, 0.8–0.9, 0.9+]
        "conf_buckets":            [0, 0, 0, 0, 0],
    })


# ── Per-camera re-confirmation suppression ─────────────────────
# After a plate is voted/bypass-confirmed, suppress re-confirmation for
# RECONFIRM_SUPPRESS_SECS so the vote buffer doesn't emit it every frame.
# The DuplicateGuard (120 s) already prevents re-saving; this is about
# eliminating log spam and unnecessary downstream work.
_confirm_timestamps: dict[str, dict[str, float]] = {}   # cam_id → {plate → ts}

# ── Vehicle orientation tracker (MIXED cameras only) ───────────────────────
# Tracks the pixel area of plate crops across recent OCR frames to infer
# whether a vehicle is approaching (ENTRY) or leaving (EXIT) the camera.
#
# Principle: a plate crop grows when the vehicle moves closer and shrinks
# when it moves away.  Comparing the mean area of the first half of the
# history window against the second half gives a robust direction signal
# without any per-frame threshold tuning.
#
# Thresholds: +15 % growth → ENTRY, −15 % shrink → EXIT, else UNKNOWN
# (falls back to timeout-based mixed behaviour).
_approach_tracker: dict[str, deque] = {}   # cam_id → deque of crop areas (px²)
_APPROACH_WINDOW = 16    # samples to keep per camera
_APPROACH_MIN_SAMPLES = 8  # minimum samples before classifying
_APPROACH_THRESHOLD = 0.15  # 15 % ratio change required for a confident call


def _record_crop_size(cam_id: str, plates: list[dict]) -> None:
    """Record the largest plate crop area seen this frame."""
    if not plates:
        return
    area = max(
        p["crop"].shape[0] * p["crop"].shape[1]
        for p in plates
        if p.get("crop") is not None and p["crop"].size > 0
    )
    tracker = _approach_tracker.setdefault(cam_id, deque(maxlen=_APPROACH_WINDOW))
    tracker.append(float(area))


def _classify_approach(cam_id: str) -> str | None:
    """
    Return "entry" (approaching), "exit" (receding), or None (uncertain).

    Uses the first-half vs. second-half mean crop area ratio.
    Returns None when there are fewer than _APPROACH_MIN_SAMPLES samples.
    """
    history = _approach_tracker.get(cam_id)
    if not history or len(history) < _APPROACH_MIN_SAMPLES:
        return None
    samples = list(history)
    mid = len(samples) // 2
    first_mean  = sum(samples[:mid]) / mid
    second_mean = sum(samples[mid:]) / (len(samples) - mid)
    if first_mean < 1:
        return None
    ratio = second_mean / first_mean
    if ratio > 1 + _APPROACH_THRESHOLD:
        return "entry"
    if ratio < 1 - _APPROACH_THRESHOLD:
        return "exit"
    return None


def _probe_source(source: str) -> dict:
    """Quick socket connectivity check for HTTP/RTSP stream URLs.

    Returns a dict with keys: reachable (bool), hint (str), host, port.
    For integer (webcam index) sources always returns reachable=True.
    """
    if not isinstance(source, str) or source.isdigit():
        return {"reachable": True, "hint": ""}
    try:
        parsed = urlparse(source)
        host = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme in ("https", "rtsps") else 80)
        if not host:
            return {"reachable": False, "host": "", "port": 0,
                    "hint": f"Cannot parse a hostname from URL: {source}"}
        with socket.create_connection((host, port), timeout=3):
            return {"reachable": True, "host": host, "port": port,
                    "hint": f"Network OK ({host}:{port} reachable) — OpenCV could not decode the stream. "
                            "Try a different URL path (e.g. /videofeed or /mjpeg) or restart the camera app."}
    except socket.timeout:
        return {"reachable": False, "host": host, "port": port,
                "hint": f"Timed out connecting to {host}:{port}. Is the device on the same Wi-Fi network?"}
    except ConnectionRefusedError:
        return {"reachable": False, "host": host, "port": port,
                "hint": f"Connection refused at {host}:{port}. Is the IP Webcam / DroidCam app running on the device?"}
    except socket.gaierror:
        return {"reachable": False, "host": host, "port": 0,
                "hint": f"Cannot resolve hostname '{host}'. Check the URL."}
    except OSError as exc:
        return {"reachable": False, "host": host, "port": port,
                "hint": f"Cannot reach {host}:{port} — {exc}"}


def cleanup_duplicate_guard() -> None:
    """Prune stale entries from all per-camera duplicate guards. Called by session_cleanup_loop."""
    for guard in _duplicate_guards.values():
        guard.cleanup()

# ── Frame-level voting ─────────────────────────────────────────────────────────
# All three constants come from config.py — edit there to tune behaviour.
#
# Confirmation paths:
#   (a) VOTE_MIN of the last VOTE_WINDOW OCR frames show the same plate text.
#   (b) A single frame with confidence ≥ VOTE_BYPASS (truly unambiguous reads).
#
# Path (b) is intentionally set to a very high threshold (0.92) so it does NOT
# fire for ordinary 0.70–0.85 reads — those must accumulate VOTE_MIN frames.
# Previously HIGH_CONF_BYPASS was equal to MIN_FAST_OCR_CONFIDENCE (0.70),
# which meant every plate that passed the OCR gate also bypassed voting.
# That defeated multi-frame confirmation entirely.

_vote_buffers: dict[str, deque] = {}


def _voted_plates(cam_id: str, plates: list[dict]) -> list[dict]:
    """
    Update the per-camera sliding vote window and return plates that have
    accumulated enough consistent reads to be considered confirmed.

    Each call represents one OCR frame.  `plates` may be empty (no plate found
    in this frame) — that counts as a "miss" and dilutes any plate's vote count
    once the empty frame enters the window.
    """
    if cam_id not in _vote_buffers:
        _vote_buffers[cam_id] = deque(maxlen=VOTE_WINDOW)

    # Record this frame's findings (empty dict if no plates detected)
    frame_map = {p["text"]: p for p in plates}
    _vote_buffers[cam_id].append(frame_map)

    # Tally votes and track the highest-confidence read for each plate text
    vote_counts: dict[str, int] = {}
    best: dict[str, dict] = {}
    for frame in _vote_buffers[cam_id]:
        for text, det in frame.items():
            vote_counts[text] = vote_counts.get(text, 0) + 1
            if text not in best or det["confidence"] > best[text]["confidence"]:
                best[text] = det

    # ── Fuzzy vote merging ────────────────────────────────────────
    # Plates within Levenshtein distance 1 are treated as the same vehicle
    # (e.g. KL58AH0969 and KL58AM0969 — one character OCR confusion).
    # Merge their vote counts; the highest-confidence reading becomes canonical.
    plates      = list(vote_counts.keys())
    merged_cnt  : dict[str, int]  = {}   # canonical plate → total votes
    merged_best : dict[str, dict] = {}   # canonical plate → best detection entry
    assigned    : set[str]        = set()

    for p in plates:
        if p in assigned:
            continue
        group = [p]
        assigned.add(p)
        for q in plates:
            if q not in assigned and plate_edit_distance(p, q) <= 1:
                group.append(q)
                assigned.add(q)
        # Canonical = longest plate string first (OCR dropping a digit is
        # far more common than hallucinating one), then highest confidence.
        # This ensures GJ08FA2057 beats GJ08FA205 in the same fuzzy group.
        canonical = max(group, key=lambda g: (len(g), best[g]["confidence"]))
        total_cnt = sum(vote_counts[g] for g in group)
        merged_cnt[canonical]  = total_cnt
        merged_best[canonical] = best[canonical]

    confirmed = []
    n_buf     = len(_vote_buffers[cam_id])
    now_ts    = time.time()
    cam_confirms = _confirm_timestamps.setdefault(cam_id, {})

    for text, cnt in merged_cnt.items():
        det  = merged_best[text]
        conf = det["confidence"]

        if cnt < VOTE_MIN and conf < VOTE_BYPASS:
            logger.debug(
                f"[{cam_id}] Voting {text}: {cnt}/{VOTE_MIN} frames "
                f"(window {n_buf}/{VOTE_WINDOW}, conf={conf:.2f})"
            )
            continue

        # Suppress re-confirmation within RECONFIRM_SUPPRESS_SECS.
        # The DuplicateGuard (120 s) already prevents re-saving to the DB;
        # this shorter gate stops the vote buffer from emitting a confirm
        # log and downstream work every OCR frame while the vehicle is
        # still parked in front of the camera.
        last_confirmed = cam_confirms.get(text, 0.0)
        if now_ts - last_confirmed < RECONFIRM_SUPPRESS_SECS:
            logger.debug(
                f"[{cam_id}] Re-confirm suppressed: {text} "
                f"(last {now_ts - last_confirmed:.1f}s ago)"
            )
            continue
        cam_confirms[text] = now_ts

        if cnt >= VOTE_MIN:
            logger.info(
                f"[{cam_id}] Vote confirmed {text}: {cnt}/{VOTE_MIN} frames "
                f"(conf={conf:.2f})"
            )
            det["_confirm_path"] = "vote"
            confirmed.append(det)
            continue

        if conf >= VOTE_BYPASS:
            logger.info(
                f"[{cam_id}] Bypass confirmed {text}: conf={conf:.2f} ≥ {VOTE_BYPASS}"
            )
            det["_confirm_path"] = "bypass"
            confirmed.append(det)

    return confirmed


def _anpr_loop(cam_id: str) -> None:
    counter      = 0
    fps_t0       = time.perf_counter()
    fps_frames   = 0
    stats        = _get_stats(cam_id)
    cam_role     = camera_registry.get_role(cam_id)   # "entry" | "exit" | "mixed"
    # Initialise per-camera adaptive blur threshold from the global config value.
    if cam_id not in _cam_blur_threshold:
        _cam_blur_threshold[cam_id] = FRAME_BLUR_THRESHOLD
    _autocalib_window_frames = 0
    _autocalib_window_rejects = 0
    logger.info(f"ANPR loop started for camera {cam_id} (blur_threshold={_cam_blur_threshold[cam_id]:.1f})")

    while _ANPR_ACTIVE.get(cam_id, False):
        frame = manager.frames.get(cam_id)
        if frame is None:
            time.sleep(0.05)
            continue

        # Skip frames that are older than the inference budget.
        # When YOLO+OCR takes 5–15 s per frame, the camera buffer fills up with
        # stale frames. Processing a frame that's already 10 s old is wasteful —
        # the vehicle may have already left. We always take the LATEST frame.
        frame_age = time.time() - manager.last_frame_ts.get(cam_id, 0)
        if frame_age > 3.0:
            logger.debug(f"[{cam_id}] Stale frame skipped ({frame_age:.1f}s old) — taking latest")
            time.sleep(0.05)
            continue

        counter += 1
        if counter % OCR_FRAME_SKIP != 0:
            time.sleep(0.01)
            continue

        stats["frames_total"] += 1
        _autocalib_window_frames += 1

        # Skip frames that are too blurry, too dark, or overexposed.
        # Use the per-camera adaptive threshold (auto-lowered if rejection > 80%).
        from backend.app.ai_engine.anpr.ocr_engine import _is_frame_usable_threshold
        if not _is_frame_usable_threshold(frame, _cam_blur_threshold[cam_id]):
            stats["frames_rejected_quality"] += 1
            _autocalib_window_rejects += 1
            logger.debug(f"[{cam_id}] Frame skipped: failed quality gate (blur_thr={_cam_blur_threshold[cam_id]:.1f})")
            time.sleep(0.03)

            # Auto-calibrate: if rejection > 80% over the last N frames, halve threshold
            if _autocalib_window_frames >= _BLUR_AUTOCALIB_WINDOW:
                rej_rate = _autocalib_window_rejects / _autocalib_window_frames
                if rej_rate > _BLUR_AUTOCALIB_TRIGGER:
                    old = _cam_blur_threshold[cam_id]
                    _cam_blur_threshold[cam_id] = max(_BLUR_FLOOR, old / 2.0)
                    logger.warning(
                        f"[{cam_id}] Quality gate auto-calibrated: {old:.1f} → "
                        f"{_cam_blur_threshold[cam_id]:.1f} "
                        f"(rejection was {rej_rate:.0%} over {_autocalib_window_frames} frames)"
                    )
                _autocalib_window_frames  = 0
                _autocalib_window_rejects = 0
            continue

        stats["frames_accepted"] += 1

        try:
            t_frame = time.perf_counter()
            plates  = detect_plates_in_frame(frame, cam_id=cam_id)
            latency_ms = (time.perf_counter() - t_frame) * 1000

            # Rolling latency history (last 100 frames)
            stats["ocr_runs"] += 1
            lats = stats["latencies_ms"]
            lats.append(latency_ms)
            if len(lats) > 100:
                stats["latencies_ms"] = lats[-100:]

            if plates:
                stats["plates_detected"] += 1
                if cam_role == "mixed":
                    _record_crop_size(cam_id, plates)

            fps_frames += 1
            fps_elapsed = time.perf_counter() - fps_t0
            if fps_frames >= 20:
                fps = fps_frames / fps_elapsed if fps_elapsed > 0 else 0
                rej_rate = stats["frames_rejected_quality"] / max(stats["frames_total"], 1)
                logger.info(
                    f"[{cam_id}] Perf — OCR fps: {fps:.1f} | "
                    f"last: {latency_ms:.0f} ms | "
                    f"quality-gate reject: {rej_rate:.0%}"
                )
                fps_t0     = time.perf_counter()
                fps_frames = 0

            voted = _voted_plates(cam_id, plates)
            if not voted:
                continue

            for detection in voted:
                plate      = detection["text"]
                confidence = detection["confidence"]
                crop       = detection["crop"]

                # Final confidence gate — belt-and-suspenders check that no
                # low-confidence read slips through via the voting path.
                if confidence < MIN_FAST_OCR_CONFIDENCE:
                    logger.debug(
                        f"[{cam_id}] Pre-save gate rejected: "
                        f"{plate} ({confidence:.2f} < {MIN_FAST_OCR_CONFIDENCE})"
                    )
                    continue

                cam_guard = _duplicate_guards.setdefault(cam_id, DuplicateGuard())
                if not cam_guard.should_save(plate, confidence):
                    logger.debug(f"[{cam_id}] Duplicate suppressed: {plate}")
                    stats["duplicate_suppressed"] += 1
                    continue

                # Tally confirmation path
                if detection.get("_confirm_path") == "vote":
                    stats["vote_confirmed"] += 1
                else:
                    stats["bypass_confirmed"] += 1

                stats["plates_confirmed"]  += 1
                stats["last_detection_ts"]  = time.time()

                # Confidence histogram — bucket index = floor((conf - 0.5) / 0.1), capped at 4
                bucket = min(4, max(0, int((confidence - 0.5) / 0.1)))
                stats["conf_buckets"][bucket] += 1

                # For MIXED cameras, infer direction from crop-size trend.
                effective_role = cam_role
                if cam_role == "mixed":
                    inferred = _classify_approach(cam_id)
                    if inferred:
                        effective_role = inferred
                        logger.info(
                            f"[{cam_id}] Orientation classifier → {inferred} "
                            f"(plate: {plate})"
                        )

                logger.info(
                    f"[{cam_id}] Plate confirmed: {plate} ({confidence:.2f}) "
                    f"role={effective_role}"
                )

                ts       = datetime.now(timezone.utc)
                filename = f"{cam_id}_{ts.strftime('%Y%m%d_%H%M%S')}_{plate}.jpg"
                snap_path = DETECTION_DIR / filename
                try:
                    cv2.imwrite(str(snap_path), crop)
                except Exception as img_err:
                    logger.warning(f"Snapshot save failed: {img_err}")
                    filename = None

                event_type = handle_vehicle_session(
                    plate,
                    snapshot_path=filename,
                    camera_id=cam_id,
                    camera_role=effective_role,
                )

                save_detection(
                    plate_number=plate,
                    confidence=confidence,
                    image_path=filename,
                    camera_id=cam_id,
                    event_type=event_type,
                )

                broadcast_detection_event({
                    "type":         "detection",
                    "plate":        plate,
                    "plate_number": plate,
                    "confidence":   confidence,
                    "camera_id":    cam_id,
                    "event_type":   event_type,
                    "timestamp":    ts.isoformat(),
                    "image_path":   filename,
                })

                alert = _alert_service.check_blacklist(plate)
                is_blacklisted = bool(alert and alert.get("alert"))
                if is_blacklisted:
                    save_alert(
                        plate_number=plate,
                        message="BLACKLISTED VEHICLE DETECTED",
                        camera_id=cam_id,
                    )
                    broadcast_detection_event({
                        "type":         "alert",
                        "plate":        plate,
                        "plate_number": plate,
                        "message":      "BLACKLISTED VEHICLE DETECTED",
                        "camera_id":    cam_id,
                        "timestamp":    ts.isoformat(),
                    })

                # Anomaly engine hooks (tailgating, cloning, blacklist anomaly)
                try:
                    from backend.app.services.anomaly_engine import check_on_detection
                    check_on_detection(plate, cam_id, is_blacklisted=is_blacklisted)
                except Exception:
                    pass

        except Exception as exc:
            logger.error(f"ANPR loop error ({cam_id}): {exc}")
            time.sleep(0.1)

    logger.info(f"ANPR loop stopped for camera {cam_id}")


def _start_anpr_loop(cam_id: str) -> None:
    with _anpr_start_lock:
        if cam_id in _ANPR_THREADS and _ANPR_THREADS[cam_id].is_alive():
            logger.debug(
                f"[{cam_id}] ANPR loop already running — duplicate start prevented"
            )
            return
        _ANPR_ACTIVE[cam_id] = True
        t = threading.Thread(target=_anpr_loop, args=(cam_id,), daemon=True)
        _ANPR_THREADS[cam_id] = t
        t.start()
        logger.info(f"[{cam_id}] ANPR loop started")


def _stop_anpr_loop(cam_id: str) -> None:
    _ANPR_ACTIVE[cam_id] = False
    # Discard stale vote counts so a restarted camera begins with a clean slate.
    _vote_buffers.pop(cam_id, None)
    # Clear re-confirmation timestamps for this camera.
    _confirm_timestamps.pop(cam_id, None)
    # Reset stats for the next session.
    _cam_stats.pop(cam_id, None)
    # Reset adaptive blur threshold so next session starts from config default.
    _cam_blur_threshold.pop(cam_id, None)
    # Discard this camera's duplicate guard so the next session starts clean.
    _duplicate_guards.pop(cam_id, None)
    # Clear orientation tracker so direction inference starts fresh on restart.
    _approach_tracker.pop(cam_id, None)


@router.get("/cameras", dependencies=[Depends(get_current_user)])
def get_cameras():
    return {
        "available": list(manager.cameras.keys()),
        "active": list(manager.active_streams.keys()),
        "registered_sources": camera_registry.get_all(),
    }


@router.post("/camera/{cam_id}/source", dependencies=[Depends(get_current_user)])
def set_camera_source(cam_id: str, payload: dict = Body(...)):
    source = str(payload.get("source", "")).strip()
    if not source:
        raise HTTPException(status_code=400, detail="Invalid camera source")
    camera_registry.set_source(cam_id, source)
    return {"success": True, "cam_id": cam_id, "source": source}


@router.get("/camera/current", dependencies=[Depends(get_current_user)])
def get_current_source():
    return {"sources": camera_registry.get_all()}


@router.post("/camera/{cam_id}/start")
async def start_camera(cam_id: str, current_user: dict = Depends(get_current_user)):
    source = camera_registry.get_source(cam_id) or "0"
    manager.cameras[cam_id] = {"name": f"Camera {cam_id}", "source": source, "type": "dynamic"}
    manager.cameras[cam_id]["source"] = source
    ok = manager.start_stream(cam_id)
    if not ok:
        probe = _probe_source(source)
        error_msg = probe["hint"] if not probe["reachable"] else f"Could not open stream: {source}. {probe['hint']}"
        return {"success": False, "error": error_msg or f"Could not open stream: {source}"}
    await asyncio.sleep(0.5)
    _start_anpr_loop(cam_id)
    logger.info(f"Camera {cam_id} started — source: {source}")
    try:
        from backend.app.services.audit_service import log_action
        log_action(
            action="CAMERA_START",
            username=current_user.get("sub"),
            resource_type="camera",
            resource_id=cam_id,
            details={"source": source},
        )
    except Exception:
        pass
    return {"success": True, "cam_id": cam_id, "source": source}


@router.post("/camera/{cam_id}/stop")
def stop_camera(cam_id: str, current_user: dict = Depends(get_current_user)):
    _stop_anpr_loop(cam_id)
    ok = manager.stop_stream(cam_id)
    manager.frames.pop(cam_id, None)
    try:
        from backend.app.services.audit_service import log_action
        log_action(
            action="CAMERA_STOP",
            username=current_user.get("sub"),
            resource_type="camera",
            resource_id=cam_id,
        )
    except Exception:
        pass
    return {"success": True, "cam_id": cam_id, "stopped": ok}


@router.get("/camera/{cam_id}/stream", dependencies=[Depends(get_stream_user)])
def stream_camera(cam_id: str):
    if cam_id not in manager.active_streams:
        raise HTTPException(status_code=404, detail="Camera not started")

    def generate():
        while cam_id in manager.active_streams:
            frame = manager.frames.get(cam_id)
            if frame is None:
                time.sleep(0.03)
                continue
            ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if not ok:
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + buffer.tobytes()
                + b"\r\n"
            )
            time.sleep(1 / 25)

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")


@router.get("/camera/{cam_id}/test-once", dependencies=[Depends(get_current_user)])
def test_camera_once(cam_id: str):
    # Prefer the live frame already in the buffer
    frame = manager.frames.get(cam_id)
    if frame is None:
        # Camera not running — open a temporary capture
        source = camera_registry.get_source(cam_id)
        if not source:
            return {"success": False, "error": f"No source for {cam_id}"}
        cap = cv2.VideoCapture(int(source) if str(source).isdigit() else source)
        if not cap.isOpened():
            return {"success": False, "error": f"Cannot open {source}"}
        for _ in range(5):          # flush stale frames
            cap.read()
        ret, frame = cap.read()
        cap.release()
        if not ret or frame is None:
            return {"success": False, "error": "No frame read"}
    result = extract_best_result(frame)
    return {"success": True, "cam_id": cam_id, "plate": result if result else "NO PLATE DETECTED"}


@router.get("/camera/{cam_id}/diagnose", dependencies=[Depends(get_current_user)])
def diagnose_camera(cam_id: str):
    """
    Run the full ANPR pipeline on the live camera frame with verbose output.
    Returns every OCR candidate (including invalid ones) so you can see exactly
    what the model reads and where the pipeline fails.
    Also saves the current frame as a diagnostic image.
    """
    import numpy as np
    from backend.app.ai_engine.anpr.ocr_engine import (
        _find_plates_by_contours, _vehicle_plate_strips,
        _fast_ocr_crop, get_plate_ocr, correct_plate_text, is_valid_plate,
    )

    frame = manager.frames.get(cam_id)
    if frame is None:
        source = camera_registry.get_source(cam_id) or ""
        probe = _probe_source(source) if source else {"reachable": False, "hint": "No source URL configured for this camera."}
        return {
            "error": "Camera not running — no live frame available.",
            "source": source or "(none)",
            "network_reachable": probe["reachable"],
            "hint": probe["hint"] or "Set a source URL and press START.",
        }

    fh, fw = frame.shape[:2]
    ts = datetime.now(timezone.utc)
    diag_filename = f"diag_{cam_id}_{ts.strftime('%Y%m%d_%H%M%S')}.jpg"
    diag_path = DETECTION_DIR / diag_filename
    try:
        cv2.imwrite(str(diag_path), frame)
    except Exception:
        diag_filename = None

    def _ocr_verbose(crop, label):
        h, w = crop.shape[:2]
        info = {"label": label, "size": f"{w}x{h}", "raw_text": None, "confidence": None, "valid": False, "error": None}
        try:
            preds = get_plate_ocr().run(crop, return_confidence=True)
            if not preds:
                info["raw_text"] = "(empty)"
                return info
            pred = preds[0]
            text = pred.plate if hasattr(pred, "plate") else str(pred)
            cprobs = pred.char_probs if hasattr(pred, "char_probs") and pred.char_probs is not None else None
            score = float(np.mean(cprobs)) if cprobs is not None else 0.5
            cleaned = correct_plate_text(text)
            info["raw_text"] = text
            info["cleaned"] = cleaned
            info["confidence"] = round(score, 3)
            info["valid"] = is_valid_plate(cleaned)
        except Exception as e:
            info["error"] = str(e)
        return info

    contour_crops = _find_plates_by_contours(frame)
    yolo_strips   = _vehicle_plate_strips(frame)

    return {
        "frame_size": f"{fw}x{fh}",
        "frame_saved_as": diag_filename,
        "contour_candidates": len(contour_crops),
        "yolo_strips": len(yolo_strips),
        "contour_ocr": [_ocr_verbose(c, lbl) for c, lbl, _ in contour_crops[:8]],
        "yolo_ocr":    [_ocr_verbose(c, lbl) for c, lbl, _ in yolo_strips[:8]],
        "tip": (
            "If all sizes are < 80px wide → plate is too small in the frame, move camera closer. "
            "If raw_text is wrong → OCR confusion at this resolution. "
            "If valid=false → text doesn't match Indian plate pattern."
        ),
    }


@router.get("/metrics", dependencies=[Depends(get_current_user)])
def get_metrics():
    """Per-camera runtime statistics + observability metrics."""
    result = {}
    now = time.time()

    for cam_id, stats in _cam_stats.items():
        total    = stats["frames_total"]
        accepted = stats["frames_accepted"]
        lats     = stats["latencies_ms"]
        elapsed  = now - stats["start_time"]

        last_det = stats.get("last_detection_ts")
        last_frm = manager.last_frame_ts.get(cam_id)

        # Health score (0–100): weighted composite
        accept_rate = accepted / max(total, 1)
        ocr_fps_raw = stats["ocr_runs"] / max(elapsed, 1)
        avg_lat     = sum(lats) / len(lats) if lats else 500.0
        health = int(
            accept_rate       * 40 +
            min(ocr_fps_raw / 5.0, 1.0) * 30 +
            max(0.0, 1.0 - avg_lat / 1000.0) * 20 +
            min(elapsed / 3600, 1.0) * 10
        )

        result[cam_id] = {
            # Frame counters
            "frames_total":            total,
            "frames_accepted":         accepted,
            "frames_rejected":         stats["frames_rejected_quality"],
            "rejection_rate_pct":      round((1 - accept_rate) * 100, 1),
            # OCR throughput
            "ocr_runs":                stats["ocr_runs"],
            "ocr_fps":                 round(ocr_fps_raw, 2),
            "easyocr_runs":            _easyocr_run_count.get(cam_id, 0),
            # Detection outcomes
            "plates_detected":         stats["plates_detected"],
            "plates_confirmed":        stats["plates_confirmed"],
            "vote_confirmed":          stats.get("vote_confirmed", 0),
            "bypass_confirmed":        stats.get("bypass_confirmed", 0),
            "duplicate_suppressed":    stats.get("duplicate_suppressed", 0),
            # Latency
            "avg_latency_ms":          round(sum(lats) / len(lats), 1) if lats else None,
            "p95_latency_ms":          (
                round(sorted(lats)[int(len(lats) * 0.95)], 1)
                if len(lats) >= 20 else None
            ),
            # Timestamps
            "uptime_seconds":          round(elapsed),
            "last_detection_ts":       last_det,
            "last_frame_ts":           last_frm,
            "last_detection_ago_s":    round(now - last_det) if last_det else None,
            "last_frame_ago_s":        round(now - last_frm) if last_frm else None,
            # Reliability
            "reconnect_count":         manager.reconnect_counts.get(cam_id, 0),
            "reconnect_state":         manager.reconnect_state.get(cam_id),
            "blur_threshold":          _cam_blur_threshold.get(cam_id, FRAME_BLUR_THRESHOLD),
            # Config
            "camera_role":             camera_registry.get_role(cam_id),
            "current_source":          camera_registry.get_source(cam_id) or "",
            # Health score
            "health_score":            health,
            # Confidence histogram [0.5–0.6, 0.6–0.7, 0.7–0.8, 0.8–0.9, 0.9+]
            "conf_buckets":            list(stats.get("conf_buckets", [0, 0, 0, 0, 0])),
        }
    return result


@router.get("/camera/{cam_id}/role", dependencies=[Depends(get_current_user)])
def get_camera_role(cam_id: str):
    return {"cam_id": cam_id, "role": camera_registry.get_role(cam_id)}


@router.patch("/camera/{cam_id}/role", dependencies=[Depends(get_current_user)])
def set_camera_role(cam_id: str, payload: dict = Body(...)):
    role = str(payload.get("role", "mixed")).lower()
    try:
        camera_registry.set_role(cam_id, role)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"cam_id": cam_id, "role": role}


@router.get("/config/adjacent-cameras", dependencies=[Depends(get_current_user)])
def get_adjacent_cameras():
    """Return the current list of adjacent camera pairs (no cloning alerts between them)."""
    from backend.app.services.anomaly_engine import get_adjacent_pairs
    return {"pairs": get_adjacent_pairs()}


@router.post("/config/adjacent-cameras", dependencies=[Depends(get_current_user)])
def set_adjacent_cameras(payload: dict = Body(...)):
    """
    Set adjacent camera pairs.  Takes {pairs: [["1","2"], ["3","4"]]}.
    Persists to runtime.json and updates in-memory immediately.
    """
    from backend.app.services.anomaly_engine import set_adjacent_pairs
    pairs = payload.get("pairs", [])
    if not isinstance(pairs, list):
        raise HTTPException(status_code=400, detail="pairs must be a list")
    set_adjacent_pairs(pairs)
    return {"success": True, "pairs": pairs}


@router.get("/storage/stats", dependencies=[Depends(get_current_user)])
def get_storage_stats():
    """Detection snapshot directory statistics."""
    from backend.app.core.config import (
        DETECTION_DIR, DETECTION_MAX_AGE_DAYS, DETECTION_MAX_SIZE_MB
    )
    files = sorted(DETECTION_DIR.glob("*.jpg"), key=lambda f: f.stat().st_mtime)
    total_files = len(files)
    total_bytes = sum(f.stat().st_size for f in files if f.exists())
    oldest_ts   = files[0].stat().st_mtime  if files else None
    newest_ts   = files[-1].stat().st_mtime if files else None

    return {
        "total_files":       total_files,
        "total_size_mb":     round(total_bytes / 1024 / 1024, 2),
        "oldest_file_ts":    oldest_ts,
        "newest_file_ts":    newest_ts,
        "retention_days":    DETECTION_MAX_AGE_DAYS,
        "max_size_mb":       DETECTION_MAX_SIZE_MB,
        "used_pct":          round(total_bytes / max(DETECTION_MAX_SIZE_MB * 1024 * 1024, 1) * 100, 1),
    }
