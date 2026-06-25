# Smart ANPR System

A full-stack **Automatic Number Plate Recognition (ANPR)** system built with FastAPI, React, and YOLOv8 + EasyOCR. Designed for real-time vehicle monitoring at entry/exit gates with anomaly detection, analytics, role-based access, and Docker-based deployment.

---

## Features

### Core Detection
- Real-time MJPEG camera stream processing with YOLOv8 plate detection
- EasyOCR-based plate text extraction with confidence scoring
- Per-detection plate crop snapshots (searchable gallery per plate)
- Camera roles: `entry`, `exit`, `smart` (single-gate auto entry/exit), `mixed`
- Session tracking — open on entry, close on matching exit detection

### Dashboard & Monitoring
- Live camera feed with WebSocket push (no polling)
- OCR confidence histogram per camera (5-bucket colour-coded bar chart)
- Camera health panel — FPS, detection count, reconnect status
- Session timeline view with dwell time
- Snapshot gallery — click any plate to browse all its captured crops

### Search & Registry
- Full-text search: plate fragment, camera, date range, event type
- Vehicle registry with owner details, watchlist toggle, and bulk actions
- Watchlist sighting alerts (anomaly engine integration)

### Anomaly Detection (9 types)
| Type | Description |
|------|-------------|
| PLATE_CLONING | Same plate at two cameras within threshold |
| TAILGATING | Two vehicles through gate in quick succession |
| QUICK_TURNAROUND | Exit shortly after entry |
| GHOST_EXIT | Exit with no matching entry |
| WRONG_DIRECTION | Entry camera sees exit or vice versa |
| BLACKLISTED | Blacklisted plate detected |
| WATCHLIST_SIGHTING | Watchlisted plate detected |
| HIGH_DWELL | Vehicle inside for unusually long time |
| UNKNOWN_VEHICLE | Plate not in registry |

Bulk acknowledge / resolve / false-positive from the UI.

### Analytics
- Hourly traffic heatmap (Recharts)
- Per-camera traffic breakdown chart
- Dwell time distribution
- Occupancy timeline

### Reports
- PDF traffic summary, anomaly log, session export
- XLSX session export
- Scheduled report delivery (admin-configurable)
- Vehicle owner personal monthly PDF via self-service portal

### Security & Access Control
- JWT authentication with token versioning (password change invalidates all sessions)
- 3-tier RBAC: `admin`, `operator`, `owner` (vehicle owner portal)
- Security headers: X-Frame-Options, X-Content-Type-Options, X-XSS-Protection
- Rate limiting on registration endpoint
- Full audit log: login, user management, camera events, watchlist changes

### Deployment
- Docker Compose stack: PostgreSQL 16 + FastAPI backend + nginx reverse proxy
- Alembic migrations run automatically on container start
- `pg_dump`-based backup endpoint (falls back to file copy for SQLite)
- SQLite still supported for local development

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, SQLAlchemy, Alembic |
| AI / CV | YOLOv8 (Ultralytics), EasyOCR |
| Database | PostgreSQL 16 (production), SQLite (dev) |
| Frontend | React 19, Vite, Recharts, WebSocket |
| Auth | JWT (python-jose), bcrypt |
| Reports | fpdf2, openpyxl |
| Deployment | Docker Compose, nginx |

---

## Project Structure

```
smart-anpr-system/
├── backend/app/
│   ├── main.py              # FastAPI app, startup, middleware
│   ├── ai_engine/           # YOLO + EasyOCR detection pipeline
│   ├── routes/              # Auth, cameras, detections, anomaly, reports, ...
│   ├── services/            # Session mgr, anomaly engine, report service
│   ├── models/              # SQLAlchemy ORM models
│   └── core/                # Config, security, dependencies
├── smart-anpr-dashboard/    # React + Vite frontend
│   └── src/pages/           # Dashboard, LiveMonitor, Search, Registry, ...
├── alembic/                 # DB migrations
├── scripts/entrypoint.sh    # Docker startup (waits for DB, runs migrations)
├── nginx/nginx.conf         # Reverse proxy config
├── docker-compose.yml
├── Dockerfile
├── setup_demo.py            # Seed 20 plates, 252 detections, 8 anomalies
└── requirements.txt
```

