import os
from pathlib import Path


# ==========================================
# PROJECT ROOT
# ==========================================

BASE_DIR = Path(__file__).resolve().parents[3]


# ==========================================
# DATABASE
# ==========================================

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR}/anpr.db")


# ==========================================
# CAMERA SETTINGS
# ==========================================

# Laptop Webcam
CAMERA_SOURCE = 0

# Mobile IP Camera
# CAMERA_SOURCE = "http://192.168.1.5:8080/video"

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720


# ==========================================
# FRAME QUALITY GATES
# ==========================================

# Frames that are too blurry, too dark, or overexposed produce hallucinated OCR
# reads that pollute the vote buffer.  These gates run before any OCR stage.
#
# FRAME_BLUR_THRESHOLD  — minimum Laplacian variance.
#   Typical values: very blurry < 10, compressed stream 15-45, good webcam 60-300+
#   IP camera MJPEG/H.264 streams typically score 15–45 due to compression
#   artefacts that suppress edge energy.  60 caused 92% rejection on such streams.
#   Set to 0 to disable the blur check entirely.
FRAME_BLUR_THRESHOLD  = 25.0   # lowered from 60; auto-calibrated down if rejection > 80%

# Mean pixel brightness bounds (0–255 in grayscale).
#   Below BRIGHTNESS_MIN: too dark for reliable OCR (e.g. lights off).
#   Above BRIGHTNESS_MAX: overexposed / blown-out (direct sunlight into lens).
#   Set BRIGHTNESS_MIN=0 / BRIGHTNESS_MAX=255 to disable brightness check.
FRAME_BRIGHTNESS_MIN  = 15     # skip frames darker than this
FRAME_BRIGHTNESS_MAX  = 240    # skip frames brighter than this

# Minimum crop dimensions before attempting fast-plate-ocr.
# Crops below these sizes produce near-random character predictions because
# the model input (128×64) upscaling from a tiny source is pure interpolation.
MIN_CROP_WIDTH  = 40   # pixels
MIN_CROP_HEIGHT = 12   # pixels

# ==========================================
# DETECTION SETTINGS
# ==========================================


# ==========================================
# STORAGE PATHS
# ==========================================

STORAGE_DIR = BASE_DIR / "storage"

DETECTION_DIR = STORAGE_DIR / "detections"
EXPORT_DIR    = STORAGE_DIR / "exports"
LOG_DIR       = STORAGE_DIR / "logs"
REPORTS_DIR   = STORAGE_DIR / "reports"
BACKUPS_DIR   = STORAGE_DIR / "backups"

DETECTION_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

# Detection snapshot retention policy.
# Files older than MAX_AGE_DAYS are deleted hourly.
# If the directory still exceeds MAX_SIZE_MB after age pruning,
# the oldest files are removed until it fits within the budget.
DETECTION_MAX_AGE_DAYS = int(os.getenv("DETECTION_MAX_AGE_DAYS", "30"))
DETECTION_MAX_SIZE_MB  = int(os.getenv("DETECTION_MAX_SIZE_MB",  "5000"))


# ==========================================
# OCR CONFIDENCE THRESHOLDS
# ==========================================

# Two separate constants because fast-plate-ocr and EasyOCR have different
# confidence distributions:
#   fast-plate-ocr  — mean of per-character softmax probs  → typically 0.55–0.97
#   EasyOCR         — single text-box detection score      → typically 0.40–0.95
#
# Raise either value here to tighten or loosen the acceptance gate without
# touching any other file.

MIN_FAST_OCR_CONFIDENCE = 0.70   # Stages 1 + 2  (fast-plate-ocr cct-s-v2)
MIN_EASYOCR_CONFIDENCE  = 0.65   # Stage 3       (EasyOCR full-frame fallback)

# Minimum seconds between two consecutive EasyOCR full-frame scans per camera.
# EasyOCR takes ~3 s on CPU; without this gate it runs every frame when no
# plate is detected by Stages 1/2, capping effective detection rate at 0.3 fps.
# At 2.0 s, Stage 3 fires at most every 2 s; Stages 1 and 2 still run on every
# frame in between (~150 ms each → ~6 fps for fast-path detection).
MIN_EASYOCR_INTERVAL = 4.0       # seconds; EasyOCR takes 3–8s on CPU — 4s prevents back-to-back calls


# ==========================================
# MULTI-FRAME VOTING
# ==========================================

# A plate is confirmed only after appearing consistently across multiple OCR
# frames.  This is the primary defence against single-frame OCR hallucinations.
#
# How it works
# ------------
# The last VOTE_WINDOW OCR frames are kept per camera.  A plate is confirmed
# when it appears (exact text) in at least VOTE_MIN of those frames.
# Exception: a single read whose confidence ≥ VOTE_BYPASS is confirmed
# immediately — reserved for crystal-clear, unambiguous reads.
#
# Tuning guide
# ------------
#   VOTE_MIN = 1  → immediate (demo / close-up testing, no dwell time)
#   VOTE_MIN = 3  → robust   (default — requires ≥ 3 consistent reads)
#   VOTE_MIN = 5  → strict   (parking gate, vehicle dwells 10+ s)
#
# Keep VOTE_WINDOW ≥ VOTE_MIN + 2 to allow for missed frames in the window.

VOTE_WINDOW  = 5     # recent OCR frames tracked per camera
VOTE_MIN     = 3     # minimum appearances for confirmation
# VOTE_BYPASS — confidence threshold for immediate single-frame confirmation.
# fast-plate-ocr (cct-s-v2) peaks at ~0.85–0.90 for unambiguous plates;
# 0.92 was effectively dead code.  0.85 fires for genuine crystal-clear reads
# while still requiring multi-frame confirmation for everything below that.
VOTE_BYPASS  = 0.85  # single-frame bypass

# Seconds after a plate is first confirmed before it can fire again through
# the vote path.  The DuplicateGuard (120 s) already prevents re-saving;
# this shorter window stops the vote buffer from emitting noisy re-confirmation
# log messages every OCR frame while the vehicle is still visible.
RECONFIRM_SUPPRESS_SECS = 5.0


# ==========================================
# SESSION SETTINGS
# ==========================================

VEHICLE_EXIT_TIMEOUT = 300

# Set to "true" to accept non-Indian plate formats.
# When enabled, validation is relaxed to: alphanumeric, length 4–20, no 4+ identical chars.
# Indian structural correction is still attempted first; plates that match Indian format
# are always corrected regardless of this flag.
ALLOW_INTERNATIONAL = os.getenv("ALLOW_INTERNATIONAL", "false").lower() == "true"


# ==========================================
# WEBSOCKET
# ==========================================

WEBSOCKET_ROUTE = "/ws"


# ==========================================
# OCCUPANCY / CAPACITY
# ==========================================

# Maximum vehicle capacity for the site (used in occupancy % calculations).
# Set to 0 to disable capacity-based widgets.
MAX_CAPACITY = int(os.getenv("MAX_CAPACITY", "100"))


# ==========================================
# EMAIL ALERTS  (optional — leave blank to disable)
# ==========================================

SMTP_HOST     = os.getenv("SMTP_HOST",     "")          # e.g. smtp.gmail.com
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))       # 587 = STARTTLS, 465 = SSL
SMTP_USER     = os.getenv("SMTP_USER",     "")           # sender address
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")           # app password / SMTP password
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "")         # comma-separated recipients