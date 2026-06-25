"""
live_test.py — Run this while the backend is STOPPED.
Hold a license plate in front of your webcam.
It will continuously show what the OCR model reads.

Usage:
  venv/bin/python3 live_test.py
  venv/bin/python3 live_test.py http://192.168.0.2:8080/video
"""
import sys, re, time
import cv2
import numpy as np

SOURCE = sys.argv[1] if len(sys.argv) > 1 else 0
if str(SOURCE).isdigit():
    SOURCE = int(SOURCE)

PLATE_RE = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$")

def clean(t):
    return re.sub(r"[^A-Z0-9]", "", (t or "").upper())

# Load OCR model once
print("Loading OCR model...")
from fast_plate_ocr import LicensePlateRecognizer
ocr = LicensePlateRecognizer("cct-s-v2-global-model")
print("Model ready.\n")

cap = cv2.VideoCapture(SOURCE)
if not cap.isOpened():
    print(f"ERROR: Cannot open {SOURCE}")
    sys.exit(1)

for _ in range(5):
    cap.read()   # flush stale frames

print("Camera open. Hold plate in front of camera. Press Ctrl+C to stop.\n")
last_save = 0

while True:
    ret, frame = cap.read()
    if not ret or frame is None:
        time.sleep(0.1)
        continue

    fh, fw = frame.shape[:2]

    # ── Find plate candidates via contours ──────────────────────────
    gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur  = cv2.bilateralFilter(gray, 11, 17, 17)
    edges = cv2.Canny(blur, 30, 200)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 1))
    edges  = cv2.dilate(edges, kernel, iterations=1)
    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:40]

    debug = frame.copy()
    found_plate = None

    for cnt in cnts:
        if cv2.contourArea(cnt) < 150:
            continue
        x, y, rw, rh = cv2.boundingRect(cnt)
        if rw < 40 or rh < 8:
            continue
        ar = rw / max(rh, 1)
        if not (1.8 <= ar <= 9.0):
            continue

        # Expand crop generously to capture full plate
        px = max(30, int(rw * 0.5))
        py = max(20, int(rh * 0.8))
        cx1 = max(0, x - px);  cy1 = max(0, y - py)
        cx2 = min(fw, x+rw+px); cy2 = min(fh, y+rh+py)
        crop = frame[cy1:cy2, cx1:cx2]
        if crop.size == 0:
            continue

        ch, cw = crop.shape[:2]
        preds = ocr.run(crop, return_confidence=True)
        if not preds:
            continue
        pred = preds[0]
        raw  = clean(pred.plate if hasattr(pred, "plate") else str(pred))
        cprobs = pred.char_probs if hasattr(pred, "char_probs") and pred.char_probs is not None else None
        conf = float(np.mean(cprobs)) if cprobs is not None else 0.5

        valid = bool(PLATE_RE.match(raw)) and len(raw) >= 7
        color = (0,255,0) if valid else (0,165,255)
        cv2.rectangle(debug, (cx1,cy1), (cx2,cy2), color, 2)
        label = f"{raw} {conf:.0%}"
        cv2.putText(debug, label, (cx1, cy1-6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        print(f"  crop={cw}x{ch}  raw='{raw}'  conf={conf:.2f}  valid={valid}")

        if valid and not found_plate:
            found_plate = (raw, conf, crop, frame.copy())

    if found_plate:
        plate_text, plate_conf, plate_crop, full_frame = found_plate
        ts = time.strftime("%H%M%S")
        cv2.imwrite(f"detected_{ts}_{plate_text}.jpg", full_frame)
        cv2.imwrite(f"plate_{ts}_{plate_text}.jpg", plate_crop)
        print(f"\n{'='*50}")
        print(f"  ✓ PLATE DETECTED: {plate_text}  ({plate_conf:.0%})")
        print(f"  Saved: detected_{ts}_{plate_text}.jpg")
        print(f"{'='*50}\n")
        time.sleep(3)  # pause before next detection

    time.sleep(0.3)
