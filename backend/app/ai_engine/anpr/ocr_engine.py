import cv2
import re
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
import numpy as np

from backend.app.ai_engine.anpr.preprocess import generate_ocr_variants
from backend.app.core.config import (
    MIN_FAST_OCR_CONFIDENCE,
    MIN_EASYOCR_CONFIDENCE,
    MIN_EASYOCR_INTERVAL,
    FRAME_BLUR_THRESHOLD,
    FRAME_BRIGHTNESS_MIN,
    FRAME_BRIGHTNESS_MAX,
    MIN_CROP_WIDTH,
    MIN_CROP_HEIGHT,
)
from backend.app.utils.plate_validation import (
    correct_plate  as _correct_plate,
    is_valid        as _strict_valid,
    correct_and_validate,
    validate        as _validate,
)

# Per-camera timestamp of the last EasyOCR (Stage 3) run.
# Used to enforce MIN_EASYOCR_INTERVAL without blocking the fast stages.
_easyocr_last_run: dict[str, float] = {}

# Counts how many times EasyOCR Stage 3 was actually invoked per camera.
# Read by camera_routes.py when building GET /metrics.
easyocr_run_count: dict[str, int] = {}

# Single-worker pool keeps EasyOCR calls serialised (it is not re-entrant)
# while letting the ANPR thread enforce a hard timeout instead of blocking forever.
_easyocr_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="easyocr")
_EASYOCR_TIMEOUT  = 8.0   # seconds — kill the call if it hasn't returned by then

# Shared pool for parallel fast-plate-ocr crop inference.
# ONNX Runtime sessions are thread-safe for concurrent reads, so up to 4 crops
# per frame are processed simultaneously instead of sequentially.
# This is module-level so the pool is reused across frames and cameras.
_crop_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ocr-crop")

logger = logging.getLogger(__name__)

# ── Inference device (MPS on Apple Silicon, CUDA if available, else CPU) ──
# Detected once at import time so all YOLO calls use the same device.
def _detect_device() -> str:
    try:
        import torch
        if torch.backends.mps.is_available():
            logger.info("ANPR inference device: MPS (Apple Silicon GPU)")
            return "mps"
        if torch.cuda.is_available():
            logger.info("ANPR inference device: CUDA")
            return "cuda"
    except Exception:
        pass
    logger.info("ANPR inference device: CPU")
    return "cpu"

_INFERENCE_DEVICE = _detect_device()

# ── Singletons ────────────────────────────────────────────────

_easyocr_reader  = None
_yolo_model      = None   # vehicle detector (YOLOv8n COCO)
_plate_ocr       = None   # fast-plate-ocr character recogniser
_plate_detector  = None   # dedicated YOLO license-plate locator

PLATE_CHARS     = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
VEHICLE_CLASSES = {2, 3, 5, 7}   # COCO: car, motorcycle, bus, truck

_YOLO_WEIGHTS         = Path(__file__).resolve().parents[3] / "models" / "weights" / "yolov8n.pt"
# Dedicated license-plate detector.  Downloaded automatically from HuggingFace
# on first use if not already present at this path.
_PLATE_DETECTOR_LOCAL = Path(__file__).resolve().parents[3] / "models" / "weights" / "yolov8n_plate.pt"

# Candidate HuggingFace repos tried in order until one downloads successfully.
_PLATE_DETECTOR_HF_CANDIDATES: list[tuple[str, str]] = [
    ("Koushim/yolov8-license-plate-detection",        "best.pt"),
    ("yasirfaizahmed/license-plate-object-detection",  "best.pt"),
    ("morsetechlab/yolov11-license-plate-detection",   "license-plate-finetune-v1n.pt"),
]

# Set to False permanently once a download attempt fails, so subsequent frames
# skip the slow HF download retry and fall through to contour detection.
_plate_detector_available: bool | None = None   # None = not yet attempted


def get_easyocr():
    global _easyocr_reader
    if _easyocr_reader is None:
        logger.info("Loading EasyOCR...")
        import easyocr
        _easyocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        logger.info("EasyOCR ready")
    return _easyocr_reader


def warmup_easyocr() -> None:
    """
    Pre-load EasyOCR and run one blank inference in a background thread.

    EasyOCR's first call takes 50–62 s on CPU (CRAFT model load + JIT warm-up).
    Calling this at startup ensures that first-call latency is paid during boot,
    not during the first real detection event where it would freeze the ANPR loop.
    """
    def _warmup():
        try:
            logger.info("EasyOCR warm-up starting (background)…")
            blank = np.zeros((64, 256, 3), dtype=np.uint8)
            get_easyocr().readtext(blank, detail=0)
            logger.info("EasyOCR warm-up complete")
        except Exception as exc:
            logger.warning(f"EasyOCR warm-up failed (non-fatal): {exc}")

    t = threading.Thread(target=_warmup, daemon=True, name="easyocr-warmup")
    t.start()


def get_yolo():
    global _yolo_model
    if _yolo_model is None:
        logger.info("Loading YOLO vehicle detector...")
        from ultralytics import YOLO
        _yolo_model = YOLO(str(_YOLO_WEIGHTS))
        _yolo_model.to(_INFERENCE_DEVICE)
        logger.info(f"YOLO ready (device={_INFERENCE_DEVICE})")
    return _yolo_model


