import { useState, useCallback, useEffect, useRef } from "react";
import {
  useDetections, useWebSocket, useActiveSessions,
  getSnapshotURL, API, authFetch, playAlertBeep,
} from "../store/dashboardStore";
import PlateModal from "../components/PlateModal";

// ── Animated counter ────────────────────────────────────────────
function useAnimatedCounter(target) {
  const [display, setDisplay] = useState(target ?? 0);
  const ref = useRef(null);
  useEffect(() => {
    if (target == null) return;
    const from = display;
    const to   = typeof target === "number" ? target : 0;
    if (from === to) return;
    const duration = 600;
    const start = performance.now();
    cancelAnimationFrame(ref.current);
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * ease));
      if (t < 1) ref.current = requestAnimationFrame(step);
    }
    ref.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(ref.current);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  return display;
}

// ── Stat card ───────────────────────────────────────────────────
function StatCard({ label, value, col, sub, animate = false }) {
  const num    = typeof value === "number" ? value : null;
  const anim   = useAnimatedCounter(animate && num != null ? num : null);
  const shown  = animate && num != null ? anim : value;
  return (
    <div className="db-stat-card">
      <div className="db-stat-label">{label}</div>
      <div className="db-stat-value" style={{ color: `var(--${col})` }}>
        {shown ?? "…"}
      </div>
      {sub && <div className="db-stat-sub">{sub}</div>}
    </div>
  );
}

