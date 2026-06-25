"""
One-shot script: reclassify live-camera false-positive anomalies to FALSE_POSITIVE.

Targets: PLATE_CLONING_SUSPICION, GHOST_EXIT, QUICK_TURNAROUND, TAILGATING_SUSPICION
created within the last 24 hours (IDs 9+ — the 8 intentional seeded anomalies are IDs 1-8).
"""
import sqlite3
from datetime import datetime, timedelta, timezone

FP_TYPES = {
    "PLATE_CLONING_SUSPICION",
    "GHOST_EXIT",
    "QUICK_TURNAROUND",
    "TAILGATING_SUSPICION",
}

DB_PATH = "anpr.db"
CUTOFF_HOURS = 24

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # DB stores local time with a space separator (not 'T'), so build the cutoff
    # string in the same format to avoid ASCII comparison pitfall (' ' < 'T').
    cutoff = datetime.now() - timedelta(hours=CUTOFF_HOURS)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    placeholders = ",".join("?" for _ in FP_TYPES)
    cur.execute(
        f"""
        SELECT id, anomaly_type, status, created_at
        FROM anomaly_events
        WHERE anomaly_type IN ({placeholders})
          AND created_at >= ?
        ORDER BY id
        """,
        (*FP_TYPES, cutoff_str),
    )
    rows = cur.fetchall()

    if not rows:
        print("No matching anomalies found — nothing to update.")
        conn.close()
        return

    print(f"Found {len(rows)} false-positive anomaly/ies to reclassify:\n")
    ids_to_update = []
    for r in rows:
        print(f"  ID {r['id']:>3}  {r['anomaly_type']:<30}  {r['status']:<15}  {r['created_at']}")
        ids_to_update.append(r["id"])

    now_str = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    cur.execute(
        f"""
        UPDATE anomaly_events
        SET status = 'FALSE_POSITIVE',
            acknowledged_by = 'system-cleanup',
            acknowledged_at = ?
        WHERE id IN ({','.join('?' for _ in ids_to_update)})
        """,
        (now_str, *ids_to_update),
    )
    conn.commit()
    updated = cur.rowcount
    print(f"\nUpdated {updated} record(s) → FALSE_POSITIVE")

    # Verify intentional seeded anomalies are untouched
    cur.execute(
        "SELECT id, anomaly_type, status FROM anomaly_events WHERE id <= 8 ORDER BY id"
    )
    seeded = cur.fetchall()
    print("\nSeeded anomalies (IDs 1–8) — must be unchanged:")
    all_ok = True
    for r in seeded:
        ok = r["status"] != "FALSE_POSITIVE" or r["anomaly_type"] not in FP_TYPES
        marker = "OK" if r["status"] != "FALSE_POSITIVE" else "WARN"
        print(f"  [{marker}] ID {r['id']}  {r['anomaly_type']:<30}  {r['status']}")
        if marker == "WARN":
            all_ok = False

    print()
    if all_ok:
        print("All seeded anomalies preserved correctly.")
    else:
        print("WARNING: some seeded anomalies were affected — check manually.")

    # Final count summary
    cur.execute(
        "SELECT status, COUNT(*) as cnt FROM anomaly_events GROUP BY status ORDER BY status"
    )
    print("\nFinal status breakdown:")
    for r in cur.fetchall():
        print(f"  {r['status']:<20} {r['cnt']}")

    conn.close()

if __name__ == "__main__":
    main()
