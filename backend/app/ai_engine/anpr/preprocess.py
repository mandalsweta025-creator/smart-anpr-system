import cv2
import numpy as np


# ==========================================
# NORMALIZE CROP
# ==========================================

def normalize_crop(crop: np.ndarray):

    if crop is None or crop.size == 0:
        return None

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    h, w = gray.shape

    if h == 0 or w == 0:
        return None

    aspect_ratio = w / h

    # Reject impossible plate shapes
    if aspect_ratio < 2.0 or aspect_ratio > 7.0:
        return None

    scale = min(240 / w, 80 / h)

    nw = int(w * scale)
    nh = int(h * scale)

    resized = cv2.resize(
        gray,
        (nw, nh),
        interpolation=cv2.INTER_CUBIC
    )

    canvas = np.ones(
        (80, 240),
        dtype=np.uint8
    ) * 255

    x = (240 - nw) // 2
    y = (80 - nh) // 2

    canvas[y:y+nh, x:x+nw] = resized

    return canvas


# ==========================================
# OCR VARIANT GENERATOR
# ==========================================

def generate_ocr_variants(crop):

    variants = []

    normalized = normalize_crop(crop)

    if normalized is None:
        return []

    # ======================================
    # VARIANT 1 — CLEAN
    # ======================================

    variants.append(normalized)

    # ======================================
    # VARIANT 2 — THRESHOLD
    # ======================================

    thresh = cv2.adaptiveThreshold(
        normalized,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11,
        2
    )

    variants.append(thresh)

    # ======================================
    # VARIANT 3 — SHARPEN
    # ======================================

    sharpen_kernel = np.array([
        [0, -1, 0],
        [-1, 5,-1],
        [0, -1, 0]
    ])

    sharpened = cv2.filter2D(
        normalized,
        -1,
        sharpen_kernel
    )

    variants.append(sharpened)

    # ======================================
    # VARIANT 4 — DENOISED
    # ======================================

    denoised = cv2.fastNlMeansDenoising(
        normalized
    )

    variants.append(denoised)

    return variants