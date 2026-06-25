#!/usr/bin/env bash
# entrypoint.sh — wait for PostgreSQL (if configured), migrate, then start uvicorn
set -euo pipefail

# ── Wait for PostgreSQL ───────────────────────────────────────────────────────
if echo "${DATABASE_URL:-}" | grep -q "postgresql"; then
    echo "[entrypoint] Waiting for PostgreSQL..."
    python3 - <<'PYEOF'
import os, time, socket, urllib.parse, sys

raw = os.environ["DATABASE_URL"].replace("postgresql+psycopg2://", "postgresql://")
parsed = urllib.parse.urlparse(raw)
host, port = parsed.hostname, parsed.port or 5432

for attempt in range(60):
    try:
        s = socket.create_connection((host, port), timeout=2)
        s.close()
        print(f"[entrypoint] PostgreSQL is ready at {host}:{port}")
        sys.exit(0)
    except OSError:
        print(f"[entrypoint] PostgreSQL not ready ({attempt+1}/60), retrying in 2s...")
        time.sleep(2)

print("[entrypoint] PostgreSQL did not become available — aborting.")
sys.exit(1)
PYEOF
fi

# ── Run Alembic migrations ────────────────────────────────────────────────────
echo "[entrypoint] Running database migrations..."
python -m alembic upgrade head

# ── Start application ─────────────────────────────────────────────────────────
echo "[entrypoint] Starting ANPR backend..."
exec python -m uvicorn backend.app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 1
