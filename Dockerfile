# ── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /build/dashboard
COPY smart-anpr-dashboard/package*.json ./
RUN npm ci --prefer-offline
COPY smart-anpr-dashboard/ ./
RUN npm run build


# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.11-slim

# OpenCV requires libGL + libglib; EasyOCR requires libgomp;
# postgresql-client provides pg_dump for the admin backup endpoint.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer-cached)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source + migration config
COPY backend/ ./backend/
COPY alembic/ ./alembic/
COPY alembic.ini ./

# Copy scripts (includes entrypoint.sh)
COPY scripts/ ./scripts/
RUN chmod +x ./scripts/entrypoint.sh

# Copy pre-built React assets into the location FastAPI's StaticFiles expects
COPY --from=frontend-build /build/dashboard/dist ./smart-anpr-dashboard/dist/

# Pre-create runtime directories (storage + model weights)
RUN mkdir -p storage/detections storage/exports storage/logs storage/backups \
             backend/models/weights \
             backend/app/configs

# ── Runtime environment ──────────────────────────────────────────────────────
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# entrypoint.sh: waits for PostgreSQL (if configured), runs alembic upgrade head, starts uvicorn
ENTRYPOINT ["./scripts/entrypoint.sh"]