def warmup_fast_ocr() -> None:
    """
    Pre-load fast-plate-ocr and run one blank inference in a background thread.

    Without this, the model cold-loads during the first live frame, adding
    8–10 seconds to S2 latency (visible in logs as '24 s contour stage').
    Called at startup alongside warmup_easyocr() so the penalty is paid
    during boot, not during the first real detection event.
    """
    def _warmup():
        try:
            logger.info("fast-plate-ocr warm-up starting (background)…")
            blank = np.zeros((64, 256, 3), dtype=np.uint8)
            get_plate_ocr().run(blank, return_confidence=True)
            logger.info("fast-plate-ocr warm-up complete")
        except Exception as exc:
            logger.warning(f"fast-plate-ocr warm-up failed (non-fatal): {exc}")

    t = threading.Thread(target=_warmup, daemon=True, name="fast-ocr-warmup")
    t.start()


def get_plate_ocr():
    """fast-plate-ocr: cct-s-v2-global-model (128×64 input, 10-slot)."""
    global _plate_ocr
    if _plate_ocr is None:
        logger.info("Loading fast-plate-ocr cct-s-v2 model...")
        from fast_plate_ocr import LicensePlateRecognizer
        _plate_ocr = LicensePlateRecognizer("cct-s-v2-global-model")
        logger.info("fast-plate-ocr ready")
    return _plate_ocr


def get_plate_detector():
    """
    Load the dedicated YOLO license-plate detector (lazy singleton).

    Load order:
      1. Local weights at models/weights/yolov8n_plate.pt
      2. Auto-download from HuggingFace Hub (keremberke/yolov8n-license-plate-detection)
      3. If both fail, returns None — caller falls back to contour detection.
    """
    global _plate_detector, _plate_detector_available
    if _plate_detector is not None:
        return _plate_detector
    if _plate_detector_available is False:
        return None   # previous attempt failed; don't retry every frame

    try:
        from ultralytics import YOLO

        if _PLATE_DETECTOR_LOCAL.exists():
            logger.info("Loading YOLO plate detector (local weights)…")
            _plate_detector = YOLO(str(_PLATE_DETECTOR_LOCAL))
            _plate_detector.to(_INFERENCE_DEVICE)
            _plate_detector_available = True
            logger.info(f"YOLO plate detector ready (local, device={_INFERENCE_DEVICE})")
            return _plate_detector

        # Auto-download from HuggingFace Hub — try candidates in order
        from huggingface_hub import hf_hub_download
        import shutil
        _PLATE_DETECTOR_LOCAL.parent.mkdir(parents=True, exist_ok=True)
        downloaded = None
        for repo_id, filename in _PLATE_DETECTOR_HF_CANDIDATES:
            try:
                logger.info(f"Trying HuggingFace repo: {repo_id} …")
                downloaded = hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    local_dir=str(_PLATE_DETECTOR_LOCAL.parent),
                )
                logger.info(f"Downloaded from {repo_id}")
                break
            except Exception as dl_exc:
                logger.debug(f"  {repo_id}: {dl_exc}")
        if downloaded is None:
            raise RuntimeError(
                "All HuggingFace candidates failed. "
                f"Place a YOLOv8 plate detection model at {_PLATE_DETECTOR_LOCAL} "
                "or run scripts/download_plate_model.py for instructions."
            )
        if Path(downloaded) != _PLATE_DETECTOR_LOCAL:
            shutil.copy2(downloaded, str(_PLATE_DETECTOR_LOCAL))

        _plate_detector = YOLO(str(_PLATE_DETECTOR_LOCAL))
        _plate_detector_available = True
        logger.info("YOLO plate detector ready (downloaded from HuggingFace)")
        return _plate_detector

    except Exception as exc:
        logger.warning(
            f"YOLO plate detector unavailable ({exc}). "
            "Falling back to contour detection."
        )
        _plate_detector_available = False
        return None


# ── Text cleaning & correction ────────────────────────────────

def clean_text(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


LETTER_LIKE_DIGITS = {"0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B"}
DIGIT_LIKE_LETTERS = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1",
                      "Z": "2", "S": "5", "B": "8", "G": "6"}

# Broader substitution table used by fuzzy search (OCR confusion matrix)
_ALL_SUBS = {**LETTER_LIKE_DIGITS, **DIGIT_LIKE_LETTERS,
             "4": "A", "6": "G", "3": "E"}   # additional common digit→letter confusions

INDIAN_PLATE_RE = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$")


def correct_plate_text(text: str) -> str:
    """Position-aware correction for Indian licence plates.

    Indian plate structure:  [2 state letters][2 district digits][1-3 series letters][3-4 number digits]

    1. Positions 0-1 must be letters → replace digit-like chars with their letter equivalents.
    2. Positions 2-3 must be digits  → replace letter-like chars with digit equivalents.
    3. The trailing 3-4 chars must be digits → replace any letter-like chars there.
    """
    if not text:
        return ""
    text = clean_text(text)
    if len(text) < 6 or len(text) > 12:
        return text

    chars = list(text)

    # Fix positions 0-1 (state code — must be letters)
    for i in (0, 1):
        if i < len(chars) and chars[i] in LETTER_LIKE_DIGITS:
            chars[i] = LETTER_LIKE_DIGITS[chars[i]]

    # Fix positions 2-3 (district — must be digits)
    for i in (2, 3):
        if i < len(chars) and chars[i] in DIGIT_LIKE_LETTERS:
            chars[i] = DIGIT_LIKE_LETTERS[chars[i]]

    # Fix the trailing number segment (last 3 or 4 chars must be digits)
    for num_len in (4, 3):
        if len(chars) >= 6 + num_len - 4:   # sensible total length
            suffix = chars[-num_len:]
            fixed = [DIGIT_LIKE_LETTERS.get(c, c) for c in suffix]
            if all(c.isdigit() for c in fixed):
                chars[-num_len:] = fixed
                break

    return "".join(chars)