// ── Confidence bar ──────────────────────────────────────────────
function ConfidenceBar({ value }) {
  const pct = Math.round(value * 100);
  const cls = pct >= 80 ? "conf-high" : pct >= 60 ? "conf-med" : "conf-low";
  return (
    <div className="det-confidence">
      <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>{pct}%</div>
      <div className="conf-bar">
        <div className={`conf-fill ${cls}`} style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
}

// ── Detection card ──────────────────────────────────────────────
function EventBadge({ eventType }) {
  if (!eventType || eventType === "DETECTION") return null;
  const isEntry = eventType === "ENTRY";
  return (
    <span className={`ev-badge ${isEntry ? "ev-entry" : "ev-exit"}`}>
      {isEntry ? "▶ ENTRY" : "◀ EXIT"}
    </span>
  );
}

function DetCard({ det, isNew, onPlateClick }) {
  const ts = new Date(det.timestamp).toLocaleTimeString();
  const snap = getSnapshotURL(det.image_path);
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className={`det-card${isNew ? " new" : ""}`}>
      {isNew && <div className="det-shimmer"></div>}
      <div className="det-row1">
        <span
          className="det-plate"
          style={{ cursor: "pointer" }}
          onClick={() => onPlateClick(det.plate_number)}
          title="Click for full history"
        >
          {det.plate_number}
        </span>
        <ConfidenceBar value={det.confidence} />
      </div>
      <div className="det-row2">
        <div className="det-snap">
          {snap && !imgFailed
            ? <img src={snap} alt="plate" onError={() => setImgFailed(true)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: "18px" }}>🚗</span>}
        </div>
        <div className="det-info">
          <div className="det-meta">
            <span>🕐 {ts}</span>
            {det.camera_id && (
              <span style={{ color: "var(--text-muted)", fontSize: "9px" }}>
                {" "}· CAM {det.camera_id.toUpperCase()}
              </span>
            )}
          </div>
          <div className="det-tags">
            <span className="tag tag-ai">ANPR</span>
            {det.confidence >= 0.8 && <span className="tag tag-ok">VERIFIED</span>}
            {det.confidence < 0.6 && <span className="tag tag-warn">LOW CONF</span>}
            <EventBadge eventType={det.event_type} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 24-hour heatmap ─────────────────────────────────────────────
function DetectionHeatmap() {
  const [buckets, setBuckets] = useState([]);

  useEffect(() => {
    const load = () =>
      authFetch(`${API}/analytics/hourly?days=1`)
        .then(r => r.json())
        .then(data => {
          if (!Array.isArray(data)) return;
          // Build a full 24-slot array indexed 0-23
          const map = Object.fromEntries(data.map(d => [d.hour, d.count]));
          const now = new Date();
          const slots = Array.from({ length: 24 }, (_, i) => {
            const h = (now.getHours() - 23 + i + 24) % 24;
            return { h, count: map[h] ?? 0 };
          });
          setBuckets(slots);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const total    = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div className="db-heatmap">
      <div className="db-section-title">
        24-HOUR DETECTION ACTIVITY
        <span className="db-section-badge">{total} TODAY</span>
      </div>
      <div className="db-heatmap-bars">
        {buckets.map(({ h, count }) => {
          const pct  = (count / maxCount) * 100;
          const now  = new Date().getHours();
          const isNow = h === now;
          return (
            <div key={h} className="db-hbar-wrap" title={`${h}:00 — ${count} detections`}>
              <div className="db-hbar-track">
                <div
                  className={`db-hbar-fill${isNow ? " now" : ""}`}
                  style={{ height: `${Math.max(pct, 2)}%` }}
                />
              </div>
              {h % 6 === 0 && (
                <div className="db-hbar-label">{String(h).padStart(2, "0")}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Camera health cards ─────────────────────────────────────────
function CameraHealthPanel() {
  const [metrics, setMetrics] = useState({});

  useEffect(() => {
    const load = () =>
      authFetch(`${API}/metrics`)
        .then(r => r.json())
        .then(d => { if (d && typeof d === "object") setMetrics(d); })
        .catch(() => {});
    load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, []);

  const cameras = Object.entries(metrics);

  if (cameras.length === 0) {
    return (
      <div className="db-cam-panel">
        <div className="db-section-title">CAMERA HEALTH</div>
        <div className="db-cam-empty">No cameras running</div>
      </div>
    );
  }

  return (
    <div className="db-cam-panel">
      <div className="db-section-title">CAMERA HEALTH</div>
      <div className="db-cam-grid">
        {cameras.map(([id, s]) => {
          const accept = 100 - (s.rejection_rate_pct ?? 0);
          const statusCol = accept >= 70 ? "green" : accept >= 40 ? "amber" : "red";
          const uptime  = s.uptime_seconds ?? 0;
          const uptimeStr = uptime < 60
            ? `${uptime}s`
            : uptime < 3600
            ? `${Math.floor(uptime / 60)}m`
            : `${(uptime / 3600).toFixed(1)}h`;

          return (
            <div key={id} className="db-cam-card">
              <div className="db-cam-header">
                <span className="db-cam-id">CAM {id.toUpperCase()}</span>
                <span className={`db-cam-dot`} style={{ background: `var(--${statusCol})`, boxShadow: `0 0 6px var(--${statusCol})` }} />
              </div>
              <div className="db-cam-row">
                <span className="db-cam-k">FPS</span>
                <span className="db-cam-v" style={{ color: "var(--cyan)" }}>
                  {s.ocr_fps ?? "—"}
                </span>
              </div>
              <div className="db-cam-row">
                <span className="db-cam-k">ACCEPT</span>
                <span className="db-cam-v" style={{ color: `var(--${statusCol})` }}>
                  {accept.toFixed(0)}%
                </span>
              </div>
              <div className="db-cam-row">
                <span className="db-cam-k">CONFIRMED</span>
                <span className="db-cam-v" style={{ color: "var(--purple)" }}>
                  {s.plates_confirmed ?? 0}
                </span>
              </div>
              <div className="db-cam-row">
                <span className="db-cam-k">UPTIME</span>
                <span className="db-cam-v" style={{ color: "var(--text-secondary)" }}>
                  {uptimeStr}
                </span>
              </div>
              {s.avg_latency_ms != null && (
                <div className="db-cam-row">
                  <span className="db-cam-k">AVG LAT</span>
                  <span className="db-cam-v" style={{ color: "var(--amber)" }}>
                    {s.avg_latency_ms}ms
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Occupancy Gauge ─────────────────────────────────────────────
function OccupancyGauge() {
  const [occ, setOcc] = useState(null);

  useEffect(() => {
    const load = () =>
      authFetch(`${API}/analytics/occupancy`)
        .then(r => r.json())
        .then(d => setOcc(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  if (!occ) return null;
  const pct      = occ.percent ?? 0;
  const statusC  = occ.status === "critical" ? "var(--red)" : occ.status === "warning" ? "var(--amber)" : "var(--green)";
  const arcAngle = Math.min((pct / 100) * 180, 180);  // 0..180 deg sweep

  // SVG arc helper
  const polarToXY = (deg, r) => {
    const rad = (deg - 180) * (Math.PI / 180);
    return { x: 60 + r * Math.cos(rad), y: 60 + r * Math.sin(rad) };
  };
  const start = polarToXY(0, 44);
  const end   = polarToXY(arcAngle, 44);
  const large = arcAngle > 90 ? 1 : 0;

  return (
    <div style={{
      background: "var(--bg-card)", border: `1px solid ${statusC}44`,
      borderRadius: 6, padding: "12px 16px",
      display: "flex", alignItems: "center", gap: 16,
      minWidth: 200,
    }}>
      <svg width="80" height="50" viewBox="0 0 120 70">
        {/* Track */}
        <path d="M16,60 A44,44 0 0,1 104,60" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" strokeLinecap="round" />
        {/* Fill */}
        {pct > 0 && (
          <path
            d={`M16,60 A44,44 0 0,1 ${end.x},${end.y}`}
            fill="none" stroke={statusC} strokeWidth="10" strokeLinecap="round"
          />
        )}
        <text x="60" y="62" textAnchor="middle" fontSize="14" fontWeight="900"
              fontFamily="var(--font-display)" fill={statusC}>
          {pct != null ? `${Math.round(pct)}%` : "—"}
        </text>
      </svg>
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 10, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase" }}>
          OCCUPANCY
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, color: statusC, fontWeight: 900, lineHeight: 1.2 }}>
          {occ.current}
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
            / {occ.max_capacity}
          </span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
          {occ.status === "critical" ? "⚠ NEAR CAPACITY" : occ.status === "warning" ? "● HIGH" : "● NORMAL"}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ──────────────────────────────────────────────
export default function Dashboard() {
  const { detections, loading, error } = useDetections(30);
  const sessions = useActiveSessions();
  const [liveList, setLiveList]       = useState([]);
  const [wsCount,  setWsCount]        = useState(0);
  const [alertBanner, setAlertBanner] = useState(null);
  const [totalCount, setTotalCount]   = useState(null);
  const [todayCount, setTodayCount]   = useState(null);
  const [modalPlate, setModalPlate]   = useState(null);

  const [flowData, setFlowData] = useState(null);

  useEffect(() => {
    const load = () =>
      authFetch(`${API}/analytics/flow`)
        .then(r => r.json())
        .then(d => setFlowData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const animTotal   = useAnimatedCounter(totalCount);
  const animToday   = useAnimatedCounter(todayCount);
  const animActive  = useAnimatedCounter(sessions.active_count ?? 0);
  const animEntries = useAnimatedCounter(flowData?.entries_today ?? 0);
  const animExits   = useAnimatedCounter(flowData?.exits_today   ?? 0);

  useEffect(() => {
    const load = () =>
      authFetch(`${API}/detections/count`)
        .then(r => r.json())
        .then(d => setTotalCount(d.count))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = () =>
      authFetch(`${API}/analytics/hourly?days=1`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data))
            setTodayCount(data.reduce((sum, h) => sum + (h.count || 0), 0));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const handleLive = useCallback((msg) => {
    if (msg.type === "alert") {
      setAlertBanner(msg);
      playAlertBeep();
      setTimeout(() => setAlertBanner(null), 6000);
      return;
    }
    setWsCount(n => n + 1);
    setTotalCount(n => (n != null ? n + 1 : null));
    setTodayCount(n => (n != null ? n + 1 : null));
    setLiveList(prev =>
      [{ ...msg, id: Date.now(), plate_number: msg.plate }, ...prev].slice(0, 10)
    );
  }, []);

  const { connected } = useWebSocket(handleLive);

  // Normalize to seconds (first 19 chars) so WS ISO timestamp and DB timestamp
  // format both compare equal: "2026-06-02T10:23:55+00:00" vs "2026-06-02T10:23:55"
  const _tsKey = (d) => d.plate_number + (d.timestamp || '').slice(0, 19);
  const liveIds = new Set(liveList.map(_tsKey));
  const allDetections = [
    ...liveList.map(d => ({ ...d, _live: true })),
    ...detections.filter(d => !liveIds.has(_tsKey(d))),
  ].slice(0, 30);

  const avgConf = detections.length
    ? (detections.reduce((a, d) => a + d.confidence, 0) / detections.length * 100).toFixed(1)
    : null;

  return (
    <div className="db-root">

      {/* ── ALERT BANNER ── */}
      {alertBanner && (
        <div className="db-alert-banner">
          <span className="db-alert-icon">⚠</span>
          <span className="db-alert-text">
            {alertBanner.message} — <strong>{alertBanner.plate}</strong>
          </span>
          <button className="db-alert-close" onClick={() => setAlertBanner(null)}>✕</button>
        </div>
      )}

      {/* ── STAT CARDS ── */}
      <div className="db-stats-row">
        <StatCard label="TOTAL DETECTIONS" value={animTotal}   col="cyan"   animate />
        <StatCard label="TODAY"            value={animToday}   col="green"  animate />
        <StatCard label="ACTIVE VEHICLES"  value={animActive}  col="amber"  animate />
        <StatCard label="ENTRIES TODAY"    value={animEntries} col="green"  animate />
        <StatCard label="EXITS TODAY"      value={animExits}   col="red"    animate />
        <StatCard label="LIVE UPDATES"     value={wsCount}     col="purple" animate />
        <StatCard
          label="AVG CONFIDENCE"
          value={avgConf != null ? `${avgConf}%` : "—"}
          col="cyan"
        />
        {flowData?.avg_dwell_minutes != null && (
          <StatCard
            label="AVG DWELL"
            value={`${flowData.avg_dwell_minutes}m`}
            col="amber"
          />
        )}
        <OccupancyGauge />
      </div>

      {/* ── WS STATUS BAR ── */}
      <div className="db-ws-bar">
        <span className="db-ws-dot" style={{ background: connected ? "var(--green)" : "var(--red)" }} />
        <span className="db-ws-label">
          WEBSOCKET: {connected ? "CONNECTED" : "RECONNECTING…"}
        </span>
        {error && <span className="db-ws-error">⚠ {error}</span>}
      </div>

      {/* ── MIDDLE ROW: heatmap + camera health ── */}
      <div className="db-middle-row">
        <DetectionHeatmap />
        <CameraHealthPanel />
      </div>

      {/* ── DETECTION GRID ── */}
      <div className="db-detections">
        <div className="db-section-title">
          LIVE DETECTIONS
          {liveList.length > 0 && <span className="db-section-badge">{liveList.length} NEW</span>}
        </div>
        {loading ? (
          <div className="db-empty">Loading detections…</div>
        ) : (
          <div className="db-det-grid">
            {allDetections.map((det, i) => (
              <DetCard key={det.id ?? i} det={det} isNew={det._live} onPlateClick={setModalPlate} />
            ))}
            {allDetections.length === 0 && (
              <div className="db-empty">No detections yet. Start the backend and a camera.</div>
            )}
          </div>
        )}
      </div>

      {modalPlate && <PlateModal plate={modalPlate} onClose={() => setModalPlate(null)} />}
    </div>
  );
}
