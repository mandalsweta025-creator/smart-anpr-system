"""
setup_demo.py — Populate the database with rich, realistic demo data.

Seeds:
  • 20 vehicles across 5 Indian states
  • 250+ detections spread across the last 7 days (peak-hour weighted)
  • 40+ sessions with realistic dwell times
  • 8 anomaly events of mixed types and severities
  • Camera activity across 2 cameras

Usage:
    venv/bin/python3 setup_demo.py [--reset]

    --reset  Delete all existing detections, sessions, and anomalies before seeding.
             Without this flag the script appends to existing data.
"""

import sys, os, random, math
sys.path.insert(0, ".")
os.makedirs("storage/detections", exist_ok=True)

import cv2
import numpy as np
from datetime import datetime, timezone, timedelta
from sqlalchemy import text

from backend.app.database.connection import SessionLocal
from backend.app.models.detections import Detection
from backend.app.models.vehicle_sessions import VehicleSession
from backend.app.models.anomaly import AnomalyEvent

RESET = "--reset" in sys.argv

random.seed(42)

# ── Plate image generator ──────────────────────────────────────

def make_plate_img(plate_text: str, filename: str) -> str:
    img = np.ones((80, 360, 3), dtype=np.uint8) * 242
    cv2.rectangle(img, (0, 0), (359, 79), (20, 20, 20), 3)
    cv2.rectangle(img, (3, 3), (356, 76), (180, 180, 180), 1)
    font = cv2.FONT_HERSHEY_SIMPLEX
    parts = [plate_text[:2], plate_text[2:4], plate_text[4:6], plate_text[6:]] if len(plate_text) >= 8 else [plate_text]
    label = " ".join(p for p in parts if p)
    tw, _ = cv2.getTextSize(label, font, 1.4, 3)[0]
    x = max(8, (360 - tw) // 2)
    cv2.putText(img, label, (x, 56), font, 1.4, (10, 10, 10), 3)
    path = f"storage/detections/{filename}"
    cv2.imwrite(path, img)
    return filename


# ── Vehicle fleet ──────────────────────────────────────────────

PLATES = [
    # Maharashtra
    "MH12AB3456", "MH20DV2363", "MH01AM4682", "MH43CX7721", "MH04JK9900",
    # Delhi
    "DL4CAF7823", "DL8CY0022",  "DL10BQ5544",
    # Karnataka
    "KA03MH4521", "KA51AA1234", "KA09ZZ8800",
    # Haryana
    "HR26BR9044", "HR26DQ5551", "HR29AB3300",
    # Rajasthan
    "RJ14CV0002", "RJ45GH2211",
    # Tamil Nadu
    "TN07CD8832", "TN01AB6789",
    # UP / other
    "UP14FN4661", "CG12BH4387",
]

# Plates that are blacklisted / watchlisted for anomaly generation
BLACKLISTED  = {"DL8CY0022"}
WATCHLISTED  = {"HR29AB3300", "TN01AB6789"}

CAMERAS = ["1", "2"]  # camera IDs


# ── Time helpers ───────────────────────────────────────────────

def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def ts_ago(**kwargs) -> datetime:
    return utcnow() - timedelta(**kwargs)

def weighted_hour() -> int:
    """Return an hour-of-day biased toward morning (7-10) and evening (16-19) peaks."""
    weights = [0.3]*6 + [1.5, 3, 4, 3, 2, 1.5, 1.5, 2, 2, 1.5, 3, 4, 3, 2, 1, 0.5, 0.3, 0.3]
    hours   = list(range(24))
    return random.choices(hours, weights=weights[:24], k=1)[0]

def rand_ts_in_day(days_ago: int) -> datetime:
    """Random timestamp within a specific past calendar day."""
    base = utcnow() - timedelta(days=days_ago)
    base = base.replace(hour=0, minute=0, second=0, microsecond=0)
    h = weighted_hour()
    m = random.randint(0, 59)
    s = random.randint(0, 59)
    return base + timedelta(hours=h, minutes=m, seconds=s)


# ── DB setup ───────────────────────────────────────────────────

db = SessionLocal()

if RESET:
    print("Resetting existing data…")
    db.execute(text("DELETE FROM anomaly_events"))
    db.execute(text("DELETE FROM vehicle_sessions"))
    db.execute(text("DELETE FROM detections"))
    db.commit()
    print("  Tables cleared.\n")


# ── 1. Generate detections + sessions across 7 days ───────────

print("Generating detections and sessions across 7 days…")

sessions_created = 0
detections_created = 0

# Each day: 30-45 random detection events
for day in range(7, 0, -1):
    n_events = random.randint(30, 45)
    day_plates = random.choices(PLATES, k=n_events)

    # Track which plates are currently "inside" this day (for session pairing)
    inside: dict[str, tuple[datetime, str]] = {}  # plate → (entry_ts, snap)

    # Sort events chronologically within the day
    events = []
    for plate in day_plates:
        ts = rand_ts_in_day(day)
        events.append((ts, plate))
    events.sort(key=lambda x: x[0])

    for ts, plate in events:
        conf = round(random.uniform(0.78, 0.99), 2)
        cam  = random.choice(CAMERAS)

        # Decide event type
        if plate in inside:
            etype = "EXIT"
        elif random.random() < 0.15:  # 15% plain detections (no session)
            etype = "DETECTION"
        else:
            etype = "ENTRY"

        fname = f"{plate}_{int(ts.timestamp())}_{day}.jpg"
        make_plate_img(plate, fname)

        det = Detection(
            plate_number=plate,
            confidence=conf,
            image_path=fname,
            timestamp=ts,
            camera_id=cam,
            event_type=etype,
            orientation="INBOUND" if etype == "ENTRY" else ("OUTBOUND" if etype == "EXIT" else "UNKNOWN"),
        )
        db.add(det)
        detections_created += 1

        if etype == "ENTRY":
            inside[plate] = (ts, fname)
        elif etype == "EXIT" and plate in inside:
            entry_ts, entry_snap = inside.pop(plate)
            dwell = (ts - entry_ts).total_seconds() / 60
            sess = VehicleSession(
                plate_number=plate,
                entry_time=entry_ts,
                exit_time=ts,
                duration_minutes=round(dwell, 1),
                status="EXITED",
                camera_id=cam,
                exit_camera_id=cam,
            )
            db.add(sess)
            sessions_created += 1

    # Any plates still inside at end of day → create ENTERED session (except last 2 days)
    for plate, (entry_ts, snap) in inside.items():
        if day > 2:
            # Simulate exit later that day
            exit_ts = entry_ts + timedelta(minutes=random.randint(20, 120))
            dwell   = (exit_ts - entry_ts).total_seconds() / 60
            sess = VehicleSession(
                plate_number=plate,
                entry_time=entry_ts,
                exit_time=exit_ts,
                duration_minutes=round(dwell, 1),
                status="EXITED",
                camera_id=random.choice(CAMERAS),
            )
            db.add(sess)
            sessions_created += 1

db.commit()
print(f"  {detections_created} detections, {sessions_created} sessions created.\n")


# ── 2. Add a few ENTERED (still-inside) sessions for today ─────

print("Adding active sessions (vehicles currently inside)…")
active_plates = random.sample(PLATES, 3)
for plate in active_plates:
    entry_ts = ts_ago(minutes=random.randint(5, 90))
    cam = random.choice(CAMERAS)
    fname = f"{plate}_{int(entry_ts.timestamp())}_live.jpg"
    make_plate_img(plate, fname)

    db.add(Detection(
        plate_number=plate, confidence=round(random.uniform(0.85, 0.98), 2),
        image_path=fname, timestamp=entry_ts, camera_id=cam, event_type="ENTRY",
    ))
    db.add(VehicleSession(
        plate_number=plate, entry_time=entry_ts,
        exit_time=None, duration_minutes=None,
        status="ENTERED", camera_id=cam,
    ))
    detections_created += 1
    sessions_created   += 1
    print(f"  ACTIVE  {plate}  (entered {int((utcnow() - entry_ts).total_seconds() / 60)}min ago)")

db.commit()


# ── 3. Anomaly events ─────────────────────────────────────────

print("\nCreating anomaly events…")

ANOMALIES = [
    {
        "anomaly_type": "BLACKLISTED_VEHICLE",
        "severity": "CRITICAL",
        "plate_number": "DL8CY0022",
        "camera_id": "1",
        "description": "Blacklisted vehicle DL8CY0022 detected at main entrance",
        "status": "OPEN",
        "created_at": ts_ago(hours=2),
    },
    {
        "anomaly_type": "WATCHLIST_SIGHTING",
        "severity": "HIGH",
        "plate_number": "HR29AB3300",
        "camera_id": "2",
        "description": "Watchlisted vehicle HR29AB3300 sighted — manual review required",
        "status": "OPEN",
        "created_at": ts_ago(hours=5),
    },
    {
        "anomaly_type": "EXTENDED_STAY",
        "severity": "MEDIUM",
        "plate_number": "KA51AA1234",
        "camera_id": "1",
        "description": "Vehicle KA51AA1234 has been parked for over 4 hours",
        "status": "ACKNOWLEDGED",
        "acknowledged_by": "admin",
        "acknowledged_at": ts_ago(hours=1),
        "created_at": ts_ago(hours=6),
    },
    {
        "anomaly_type": "RAPID_REENTRY",
        "severity": "HIGH",
        "plate_number": "MH12AB3456",
        "camera_id": "1",
        "description": "Vehicle MH12AB3456 re-entered within 3 minutes of previous exit",
        "status": "RESOLVED",
        "acknowledged_by": "admin",
        "acknowledged_at": ts_ago(days=1, hours=2),
        "created_at": ts_ago(days=1, hours=3),
    },
    {
        "anomaly_type": "CAPACITY_WARNING",
        "severity": "MEDIUM",
        "plate_number": None,
        "camera_id": None,
        "description": "Facility occupancy reached 85% capacity threshold",
        "status": "RESOLVED",
        "acknowledged_by": "operator",
        "acknowledged_at": ts_ago(days=2),
        "created_at": ts_ago(days=2, hours=1),
    },
    {
        "anomaly_type": "AFTER_HOURS_ENTRY",
        "severity": "HIGH",
        "plate_number": "RJ45GH2211",
        "camera_id": "2",
        "description": "Vehicle RJ45GH2211 entered at 02:34 — outside permitted hours",
        "status": "OPEN",
        "created_at": ts_ago(days=1, hours=18),
    },
    {
        "anomaly_type": "SUSPICIOUS_PATTERN",
        "severity": "MEDIUM",
        "plate_number": "UP14FN4661",
        "camera_id": "1",
        "description": "Vehicle UP14FN4661 detected 7 times in the last 24 hours",
        "status": "ACKNOWLEDGED",
        "acknowledged_by": "admin",
        "acknowledged_at": ts_ago(hours=3),
        "created_at": ts_ago(hours=8),
    },
    {
        "anomaly_type": "WATCHLIST_SIGHTING",
        "severity": "HIGH",
        "plate_number": "TN01AB6789",
        "camera_id": "2",
        "description": "Watchlisted vehicle TN01AB6789 detected — follow-up required",
        "status": "OPEN",
        "created_at": ts_ago(hours=12),
    },
]

for a in ANOMALIES:
    db.add(AnomalyEvent(
        anomaly_type=a["anomaly_type"],
        severity=a["severity"],
        plate_number=a.get("plate_number"),
        camera_id=a.get("camera_id"),
        description=a["description"],
        status=a["status"],
        acknowledged_by=a.get("acknowledged_by"),
        acknowledged_at=a.get("acknowledged_at"),
        created_at=a["created_at"],
    ))
    print(f"  [{a['severity']:8s}] {a['anomaly_type']}  ({a['status']})")

db.commit()
db.close()


# ── Summary ────────────────────────────────────────────────────

print(f"""
✓ Demo data seeded successfully!

  Vehicles (plates): {len(PLATES)}
  Detections:        {detections_created}
  Sessions:          {sessions_created}  ({len(active_plates)} currently active)
  Anomaly events:    {len(ANOMALIES)}  (CRITICAL: 1, HIGH: 4, MEDIUM: 3)

Next steps:
  venv/bin/python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
  cd smart-anpr-dashboard && npm run dev
  → Login: admin / Admin@1234
""")