def _parse_plate_structure(text: str) -> str | None:
    """
    Try to recover a valid Indian plate by parsing the string according to
    the plate's known structure: [2 state letters][1-2 district digits][1-3 series letters][3-4 number digits].

    At each positional section we replace characters using the appropriate
    confusion map (digit-like→letter for letter sections, letter-like→digit
    for digit sections).  This handles the common phone-screen misread where
    OCR reads 'MA' as '14' or '40' etc.
    """
    if not text or not (6 <= len(text) <= 12):
        return None
    t = clean_text(text)

    # State must be 2 letters
    state = ""
    for ch in t[:2]:
        state += LETTER_LIKE_DIGITS.get(ch, ch)
    if not state.isalpha() or len(state) != 2:
        return None
    rest = t[2:]

    # District: 1-2 digits
    for dist_len in (2, 1):
        dist_raw = rest[:dist_len]
        dist = "".join(DIGIT_LIKE_LETTERS.get(c, c) for c in dist_raw)
        if not dist.isdigit():
            continue
        after_dist = rest[dist_len:]

        # Series: 1-3 letters (use broader map: 4→A, 3→E, 0→O, 1→I, etc.)
        for ser_len in (3, 2, 1):
            ser_raw = after_dist[:ser_len]
            ser = "".join(_ALL_SUBS.get(c, c) for c in ser_raw)
            if not ser.isalpha():
                continue
            after_ser = after_dist[ser_len:]

            # Number: 3-4 digits (must consume all remaining chars)
            for num_len in (4, 3):
                if len(after_ser) != num_len:
                    continue
                num = "".join(DIGIT_LIKE_LETTERS.get(c, c) for c in after_ser)
                if not num.isdigit():
                    continue
                candidate = state + dist + ser + num
                if INDIAN_PLATE_RE.match(candidate):
                    return candidate

    return None


def fuzzy_correct_plate(text: str) -> str:
    """Delegate to plate_validation.correct_plate (structural + single-char strategies)."""
    if not text:
        return text
    return _correct_plate(text)


def is_valid_plate(text: str) -> bool:
    """Strict check: structural format + state code whitelist + semantic rules."""
    if not text:
        return False
    if len(set(text)) <= 2:
        return False
    return _strict_valid(text)


# ── Frame quality gate ───────────────────────────────────────

def _is_frame_usable_threshold(frame, blur_threshold: float) -> bool:
    """
    Frame quality check with an explicit blur_threshold argument.

    Used by the ANPR loop with a per-camera adaptive threshold so it can be
    auto-lowered when compressed streams cause excessive rejection.
    Brightness bounds are still taken from the global config constants.
    """
    if frame is None or frame.size == 0:
        return False
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    if FRAME_BRIGHTNESS_MIN > 0 or FRAME_BRIGHTNESS_MAX < 255:
        mean_b = float(np.mean(gray))
        if mean_b < FRAME_BRIGHTNESS_MIN or mean_b > FRAME_BRIGHTNESS_MAX:
            return False

    if blur_threshold > 0:
        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if lap_var < blur_threshold:
            return False

    return True


def _is_frame_usable(frame) -> bool:
    """Convenience wrapper using the global FRAME_BLUR_THRESHOLD config constant."""
    return _is_frame_usable_threshold(frame, FRAME_BLUR_THRESHOLD)


# ── Preprocessing helpers ─────────────────────────────────────

def _clahe_enhance(frame):
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def _gamma_brighten(frame, gamma=1.8):
    table = np.array(
        [(i / 255.0) ** (1.0 / gamma) * 255 for i in range(256)], dtype=np.uint8
    )
    return cv2.LUT(frame, table)


def _sharpen(frame):
    blur = cv2.GaussianBlur(frame, (0, 0), 3)
    return cv2.addWeighted(frame, 1.5, blur, -0.5, 0)


def _dehaze(frame):
    return _clahe_enhance(cv2.normalize(frame, None, 0, 255, cv2.NORM_MINMAX))