---

## Quick Start

### Option A — Local Development (SQLite, no Docker)

**Prerequisites:** Python 3.11+, Node.js 18+

```bash
# 1. Clone and set up Python env
git clone https://github.com/mandalsweta025-creator/smart-anpr-system.git
cd smart-anpr-system
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env — set SECRET_KEY to any long random string

# 3. Run backend
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload

# 4. In a second terminal — run frontend
cd smart-anpr-dashboard
npm install
npm run dev
```

App: http://localhost:5173  
API docs: http://localhost:8000/docs

**Seed demo data (optional):**
```bash
python setup_demo.py
```

---

### Option B — Docker Compose (PostgreSQL + nginx)

```bash
# 1. Set secrets
cp .env.example .env
# Edit .env — set SECRET_KEY and POSTGRES_PASSWORD

# 2. Build and start
docker compose up -d --build

# 3. Watch startup logs
docker compose logs -f anpr
```

App: http://localhost (nginx)  
API: http://localhost:8000 (direct)

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | JWT signing key — **change in production** | `change-me` |
| `DATABASE_URL` | SQLAlchemy DB URL | `sqlite:///./anpr.db` |
| `POSTGRES_PASSWORD` | PostgreSQL password (Docker only) | — |
| `ENVIRONMENT` | `development` or `production` | `development` |
| `SMTP_HOST` | Email alert server | — |
| `SMTP_PORT` | Email alert port | `587` |
| `ALERT_EMAIL` | Address to receive anomaly alerts | — |

---

## Default Login

After running `setup_demo.py` or first boot:

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Operator | `operator` | `operator123` |

> Change these immediately in a production deployment via Settings → User Management.

---

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Get JWT token |
| GET | `/cameras` | List cameras |
| POST | `/camera/{id}/start` | Start detection on camera |
| GET | `/detections` | Paginated detection history |
| GET | `/search` | Search by plate, camera, date range |
| GET | `/detections/{plate}/snapshots` | Plate crop gallery |
| GET | `/anomalies` | Anomaly list with filters |
| POST | `/anomalies/bulk-action` | Bulk ack/resolve/false-positive |
| GET | `/analytics/heatmap` | Hourly traffic heatmap data |
| GET | `/analytics/by-camera` | Per-camera breakdown |
| GET | `/reports/generate` | Generate PDF/XLSX report |
| GET | `/admin/backup` | Download DB backup |
| GET | `/audit` | Audit log (admin only) |

Full interactive docs at `/docs` (Swagger UI) when running locally.

---

## Camera Setup

1. Go to **Settings → Camera Management** → Add Camera
2. Enter RTSP URL (e.g. `rtsp://192.168.1.100:554/stream`) or `0` for webcam
3. Set role: `entry`, `exit`, or `smart` (single gate)
4. Go to **Live Monitor** → select camera → click **▶ START CAMERA**

For `smart` mode: first detection of a plate = ENTRY, second detection = EXIT. No separate entry/exit cameras needed.

---

## Anomaly Engine Configuration

Edit `backend/app/services/anomaly_engine.py` to tune thresholds:

```python
CLONING_GAP_SECS = 30        # Same plate at 2 cameras within 30s = suspicious
TAILGATING_GAP_SECS = 10     # Two vehicles within 10s = tailgating
QUICK_TURNAROUND_SECS = 120  # Exit within 2 min of entry = quick turnaround
ADJACENT_CAMERA_PAIRS = [    # Cameras in the same set never trigger cloning
    {"cam-entry-north", "cam-entry-south"},
]
```

---

## Screenshots

> Add screenshots here after running the app locally.
> Suggested shots: Dashboard, Live Monitor, Search results, Anomaly list, Analytics heatmap.

---

## Built With

- [Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics) — plate detection
- [EasyOCR](https://github.com/JaidedAI/EasyOCR) — text extraction
- [FastAPI](https://fastapi.tiangolo.com/) — backend framework
- [React](https://react.dev/) + [Recharts](https://recharts.org/) — frontend

---

## License

MIT License — free to use, modify, and distribute.
