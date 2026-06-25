"""
diagnose_anpr.py — Run this from the project root while the backend is NOT running.
Usage: python3 diagnose_anpr.py [camera_source]
Examples:
  python3 diagnose_anpr.py                          # uses webcam (0)
  python3 diagnose_anpr.py http://192.168.0.2:8080/video
  python3 diagnose_anpr.py /path/to/test_image.jpg  # test on a saved image

Shows EVERY step: frame size, contour regions, raw OCR text, confidence, why each failed.
"""

import sys
import os
import cv2
import numpy as np
import re

# ── Source from argv ──────────────────────────────────────────────────────────
source_arg = sys.argv[1] if len(sys.argv) > 1 else "0"
if source_arg.isdigit():
    source_arg = int(source_arg)

print(f"\n{'='*65}")
print(f"  ANPR LIVE DIAGNOSTIC")
print(f"  Source: {source_arg}")
print(f"{'='*65}\n")

# ── 1. Capture frame ─────────────────────────────────────────────────────────
print("STEP 1 — Capturing frame...")

if isinstance(source_arg, str) and os.path.isfile(source_arg):
    frame = cv2.imread(source_arg)
    if frame is None:
        print(f"  ERROR: Cannot read image file: {source_arg}")
        sys.exit(1)
    print(f"  Loaded from file: {frame.shape[1]}x{frame.shape[0]}")
else:
    cap = cv2.VideoCapture(source_arg)
    if not cap.isOpened():
        print(f"  ERROR: Cannot open camera/stream: {source_arg}")
        sys.exit(1)
    for _ in range(10):   # flush buffer
        cap.read()
    ret, frame = cap.read()
    cap.release()
    if not ret or frame is None:
        print(f"  ERROR: No frame returned from: {source_arg}")
        sys.exit(1)
    print(f"  Captured: {frame.shape[1]}x{frame.shape[0]} px")

fh, fw = frame.shape[:2]
cv2.imwrite("diag_frame.jpg", frame)
print(f"  Saved frame → diag_frame.jpg  (open this to see what the camera sees)\n")


# ── 2. Contour plate candidate detection ────────────────────────────────────
print("STEP 2 — Contour-based plate region detection...")

gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
blur  = cv2.bilateralFilter(gray, 11, 17, 17)
edges = cv2.Canny(blur, 30, 200)
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 1))
edges  = cv2.dilate(edges, kernel, iterations=1)
contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
contours = sorted(contours, key=cv2.contourArea, reverse=True)[:80]