def _adaptive_thresh(frame):
    """Adaptive threshold — good for printed plates with uneven lighting."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                               cv2.THRESH_BINARY, 21, 10)
    return cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)


def _remove_moire(frame):
    """Median blur removes moiré patterns from phone/monitor screens."""
    return cv2.medianBlur(frame, 3)




# ── Plate crop preprocessing ─────────────────────────────────

def _prep_crop(crop, target_width=1600):
    """Upscale to target_width + bilateral filter + CLAHE for EasyOCR.
    Always scales up to at least target_width so even tiny crops are readable."""
    h, w = crop.shape[:2]
    if h == 0 or w == 0:
        return crop
    scale = max(4.0, target_width / max(w, 1))
    new_w, new_h = int(w * scale), int(h * scale)
    up = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 11, 17, 17)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


# ── Contour candidate scoring ────────────────────────────────

def _contour_plate_score(area: float, rect_area: float, ar: float,
                          hull_area: float, edge_density: float) -> float:
    """
    Composite score in [0, 1] that ranks how plate-like a contour is.

    Four components, empirically weighted for Indian plates:

    ar_score   (40 %) — how close the aspect ratio is to 4.7:1 (Indian standard).
                         Tilted or two-row plates with AR 2.0–3.0 are penalised
                         mildly.  AR outside 2–7 is already filtered before this.

    rect_score (30 %) — hull_area / bounding_rect_area; a clean rectangular plate
                         scores near 1.0, an irregular blob scores near 0.

    edge_score (20 %) — edge density; a plate with visible characters has ~15-30 %
                         edge pixels.  Too low (smooth surface) or too high (grille,
                         foliage) both score poorly.

    size_score (10 %) — prefers medium-sized regions (3 000–10 000 px²) that are
                         legible but not so large they fill the entire frame.
    """
    ar_ideal   = 4.7
    ar_score   = max(0.0, 1.0 - abs(ar - ar_ideal) / ar_ideal)

    rect_score = min(1.0, hull_area / max(rect_area, 1.0))

    edge_ideal = 0.22
    edge_score = max(0.0, 1.0 - abs(edge_density - edge_ideal) / edge_ideal)

    if area <= 8000:
        size_score = min(1.0, area / 3000.0)
    else:
        size_score = max(0.0, 1.0 - (area - 8000) / 120_000.0)

    return (ar_score * 0.40 + rect_score * 0.30 +
            edge_score * 0.20 + size_score * 0.10)


# ── Contour-based plate locator (no ML required) ──────────────

def _find_plates_by_contours(frame):
    """
    Classical CV: find rectangles whose aspect ratio matches a license plate.

    Key improvements over the previous version:
    • Uses cv2.minAreaRect for aspect-ratio measurement so tilted plates are
      measured along their actual long axis, not the larger axis-aligned bbox.
    • Collects ALL passing candidates, scores each with _contour_plate_score(),
      and returns the top-4 by score — not the first-4 by area.  This stops
      large-area non-plate blobs (car hoods, signs) from evicting real plates
      from the 4-crop budget.
    • The per-frame debug frame-write that was in the hot path (writing every
      matching frame to /tmp) has been removed to eliminate production disk spam.
    """
    candidates: list[tuple[float, any, str, tuple]] = []   # (score, crop, label, bbox)
    try:
        fh, fw = frame.shape[:2]
        frame_area = fh * fw
        gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur  = cv2.bilateralFilter(gray, 11, 17, 17)
        edges = cv2.Canny(blur, 30, 200)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 1))
        edges  = cv2.dilate(edges, kernel, iterations=1)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:40]

        seen: set = set()
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 600 or area > frame_area * 0.25:
                continue

            # ── Rotation-aware aspect ratio via minAreaRect ───────────────
            # cv2.boundingRect() measures the axis-aligned box; a plate at a
            # 15° tilt appears ~15% wider and shorter than it really is, so AR
            # can drop from 4.7 to ~3.8 and fail the lower bound.
            # minAreaRect() measures the true plate dimensions regardless of tilt.
            _, (rw_r, rh_r), _ = cv2.minAreaRect(cnt)
            if rw_r < rh_r:
                rw_r, rh_r = rh_r, rw_r   # normalise: long side first

            if rw_r < 60 or rh_r < 14:
                continue

            ar        = rw_r / max(rh_r, 1)
            rect_area = rw_r * rh_r

            is_horizontal = (2.0 <= ar <= 7.0)
            is_vertical   = (0.14 <= ar <= 0.50)   # 90°-mounted camera
            if not (is_horizontal or is_vertical):
                continue

            hull_area = cv2.contourArea(cv2.convexHull(cnt))
            if hull_area < 1:
                continue
            rectangularity = hull_area / rect_area
            if rectangularity < 0.45:
                continue

            # Edge density measured inside the axis-aligned bbox (cheap & stable)
            x, y, bw_, bh_ = cv2.boundingRect(cnt)
            roi_edges    = edges[y : y + bh_, x : x + bw_]
            edge_density = float(np.count_nonzero(roi_edges)) / max(bw_ * bh_, 1)
            if not (0.04 <= edge_density <= 0.70):
                continue

            key = (x // 40, y // 40)
            if key in seen:
                continue
            seen.add(key)

            pad_x = max(10, int(bw_ * 0.15))
            pad_y = max(5,  int(bh_ * 0.25))
            cx1 = max(0, x - pad_x)
            cy1 = max(0, y - pad_y)
            cx2 = min(fw, x + bw_ + pad_x)
            cy2 = min(fh, y + bh_ + pad_y)
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue
            if is_vertical:
                crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)

            score = _contour_plate_score(area, rect_area, ar, hull_area, edge_density)
            ch, cw = crop.shape[:2]
            logger.debug(
                f"Contour cand: {cw}×{ch} ar={ar:.1f} score={score:.2f} "
                f"area={area:.0f} density={edge_density:.2f} rect={rectangularity:.2f}"
            )
            candidates.append((score, crop, "contour", (cx1, cy1, cx2, cy2)))

        # Sort by composite score; take top 4.  Previously sorted by area desc and
        # returned on first-4, which meant large-but-wrong regions beat small plates.
        candidates.sort(key=lambda c: c[0], reverse=True)
        crops = [(c[1], c[2], c[3]) for c in candidates[:4]]
        logger.debug(
            f"Contour: {len(crops)} plates returned "
            f"(from {len(candidates)} scored candidates)"
        )
    except Exception as e:
        logger.warning(f"Contour detection failed: {e}")
        crops = []
    return crops


# ── Dedicated YOLO plate locator ─────────────────────────────

def _find_plates_by_yolo_detector(frame):
    """
    Use the dedicated YOLO license-plate detector to find tight plate regions.

    This replaces contour detection as Stage 1 when the model is available:
    the YOLO model is trained to find the plate rectangle directly, giving a
    much tighter and more reliable crop than edge-based contour heuristics.

    Returns list of (crop, label, bbox) — same contract as _find_plates_by_contours.
    Returns [] when the model is not available (triggers contour fallback).
    """
    model = get_plate_detector()
    if model is None:
        return []

    crops = []
    try:
        fh, fw = frame.shape[:2]
        results = model(frame, verbose=False, conf=0.25)[0]

        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            det_conf = float(box.conf[0])
            pw = max(8, int((x2 - x1) * 0.10))
            ph = max(4, int((y2 - y1) * 0.15))
            cx1 = max(0, x1 - pw)
            cy1 = max(0, y1 - ph)
            cx2 = min(fw, x2 + pw)
            cy2 = min(fh, y2 + ph)
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0 or crop.shape[0] < 8 or crop.shape[1] < 20:
                continue
            ch, cw = crop.shape[:2]
            logger.debug(
                f"YOLO-plate: {cw}×{ch} det_conf={det_conf:.2f} at ({cx1},{cy1})"
            )
            crops.append((crop, f"yolo-plate/{det_conf:.2f}", (cx1, cy1, cx2, cy2)))

        logger.debug(f"YOLO plate detector: {len(crops)} plate region(s)")
    except Exception as exc:
        logger.warning(f"YOLO plate detector inference failed: {exc}")

    return crops


# ── Vehicle detection → candidate plate strips ───────────────

def _vehicle_plate_strips(frame):
    """
    Detect vehicles with YOLO. For each vehicle return several overlapping
    horizontal strips (top / mid / bottom / full), each upscaled 4×.
    Trying multiple strips compensates for the lack of a dedicated plate
    locator: the plate is somewhere in the strip and fast-plate-ocr will
    find it.

    Returns list of (strip_img, label_str, origin_bbox_in_frame).
    origin_bbox is (x1, y1, x2, y2) in original frame coords for snapshot.
    """
    strips = []
    try:
        fh, fw = frame.shape[:2]
        results = get_yolo()(
            frame, verbose=False, conf=0.30,
            classes=list(VEHICLE_CLASSES),
        )[0]

        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            vh = y2 - y1
            vw = x2 - x1
            pad_x = int(vw * 0.03)

            bx1 = max(0, x1 - pad_x)
            bx2 = min(fw, x2 + pad_x)

            # Four candidate strips covering different vertical zones
            zones = [
                ("bottom-35",  max(0, y2 - int(vh * 0.38)), min(fh, y2 + int(vh * 0.04))),
                ("bottom-55",  max(0, y2 - int(vh * 0.58)), y2),
                ("mid-bottom", max(0, y1 + int(vh * 0.35)), min(fh, y1 + int(vh * 0.70))),
                ("full",       y1, y2),
            ]
            for zone_name, sy1, sy2 in zones:
                crop = frame[sy1:sy2, bx1:bx2]
                if crop.size == 0 or crop.shape[0] < 8 or crop.shape[1] < 20:
                    continue
                strips.append((crop, f"yolo/{zone_name}", (bx1, sy1, bx2, sy2)))

        logger.debug(f"YOLO: {len(results.boxes)} vehicles → {len(strips)} strips")
    except Exception as e:
        logger.warning(f"YOLO failed, using full-frame fallback: {e}")

    return strips


# ── Vehicle crop extractor (Stage 1 input) ───────────────────

def _detect_vehicles(frame):
    """
    Run YOLOv8n COCO vehicle detection and return padded vehicle crops.

    These crops are the input to Stage 1: the plate locator runs on each crop
    rather than the full frame.  Benefits:
    • Search space shrinks 10–40× → fewer contour false positives from
      background clutter (signs, walls, dashboards).
    • The vehicle detection provides a hard gate: a plate that isn't attached
      to a detected vehicle won't generate a detection event.

    Returns list of (vehicle_crop, global_bbox) where
    global_bbox = (x1, y1, x2, y2) in the original frame coordinate system.
    """
    vehicles: list[tuple] = []
    try:
        fh, fw = frame.shape[:2]
        results = get_yolo()(
            frame, verbose=False, conf=0.35,
            classes=list(VEHICLE_CLASSES),
        )[0]

        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            vw, vh = x2 - x1, y2 - y1
            if vw < 40 or vh < 30:
                continue  # too small to contain a readable plate
            # Tiny padding so the plate area near the vehicle boundary isn't clipped
            px = max(4, int(vw * 0.02))
            py = max(4, int(vh * 0.02))
            bx1 = max(0, x1 - px);  by1 = max(0, y1 - py)
            bx2 = min(fw, x2 + px); by2 = min(fh, y2 + py)
            crop = frame[by1:by2, bx1:bx2]
            if crop.size == 0:
                continue
            vehicles.append((crop, (bx1, by1, bx2, by2)))

        logger.debug(f"Vehicle detector: {len(vehicles)} vehicle(s)")
    except Exception as exc:
        logger.warning(f"Vehicle detection failed: {exc}")
    return vehicles


# ── fast-plate-ocr read on a single crop ─────────────────────

def _fast_ocr_crop(crop, label):
    """Run fast-plate-ocr on a crop. For small crops, also tries 2× upscale.
    Returns (text, score) or None."""
    def _run_once(img, tag):
        try:
            h, w = img.shape[:2]
            if w < MIN_CROP_WIDTH or h < MIN_CROP_HEIGHT:
                return None
            preds = get_plate_ocr().run(img, return_confidence=True)
            if not preds:
                return None
            pred = preds[0]
            text = clean_text(pred.plate if hasattr(pred, "plate") else str(pred))
            if not text:
                return None
            cprobs = pred.char_probs if hasattr(pred, "char_probs") and pred.char_probs is not None else None
            if cprobs is not None and len(cprobs) > 0:
                # The model outputs a fixed-width slot array (e.g. 10 slots for
                # cct-s-v2).  Blank/padding slots have high probability for the
                # CTC blank token, which inflates np.mean() for short plates
                # (e.g. a 7-char plate in a 10-slot model scores blanks at ~0.95,
                # masking low-confidence character reads).
                # Fix: average only the top-k probs where k = len(text).
                n     = max(1, len(text))
                score = float(np.mean(sorted(cprobs, reverse=True)[:n]))
            else:
                # No per-character probabilities — treat as low-confidence unknown
                score = 0.40
            logger.debug(f"[fast-ocr/{label}/{tag}] '{text}' conf={score:.2f}")
            return (text, score)
        except Exception as e:
            logger.warning(f"fast-plate-ocr error on {label}/{tag}: {e}")
            return None

    h, w = crop.shape[:2]
    result = _run_once(crop, "raw")

    # Run the 2× upscale only when the raw result is missing or low-confidence.
    # For crops that already score ≥ 0.72 the upscale almost never improves things
    # and costs an extra ~30 ms per crop.  Below 0.72 the enlarged crop often reads
    # characters that were illegible at native size.
    if w < 200 and (result is None or result[1] < 0.72):
        up = cv2.resize(crop, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
        ru = _run_once(up, "2x")
        if ru and (result is None or ru[1] > result[1]):
            result = ru

    return result


# ── Merge adjacent EasyOCR fragments into a plate string ─────

def _merge_plate_fragments(raw):
    """
    EasyOCR often reads 'HR', '26', 'BR', '9044' as separate boxes because of
    spaces on the physical plate.  This groups boxes on the same horizontal
    band, sorts by x-position, and tries concatenating 2-6 consecutive reads
    to see if the result is a valid Indian plate.

    Returns (cleaned_text, avg_confidence) or None.
    """
    if not raw or len(raw) < 2:
        return None

    # Group by y-centre (30 px bands)
    from collections import defaultdict
    bands: dict = defaultdict(list)
    for bbox, text, score in raw:
        pts = np.array(bbox, dtype=np.float32)
        cy = float(pts[:, 1].mean())
        bands[int(cy / 30)].append((pts, clean_text(text), score))

    best_text, best_score = None, 0.0

    for items in bands.values():
        if len(items) < 2:
            continue
        items.sort(key=lambda x: float(x[0][:, 0].mean()))  # left→right

        for start in range(len(items)):
            for width in range(2, min(7, len(items) - start + 1)):
                group = items[start : start + width]

                # Reject if any two consecutive boxes are too far apart (> 4× char height)
                ok = True
                for i in range(len(group) - 1):
                    x_right = float(group[i][0][:, 0].max())
                    x_left  = float(group[i + 1][0][:, 0].min())
                    char_h  = max(1.0, float(group[i][0][:, 1].max() - group[i][0][:, 1].min()))
                    if (x_left - x_right) > char_h * 4:
                        ok = False
                        break
                if not ok:
                    continue

                raw_combined = "".join(t for _, t, _ in group)
                # Plate must start with 2 letters (state code) — skip mid-plate merges
                if len(raw_combined) < 2 or not raw_combined[:2].isalpha():
                    continue
                # Try as-is, then position correction, then full fuzzy correction
                combined = raw_combined if is_valid_plate(raw_combined) else fuzzy_correct_plate(raw_combined)
                if 7 <= len(combined) <= 12 and is_valid_plate(combined):
                    avg_score = sum(s for _, _, s in group) / len(group)
                    if avg_score > best_score:
                        best_text, best_score = combined, avg_score

    return (best_text, best_score) if best_text else None




# ── Plate-vehicle association helper ─────────────────────────

def _plate_in_vehicle(plate_box: tuple, vehicle_boxes: list[tuple]) -> bool:
    """Return True if the plate bbox centre falls inside any detected vehicle bbox.

    Using centre-point containment rather than IoU because plates are small
    relative to vehicles — a plate bbox will always be fully inside the vehicle
    bbox when the vehicle was actually detected.  The looser containment test
    also handles plates that are just at the vehicle bbox edge.
    """
    if not vehicle_boxes:
        return True   # no vehicle constraint → accept all plates
    px1, py1, px2, py2 = plate_box
    pcx = (px1 + px2) / 2
    pcy = (py1 + py2) / 2
    return any(
        vx1 <= pcx <= vx2 and vy1 <= pcy <= vy2
        for vx1, vy1, vx2, vy2 in vehicle_boxes
    )


# ── Primary detection entry point ─────────────────────────────

def detect_plates_in_frame(frame, *, cam_id: str = "default") -> list[dict]:
    """
    Two-YOLO vehicle-first ANPR pipeline.

    Stage 1 — 2 YOLO calls on the full frame (~400 ms total on CPU)
        • vehicle_YOLO(full_frame): locate every car/bike/bus/truck.
        • plate_YOLO(full_frame):   locate every license-plate region.
        Both run exactly once — eliminating the old N-per-vehicle pattern
        that caused 8–26 s Stage 1 latency with 3+ vehicles in frame.
        Plate crops whose centre falls inside a vehicle bbox are kept;
        unassociated plates are accepted only when no vehicles were found
        (handles partially-visible / edge vehicles the vehicle model misses).
        fast-plate-OCR runs on each filtered plate crop.

    Stage 2 — contour fallback when plate YOLO finds nothing (~50–150 ms)
        Runs on vehicle crops (or the full frame if no vehicles detected).
        fast-plate-OCR on each contour candidate.

    Stage 3 — EasyOCR last resort (2–10 s on CPU, rate-limited)
        CRITICAL GATE: only fires when at least one vehicle OR plate-shaped
        region was detected.  A completely empty frame (no cars, no
        plate-like contours) will NEVER trigger EasyOCR.

    Returns list of {"text", "confidence", "crop"} sorted by confidence desc.
    """
    if frame is None or frame.size == 0:
        return []

    try:
        best: dict[str, dict] = {}
        fh, fw = frame.shape[:2]
        found_any_region = False   # True once a vehicle OR plate region is seen
        t0 = time.perf_counter()

        # ── Stage 1: exactly 2 YOLO calls ─────────────────────────
        vehicles      = _detect_vehicles(frame)
        vehicle_boxes = [bbox for _, bbox in vehicles]
        if vehicles:
            found_any_region = True

        plate_crops = _find_plates_by_yolo_detector(frame)
        if plate_crops:
            found_any_region = True

        # When vehicles are present, filter plate crops to those whose
        # centre falls inside a vehicle bbox.  This suppresses false
        # positives from road signs, shop boards, and number-like text
        # on the background.  If filtering wipes everything (edge vehicle
        # partially outside the frame), fall back to the unfiltered list
        # so the plate is not silently dropped.
        if vehicle_boxes and plate_crops:
            filtered = [
                (crop, lbl, bbox)
                for crop, lbl, bbox in plate_crops
                if _plate_in_vehicle(bbox, vehicle_boxes)
            ]
            if filtered:
                plate_crops = filtered
            # else: no plate overlaps any vehicle — keep all (partial vehicle)

        # Submit all S1 plate crops to the shared pool — run in parallel.
        # ONNX Runtime (fast-plate-ocr backend) is thread-safe for concurrent reads.
        if plate_crops:
            s1_futures = {
                _crop_executor.submit(_fast_ocr_crop, raw_crop, p_label):
                    (lx1, ly1, lx2, ly2)
                for raw_crop, p_label, (lx1, ly1, lx2, ly2) in plate_crops
            }
            for future, (lx1, ly1, lx2, ly2) in s1_futures.items():
                try:
                    result = future.result(timeout=15.0)
                except Exception:
                    continue
                if not result:
                    continue
                text_raw, score = result
                cleaned = fuzzy_correct_plate(text_raw)
                vresult = _validate(cleaned)
                if vresult.valid and score >= MIN_FAST_OCR_CONFIDENCE:
                    snap = frame[ly1:ly2, lx1:lx2]
                    entry = {
                        "text":       cleaned,
                        "confidence": round(score, 3),
                        "crop":       snap if snap.size > 0 else frame,
                        "variant":    "yolo-plate",
                    }
                    if cleaned not in best or score > best[cleaned]["confidence"]:
                        best[cleaned] = entry
                        logger.info(f"[{cam_id}] YOLOplate+OCR: {cleaned} ({score:.2f})")
                else:
                    reason = f"conf {score:.2f} < {MIN_FAST_OCR_CONFIDENCE}" if score < MIN_FAST_OCR_CONFIDENCE else vresult.reason
                    logger.debug(f"[{cam_id}] S1 rejected '{cleaned}': {reason}")

        t1 = time.perf_counter()
        logger.debug(
            f"[{cam_id}] S1: {(t1-t0)*1000:.0f} ms | "
            f"{len(vehicles)} veh | {len(plate_crops)} plate crop(s) → {len(best)} valid"
        )

        # ── Stage 2: contour fallback ──────────────────────────────
        if not best:
            search_regions: list[tuple] = (
                vehicles if vehicles
                else [(frame, (0, 0, fw, fh))]
            )

            # Collect ALL contour crops from ALL search regions first,
            # then fire them at the executor pool simultaneously.
            # Previously each crop was processed sequentially: 4 crops × ~6 s
            # = 24 s S2 latency (the worst entry in the audit log).
            s2_work: list[tuple] = []   # (raw_crop, p_label, lx1, ly1, lx2, ly2, vx1, vy1)
            for v_crop, (vx1, vy1, vx2, vy2) in search_regions:
                contour_crops = _find_plates_by_contours(v_crop)
                if contour_crops:
                    found_any_region = True
                for raw_crop, p_label, (lx1, ly1, lx2, ly2) in contour_crops:
                    s2_work.append((raw_crop, p_label, lx1, ly1, lx2, ly2, vx1, vy1, vx2, vy2))

            if s2_work:
                s2_futures = {
                    _crop_executor.submit(_fast_ocr_crop, item[0], item[1]): item
                    for item in s2_work
                }
                for future, (raw_crop, p_label, lx1, ly1, lx2, ly2, vx1, vy1, vx2, vy2) in s2_futures.items():
                    try:
                        result = future.result(timeout=15.0)
                    except Exception:
                        continue
                    if not result:
                        continue
                    text_raw, score = result
                    cleaned = fuzzy_correct_plate(text_raw)
                    vresult = _validate(cleaned)
                    if vresult.valid and score >= MIN_FAST_OCR_CONFIDENCE:
                        gx1 = max(0, min(fw, vx1 + lx1))
                        gy1 = max(0, min(fh, vy1 + ly1))
                        gx2 = max(0, min(fw, vx1 + lx2))
                        gy2 = max(0, min(fh, vy1 + ly2))
                        snap = frame[gy1:gy2, gx1:gx2]
                        entry = {
                            "text":       cleaned,
                            "confidence": round(score, 3),
                            "crop":       snap if snap.size > 0 else frame,
                            "variant":    "contour",
                        }
                        if cleaned not in best or score > best[cleaned]["confidence"]:
                            best[cleaned] = entry
                            logger.info(f"[{cam_id}] Contour+OCR: {cleaned} ({score:.2f})")
                    else:
                        reason = f"conf {score:.2f} < {MIN_FAST_OCR_CONFIDENCE}" if score < MIN_FAST_OCR_CONFIDENCE else vresult.reason
                        logger.debug(f"[{cam_id}] S2 rejected '{cleaned}': {reason}")

            t2 = time.perf_counter()
            logger.debug(
                f"[{cam_id}] S2 contour: {(t2-t1)*1000:.0f} ms → {len(best)} valid"
            )
        else:
            t2 = t1

        # ── Stage 3: EasyOCR (last resort, region-gated) ──────────
        # CRITICAL: skip entirely when the frame contains no vehicle and
        # no plate-shaped region.  Running EasyOCR on an empty frame wastes
        # 3–10 s of CPU and returns nothing useful.
        if not best and found_any_region:
            now    = time.perf_counter()
            last   = _easyocr_last_run.get(cam_id, 0.0)
            waited = now - last

            if waited < MIN_EASYOCR_INTERVAL:
                logger.debug(
                    f"[{cam_id}] S3 rate-limited "
                    f"({waited:.1f}s / {MIN_EASYOCR_INTERVAL}s)"
                )
            else:
                _easyocr_last_run[cam_id] = now
                easyocr_run_count[cam_id] = easyocr_run_count.get(cam_id, 0) + 1
                reader  = get_easyocr()
                ocr_w   = min(fw, 960)
                ocr_h   = int(fh * ocr_w / fw)
                ocr_frame = (
                    cv2.resize(frame, (ocr_w, ocr_h), interpolation=cv2.INTER_AREA)
                    if fw > 960 else frame
                )

                # Run EasyOCR in the shared executor thread so the ANPR loop
                # can enforce a hard timeout instead of blocking indefinitely.
                raw = []
                try:
                    future = _easyocr_executor.submit(
                        reader.readtext,
                        ocr_frame,
                        detail=1,
                        text_threshold=0.45,
                        width_ths=0.9,
                        allowlist=PLATE_CHARS,
                    )
                    raw = future.result(timeout=_EASYOCR_TIMEOUT)
                except FuturesTimeoutError:
                    logger.warning(
                        f"[{cam_id}] S3 EasyOCR timed out after {_EASYOCR_TIMEOUT:.0f}s — skipping"
                    )
                except Exception as exc:
                    logger.warning(f"[{cam_id}] S3 EasyOCR error: {exc}")

                logger.debug(
                    f"[easyocr/full] raw={[(t, round(c, 2)) for _, t, c in raw]}"
                )

                for bbox, text, score in raw:
                    cleaned = fuzzy_correct_plate(clean_text(text))
                    if is_valid_plate(cleaned) and score >= MIN_EASYOCR_CONFIDENCE:
                        best[cleaned] = {
                            "text": cleaned, "confidence": round(score, 3),
                            "crop": frame, "variant": "easyocr/full",
                        }
                        logger.info(f"[{cam_id}] EasyOCR: {cleaned} ({score:.2f})")
                    elif cleaned:
                        result = _validate(cleaned)
                        logger.debug(
                            f"[{cam_id}] S3 rejected: '{cleaned}' conf={score:.2f} — {result.reason}"
                        )

                if not best:
                    merged = _merge_plate_fragments(raw)
                    if merged:
                        mt, ms = merged
                        best[mt] = {
                            "text": mt, "confidence": round(ms, 3),
                            "crop": frame, "variant": "easyocr/merged",
                        }
                        logger.info(f"[{cam_id}] EasyOCR merged: {mt} ({ms:.2f})")

                t3 = time.perf_counter()
                logger.debug(
                    f"[{cam_id}] S3 EasyOCR: {(t3-t2)*1000:.0f} ms "
                    f"→ {len(best)} plate(s)"
                )

        elif not best:
            logger.debug(
                f"[{cam_id}] S3 skipped — no vehicle or plate-shaped region in frame"
            )

        plates = sorted(best.values(), key=lambda p: p["confidence"], reverse=True)
        ttotal = time.perf_counter()
        logger.debug(
            f"[{cam_id}] Frame total: {(ttotal-t0)*1000:.0f} ms, "
            f"{len(plates)} plate(s)"
        )
        return plates

    except Exception as e:
        logger.error(f"detect_plates_in_frame error: {e}")
        return []


# ── Crop-based extraction (for /camera/{id}/test-once) ────────

def extract_best_result(plate_image):
    try:
        if plate_image is None or plate_image.size == 0:
            return None
        h, w = plate_image.shape[:2]
        if h < 10 or w < 30:
            return None

        # Try fast-plate-ocr first
        result = _fast_ocr_crop(plate_image, "test-once")
        if result:
            text_raw, score = result
            cleaned = fuzzy_correct_plate(text_raw)
            if is_valid_plate(cleaned) and score >= MIN_FAST_OCR_CONFIDENCE:
                logger.info(f"test-once fast-plate-ocr: {cleaned} ({score:.2f})")
                return {"text": cleaned, "confidence": round(score, 3)}

        # Fall back to EasyOCR with preprocessing variants
        reader   = get_easyocr()
        variants = generate_ocr_variants(plate_image)
        if not variants:
            return None

        best_text  = None
        best_score = 0.0

        for processed in variants:
            if processed is None:
                continue
            if len(processed.shape) == 2:
                processed = cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR)
            for (_bbox, text, score) in reader.readtext(
                processed, detail=1,
                allowlist=PLATE_CHARS, width_ths=0.9,
            ):
                cleaned = fuzzy_correct_plate(clean_text(text))
                if (
                    7 <= len(cleaned) <= 11
                    and score >= MIN_EASYOCR_CONFIDENCE
                    and score > best_score
                    and is_valid_plate(cleaned)
                ):
                    best_text  = cleaned
                    best_score = score

        if best_text:
            logger.info(f"test-once EasyOCR: {best_text} ({best_score:.2f})")
            return {"text": best_text, "confidence": round(best_score, 3)}
        return None

    except Exception as e:
        logger.error(f"extract_best_result error: {e}")
        return None


# ── Backward-compat wrapper ───────────────────────────────────

def extract_plate_text(plate_image):
    result = extract_best_result(plate_image)
    return result.get("text") if result else None
