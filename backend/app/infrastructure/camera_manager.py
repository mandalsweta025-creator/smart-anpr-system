import cv2
import json
import threading
import time
from pathlib import Path


class CameraManager:
    """
    Thread-safe camera manager.

    Key invariant: cap.release() is ALWAYS called from the same thread that
    calls cap.read() (_capture_loop).  Calling cap.release() from a different
    thread while cap.read() is blocking causes a segfault on macOS AVFoundation.
    We enforce this by:
      1. Passing a threading.Event (stop_event) directly to each capture thread.
      2. The thread's finally-block releases the cap after the loop exits.
      3. stop_stream() only sets the event and waits — it never touches the cap.
    """

    def __init__(self):
        base_dir = Path(__file__).resolve().parents[2]
        config_path = base_dir / "configs" / "camera.json"

        if not config_path.exists():
            raise FileNotFoundError(f"Missing config file: {config_path}")

        with open(config_path, "r") as f:
            data = json.load(f)

        if "cameras" in data:
            self.cameras = {str(cam["id"]): cam for cam in data["cameras"]}
        else:
            self.cameras = {str(k): v for k, v in data.items()}

        # active_streams: cam_id → True (just an existence marker; cap lives in the thread)
        self.active_streams:   dict[str, bool]             = {}
        self.stream_locks:     dict[str, threading.Lock]   = {}
        self.frames:           dict[str, any]              = {}
        self.capture_threads:  dict[str, threading.Thread] = {}
        self._stop_events:     dict[str, threading.Event]  = {}
        self.global_lock = threading.Lock()
        # Observability counters — read by GET /metrics
        self.reconnect_counts: dict[str, int]   = {}   # cumulative reconnects per cam
        self.last_frame_ts:    dict[str, float] = {}   # epoch time of last good frame
        # Reconnect state — set while camera is actively trying to reconnect
        self.reconnect_state:  dict[str, dict]  = {}   # {cam_id: {"attempt": N, "next_retry_ts": epoch}}

    # ──────────────────────────────────────────────────────────
    #  INTERNAL: capture loop (runs in its own daemon thread)
    # ──────────────────────────────────────────────────────────

    # Maximum reconnect attempts before giving up (stream marked dead).
    _MAX_RECONNECT_ATTEMPTS = 10
    # Consecutive failed reads before attempting a reconnect.
    _FAIL_THRESHOLD = 30
    # Base backoff in seconds; doubles on each attempt (1→2→4→8→16→32 capped at 60).
    _BACKOFF_BASE = 1.0
    _BACKOFF_CAP  = 60.0

    def _capture_loop(self, cam_id: str, cap: cv2.VideoCapture,
                      stop_event: threading.Event) -> None:
        """
        Read frames until stop_event is set, then release the cap.

        Auto-reconnect: after _FAIL_THRESHOLD consecutive read failures the loop
        releases the broken capture, waits with exponential backoff, and tries to
        re-open the source.  Up to _MAX_RECONNECT_ATTEMPTS are made; after that
        the loop exits so the camera is marked as stopped.
        """
        consecutive_fails  = 0
        reconnect_attempts = 0
        backoff            = self._BACKOFF_BASE

        try:
            while not stop_event.is_set():
                ret, frame = cap.read()
                if not ret or frame is None:
                    if stop_event.is_set():
                        break
                    consecutive_fails += 1

                    if consecutive_fails >= self._FAIL_THRESHOLD:
                        # Stream has dropped — attempt reconnect
                        reconnect_attempts += 1
                        if reconnect_attempts > self._MAX_RECONNECT_ATTEMPTS:
                            print(
                                f"Camera {cam_id}: exceeded {self._MAX_RECONNECT_ATTEMPTS} "
                                "reconnect attempts — giving up"
                            )
                            break

                        self.reconnect_counts[cam_id] = (
                            self.reconnect_counts.get(cam_id, 0) + 1
                        )
                        self.reconnect_state[cam_id] = {
                            "attempt": reconnect_attempts,
                            "max_attempts": self._MAX_RECONNECT_ATTEMPTS,
                            "next_retry_ts": time.time() + backoff,
                        }
                        print(
                            f"Camera {cam_id}: stream lost "
                            f"(attempt {reconnect_attempts}/{self._MAX_RECONNECT_ATTEMPTS}), "
                            f"reconnecting in {backoff:.0f}s…"
                        )

                        # Clear stale frame so the ANPR loop knows the stream is down
                        lock = self.stream_locks.get(cam_id)
                        if lock:
                            with lock:
                                self.frames.pop(cam_id, None)
                        else:
                            self.frames.pop(cam_id, None)

                        # Release the dead capture (must happen from this thread)
                        try:
                            cap.release()
                        except Exception:
                            pass

                        # Wait with exponential backoff before re-opening
                        deadline = time.time() + backoff
                        while time.time() < deadline and not stop_event.is_set():
                            time.sleep(0.25)
                        if stop_event.is_set():
                            return

                        backoff = min(backoff * 2.0, self._BACKOFF_CAP)

                        # Try to re-open
                        new_cap = self._get_capture(cam_id)
                        if new_cap is None:
                            print(f"Camera {cam_id}: re-open failed — will retry")
                            consecutive_fails = self._FAIL_THRESHOLD  # trigger another attempt
                            # Create a dummy cap so the finally block has something to release
                            cap = cv2.VideoCapture()
                            continue

                        cap = new_cap
                        consecutive_fails = 0
                        self.reconnect_state.pop(cam_id, None)
                        print(f"Camera {cam_id}: reconnected successfully")
                    else:
                        time.sleep(0.02)
                    continue

                # Good frame — reset failure counters
                consecutive_fails  = 0
                reconnect_attempts = 0
                backoff            = self._BACKOFF_BASE
                self.last_frame_ts[cam_id] = time.time()

                # Apply rotation if configured (0 / 90 / 180 / 270)
                rot = self.cameras.get(cam_id, {}).get("rotation", 0)
                if rot == 90:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
                elif rot == 180:
                    frame = cv2.rotate(frame, cv2.ROTATE_180)
                elif rot == 270:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)

                lock = self.stream_locks.get(cam_id)
                if lock:
                    with lock:
                        self.frames[cam_id] = frame
                else:
                    self.frames[cam_id] = frame

        except Exception as e:
            if not stop_event.is_set():
                print(f"Capture loop error ({cam_id}): {e}")
        finally:
            # Release from the thread that owns the cap — critical on macOS AVFoundation
            try:
                cap.release()
            except Exception:
                pass
            # Mark camera as no longer active so status checks reflect reality
            self.active_streams.pop(cam_id, None)
            print(f"Camera {cam_id}: capture loop exited")

    # ──────────────────────────────────────────────────────────
    #  INTERNAL: open a VideoCapture for the given cam_id
    # ──────────────────────────────────────────────────────────

    def _get_capture(self, cam_id: str) -> cv2.VideoCapture | None:
        cam = self.cameras.get(cam_id)
        if not cam:
            print(f"Camera not found: {cam_id}")
            return None

        source = cam.get("source") or cam.get("index") or cam.get("url") or 0
        if isinstance(source, str) and source.isdigit():
            source = int(source)

        print(f"Opening camera source: {source}")

        if isinstance(source, int):
            cap = cv2.VideoCapture(source, cv2.CAP_AVFOUNDATION)
            if not cap.isOpened():
                print("AVFoundation backend failed. Trying default backend…")
                cap.release()
                cap = cv2.VideoCapture(source)
        elif isinstance(source, str) and (source.startswith("http") or source.startswith("rtsp")):
            # FFMPEG handles MJPEG-over-HTTP and RTSP better than AVFoundation on macOS
            cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                print("FFMPEG backend failed. Trying default backend…")
                cap.release()
                cap = cv2.VideoCapture(source)
        else:
            cap = cv2.VideoCapture(source)

        if not cap.isOpened():
            print(f"Failed to open camera source: {source}")
            return None

        # Warm up (flush stale frames from buffer)
        for _ in range(5):
            cap.read()

        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_FPS, 30)
        print(f"Camera opened successfully: {source}")
        return cap

    # ──────────────────────────────────────────────────────────
    #  PUBLIC API
    # ──────────────────────────────────────────────────────────

    def list_cameras(self):
        return [
            {"id": cam_id, "name": cam.get("name", f"Camera {cam_id}"),
             "type": cam.get("type", "unknown")}
            for cam_id, cam in self.cameras.items()
        ]

    def start_stream(self, cam_id: str) -> bool:
        cam_id = str(cam_id)

        with self.global_lock:
            if cam_id in self.active_streams:
                # Already running — check thread is still alive
                t = self.capture_threads.get(cam_id)
                if t and t.is_alive():
                    return True
                # Thread died unexpectedly; clean up and restart
                self._stop_events.pop(cam_id, None)
                del self.active_streams[cam_id]

            cap = self._get_capture(cam_id)
            if cap is None:
                return False

            stop_event = threading.Event()
            self._stop_events[cam_id] = stop_event
            self.active_streams[cam_id] = True

            if cam_id not in self.stream_locks:
                self.stream_locks[cam_id] = threading.Lock()

            thread = threading.Thread(
                target=self._capture_loop,
                args=(cam_id, cap, stop_event),
                daemon=True,
            )
            self.capture_threads[cam_id] = thread
            thread.start()
            return True

    def stop_stream(self, cam_id: str) -> bool:
        cam_id = str(cam_id)

        with self.global_lock:
            if cam_id not in self.active_streams:
                return False
            del self.active_streams[cam_id]
            stop_event = self._stop_events.pop(cam_id, None)

        # Signal the capture thread — it will release cap in its finally block
        if stop_event:
            stop_event.set()

        # Wait up to 3 s for the thread to finish (non-blocking for callers
        # if the camera is slow to respond; daemon thread will die on exit anyway)
        thread = self.capture_threads.get(cam_id)
        if thread and thread.is_alive():
            thread.join(timeout=3.0)

        self.frames.pop(cam_id, None)
        return True

    def capture_frame(self, cam_id: str):
        """One-shot frame grab for the /capture endpoint."""
        cam_id = str(cam_id)

        frame = self.frames.get(cam_id)
        if frame is None:
            # Stream not running — open a temporary capture
            cap = self._get_capture(cam_id)
            if cap is None:
                return None
            ret, frame = cap.read()
            cap.release()
            if not ret or frame is None:
                print(f"Failed to read frame from camera: {cam_id}")
                return None

        captures_dir = Path("captures")
        captures_dir.mkdir(exist_ok=True)
        path = captures_dir / f"cam_{cam_id}.jpg"
        cv2.imwrite(str(path), frame)
        return {"path": str(path)}