candidates = []
seen = set()
for cnt in contours:
    area = cv2.contourArea(cnt)
    if area < 300:
        continue
    x, y, rw, rh = cv2.boundingRect(cnt)
    ar = rw / max(rh, 1)
    if rw < 40 or rh < 8:
        continue
    if not (1.5 <= ar <= 10.0):
        continue
    key = (x // 20, y // 20)
    if key in seen:
        continue
    seen.add(key)
    pad = 6
    cx1, cy1 = max(0, x - pad), max(0, y - pad)
    cx2, cy2 = min(fw, x + rw + pad), min(fh, y + rh + pad)
    crop = frame[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        continue
    candidates.append((crop, f"contour@({cx1},{cy1})", area, ar, (cx1,cy1,cx2,cy2)))

print(f"  Found {len(candidates)} plate-shaped contour regions")
if len(candidates) == 0:
    print("  ⚠  NONE found. Plate may be too small, at wrong angle, or poorly lit.")
    print("     Try moving camera closer or adjusting angle.")
else:
    for i, (crop, label, area, ar, bbox) in enumerate(candidates[:8]):
        ch, cw = crop.shape[:2]
        print(f"  [{i+1}] size={cw}x{ch}  aspect={ar:.1f}  area={int(area)}", end="")
        if cw < 80:
            print("  ← TOO SMALL for ONNX model (needs ≥80px wide)", end="")
        print()

# Draw candidates on frame copy
debug_frame = frame.copy()
for _, _, _, _, bbox in candidates[:8]:
    cv2.rectangle(debug_frame, (bbox[0], bbox[1]), (bbox[2], bbox[3]), (0, 255, 0), 2)
cv2.imwrite("diag_contours.jpg", debug_frame)
print(f"  Saved annotated frame → diag_contours.jpg\n")


# ── 3. fast-plate-ocr on each candidate ────────────────────────────────────
print("STEP 3 — fast-plate-ocr on contour candidates...")
try:
    from fast_plate_ocr import LicensePlateRecognizer
    ocr = LicensePlateRecognizer("cct-s-v2-global-model")
    print("  Model loaded: cct-s-v2-global-model")

    def clean(t):
        return re.sub(r"[^A-Z0-9]", "", (t or "").upper())

    PLATE_RE = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$")

    any_valid = False
    for i, (crop, label, area, ar, bbox) in enumerate(candidates[:8]):
        ch, cw = crop.shape[:2]
        preds = ocr.run(crop, return_confidence=True)
        if not preds:
            print(f"  [{i+1}] {cw}x{ch}: (no prediction)")
            continue
        pred = preds[0]
        raw  = pred.plate if hasattr(pred, "plate") else str(pred)
        cprobs = pred.char_probs if hasattr(pred, "char_probs") and pred.char_probs is not None else None
        conf = float(np.mean(cprobs)) if cprobs is not None else 0.5
        cleaned = clean(raw)
        valid = bool(PLATE_RE.match(cleaned))
        if valid:
            any_valid = True
        print(f"  [{i+1}] {cw}x{ch}: raw='{raw}' cleaned='{cleaned}' conf={conf:.3f} {'✓ VALID PLATE' if valid else '✗ not a valid Indian plate'}")

    if not any_valid:
        print("  ⚠  No valid plate found via contours + fast-plate-ocr")
except Exception as e:
    print(f"  ERROR loading/running fast-plate-ocr: {e}")
    print("  → fast-plate-ocr may not be installed or model name is wrong")
print()


# ── 4. Full-frame EasyOCR ────────────────────────────────────────────────────
print("STEP 4 — EasyOCR on full frame (slow, ~10-30s first run)...")
try:
    import easyocr
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    scale = max(1.0, 1280 / fw)
    test_frame = cv2.resize(frame, (int(fw * scale), int(fh * scale)), interpolation=cv2.INTER_CUBIC) if scale > 1.0 else frame
    PLATE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    results = reader.readtext(test_frame, detail=1, text_threshold=0.2, width_ths=0.9, allowlist=PLATE_CHARS)
    print(f"  EasyOCR found {len(results)} text regions:")
    any_valid_easy = False
    for (bbox, text, score) in results:
        cleaned = clean(text)
        valid = bool(PLATE_RE.match(cleaned)) if len(cleaned) >= 6 else False
        if valid:
            any_valid_easy = True
        print(f"    '{text}' → '{cleaned}' conf={score:.2f} {'✓ VALID' if valid else ''}")
    if not results:
        print("  EasyOCR found nothing in this frame.")
except Exception as e:
    print(f"  ERROR with EasyOCR: {e}")
print()


# ── 5. Verdict ───────────────────────────────────────────────────────────────
print(f"{'='*65}")
print("DIAGNOSIS SUMMARY")
print(f"{'='*65}")
print(f"Frame size     : {fw}x{fh}")
print(f"Contour regions: {len(candidates)}")
if candidates:
    widths = [c.shape[1] for c, *_ in candidates[:8]]
    print(f"Candidate widths: {widths}")
    if max(widths) < 80:
        print("\n⚠  ALL candidates are < 80px wide.")
        print("   ONNX model won't read plates this small reliably.")
        print("   FIX: Move camera CLOSER to the license plate.")
        print("        Target: plate should be ≥200px wide in the frame.")
    elif max(widths) < 150:
        print("\n⚠  Candidates are < 150px wide — marginal OCR accuracy.")
        print("   FIX: Move camera closer for more reliable reads.")
else:
    print("\n⚠  No plate-shaped regions found at all.")
    print("   FIX: Ensure plate is visible, well-lit, and roughly horizontal.")
    print("        Try a higher-contrast image or better lighting.")

print()
print("Open diag_frame.jpg to see the raw camera frame.")
print("Open diag_contours.jpg to see detected plate regions (green boxes).")
