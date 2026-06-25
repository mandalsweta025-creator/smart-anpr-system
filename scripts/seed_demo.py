"""
Seed the ANPR database with realistic demo data.

Run from the project root:
    venv/bin/python3 scripts/seed_demo.py

Creates:
 - 10 detections across today and the last 4 days
 - 8 vehicle sessions (5 EXITED with duration, 3 still ENTERED/active)
 - Plate snapshot images drawn with Indian plate styling
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta
import random
import cv2
import numpy as np
from pathlib import Path

from backend.app.database.connection import SessionLocal, Base, engine
from backend.app.models.detections import Detection
from backend.app.models.vehicle_sessions import VehicleSession
from backend.app.models.alert import Alert

Base.metadata.create_all(bind=engine)

DETECTIONS_DIR = Path("storage/detections")
DETECTIONS_DIR.mkdir(parents=True, exist_ok=True)

NOW = datetime.utcnow().replace(second=0, microsecond=0)


# ── Indian plates: state WB / DL / MH / KA / TN ─────────────────────────────
PLATES = [
    ("WB06AB1234", "White Sedan",    "ENTRY"),
    ("DL3CAF0291", "Blue SUV",       "ENTRY"),
    ("MH12DE4567", "Silver Hatchback","ENTRY"),
    ("KA05MN8821", "Red Truck",      "EXITED"),
    ("TN22BC9910", "Black Sedan",    "EXITED"),
    ("WB02XY7755", "Grey MPV",       "EXITED"),
    ("DL8CBA3312", "White Van",      "EXITED"),
    ("MH04CD5678", "Yellow Taxi",    "EXITED"),
]

# ── Render a plate image ──────────────────────────────────────────────────────

def render_plate(text: str, width=400, height=100) -> np.ndarray:
    """Draw an Indian-style yellow plate with black text."""
    img = np.ones((height, width, 3), dtype=np.uint8) * 255  # white bg
    # Yellow plate area
    cv2.rectangle(img, (4, 4), (width - 4, height - 4), (0, 200, 255), -1)
    cv2.rectangle(img, (4, 4), (width - 4, height - 4), (0, 0, 0), 3)
    # IND strip (blue, top-left corner like real Indian plates)
    cv2.rectangle(img, (4, 4), (42, height - 4), (200, 50, 0), -1)
    cv2.putText(img, "IND", (5, height - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4,
                (255, 255, 255), 1, cv2.LINE_AA)

    # Plate text
    font_scale = 1.6
    thickness  = 3
    font       = cv2.FONT_HERSHEY_DUPLEX
    (tw, th), _ = cv2.getTextSize(text, font, font_scale, thickness)
    tx = (width - tw) // 2 + 10
    ty = (height + th) // 2 - 4
    cv2.putText(img, text, (tx, ty), font, font_scale, (0, 0, 0), thickness, cv2.LINE_AA)
    return img


def _ago(hours=0, minutes=0, days=0) -> datetime:
    return NOW - timedelta(days=days, hours=hours, minutes=minutes)


def run():
    db = SessionLocal()

    # Remove only demo records we're about to re-seed (keep originals from before)
    db.query(Detection).filter(Detection.plate_number.in_([p for p, *_ in PLATES])).delete(synchronize_session=False)
    db.query(VehicleSession).filter(VehicleSession.plate_number.in_([p for p, *_ in PLATES])).delete(synchronize_session=False)
    db.commit()

    # Time slots spread across last 4 days for a believable history
    time_slots = [
        _ago(days=3, hours=8, minutes=12),
        _ago(days=3, hours=10, minutes=45),
        _ago(days=2, hours=9,  minutes=3),
        _ago(days=2, hours=14, minutes=37),
        _ago(days=1, hours=8,  minutes=55),
        _ago(days=1, hours=11, minutes=20),
        _ago(days=0, hours=7,  minutes=10),
        _ago(days=0, hours=9,  minutes=45),
        _ago(days=0, hours=10, minutes=30),   # duplicate plate re-entry
        _ago(days=0, hours=0,  minutes=15),   # very recent
    ]

    plate_times = list(zip([p for p, *_ in PLATES], time_slots[:len(PLATES)]))

    for idx, (plate, vehicle_type, expected_status) in enumerate(PLATES):
        entry_time = time_slots[idx]

        # ── Snapshot image ──────────────────────────────────────
        img = render_plate(plate)
        fname = f"demo_{plate}_{int(entry_time.timestamp())}.jpg"
        fpath = DETECTIONS_DIR / fname
        cv2.imwrite(str(fpath), img)
        rel_path = str(fpath)

        # ── Detection record ────────────────────────────────────
        conf = round(random.uniform(0.72, 0.97), 3)
        det = Detection(
            plate_number=plate,
            confidence=conf,
            image_path=rel_path,
            timestamp=entry_time,
        )
        db.add(det)

        # ── Session record ──────────────────────────────────────
        if expected_status == "EXITED":
            stay_minutes = random.randint(12, 95)
            exit_time    = entry_time + timedelta(minutes=stay_minutes)
            session = VehicleSession(
                plate_number=plate,
                entry_time=entry_time,
                exit_time=exit_time,
                duration_minutes=round(stay_minutes, 1),
                status="EXITED",
                snapshot_path=rel_path,
            )
        else:
            # Still inside (active)
            session = VehicleSession(
                plate_number=plate,
                entry_time=entry_time,
                exit_time=None,
                duration_minutes=None,
                status="ENTERED",
                snapshot_path=rel_path,
            )

        db.add(session)
        print(f"  [{expected_status:6s}] {plate}  entry={entry_time.strftime('%Y-%m-%d %H:%M')}  snap={fname}")

    # Add a second detection for one plate (shows it coming back today)
    plate_repeat = "WB06AB1234"
    t_repeat = _ago(hours=1, minutes=5)
    img2 = render_plate(plate_repeat)
    fname2 = f"demo_{plate_repeat}_{int(t_repeat.timestamp())}.jpg"
    cv2.imwrite(str(DETECTIONS_DIR / fname2), img2)
    db.add(Detection(
        plate_number=plate_repeat,
        confidence=round(random.uniform(0.80, 0.95), 3),
        image_path=str(DETECTIONS_DIR / fname2),
        timestamp=t_repeat,
    ))
    print(f"  [re-entry] {plate_repeat}  {t_repeat.strftime('%Y-%m-%d %H:%M')}")

    db.commit()
    db.close()

    print("\nDone! DB now contains:")
    db2 = SessionLocal()
    from backend.app.models.detections import Detection as D
    from backend.app.models.vehicle_sessions import VehicleSession as VS
    print(f"  Detections: {db2.query(D).count()}")
    print(f"  Sessions:   {db2.query(VS).count()}")
    active = db2.query(VS).filter(VS.status == "ENTERED").count()
    print(f"  Active (ENTERED): {active}")
    db2.close()


if __name__ == "__main__":
    run()
