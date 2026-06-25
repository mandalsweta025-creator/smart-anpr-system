import { useState, useEffect } from "react";
import { API, apiFetch, getSnapshotURL } from "../store/dashboardStore";

function fmtDT(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}
function fmtDur(min) {
  if (min == null) return "—";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const mono = (size = "11px", color = "var(--text-primary)") => ({
  fontFamily: "var(--font-mono)", fontSize: size, color,
});
const TAB = (active) => ({
  fontFamily: "var(--font-display)", fontSize: "11px",
  padding: "8px 18px",
  background: active ? "var(--cyan-dim)" : "transparent",
  border: "none",
  borderBottom: active ? "2px solid var(--cyan)" : "2px solid transparent",
  color: active ? "var(--cyan)" : "var(--text-muted)",
  cursor: "pointer", letterSpacing: "0.05em",
});

function EventBadge({ type }) {
  if (!type || type === "DETECTION") return null;
  const isEntry = type === "ENTRY";
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: "9px",
      padding: "2px 6px", borderRadius: "2px",
      background: isEntry ? "rgba(0,255,150,0.12)" : "rgba(0,200,255,0.12)",
      color: isEntry ? "var(--green)" : "var(--cyan)",
      border: `1px solid ${isEntry ? "var(--border-green)" : "var(--border-cyan)"}`,
      letterSpacing: "0.06em", whiteSpace: "nowrap",
    }}>
      {isEntry ? "▶ ENTRY" : "◀ EXIT"}
    </span>
  );
}

function CamChip({ id }) {
  if (!id) return null;
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: "9px",
      padding: "2px 6px", borderRadius: "2px",
      background: "rgba(180,120,255,0.10)",
      color: "var(--purple, #b478ff)",
      border: "1px solid rgba(180,120,255,0.25)",
      letterSpacing: "0.04em",
    }}>
      {id}
    </span>
  );
}

function DetectionRow({ d }) {
  const [imgFailed, setImgFailed] = useState(false);
  const snap = getSnapshotURL(d.image_path);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "76px 1fr auto",
      gap: "10px", alignItems: "center",
      padding: "8px 0", borderBottom: "1px solid rgba(0,200,255,0.08)",
    }}>
      {/* Snapshot */}
      <div style={{
        width: "76px", height: "38px", background: "rgba(0,0,0,0.4)",
        borderRadius: "2px", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--border-cyan)",
      }}>
        {snap && !imgFailed
          ? <img src={snap} alt="" onError={() => setImgFailed(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ fontSize: "20px" }}>🚗</span>}
      </div>

      {/* Time + badges */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={mono("11px")}>{fmtDT(d.timestamp)}</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <EventBadge type={d.event_type} />
          <CamChip id={d.camera_id} />
        </div>
      </div>

      {/* Confidence */}
      <div style={{
        fontFamily: "var(--font-display)", fontSize: "13px", textAlign: "right",
        color: d.confidence >= 0.8 ? "var(--green)" : d.confidence >= 0.6 ? "var(--amber)" : "var(--red)",
      }}>
        {Math.round(d.confidence * 100)}%
      </div>
    </div>
  );
}

function SessionRow({ s }) {
  const statusColor = s.status === "ENTERED" ? "var(--green)" : "var(--text-muted)";
  return (
    <div style={{
      padding: "10px 0", borderBottom: "1px solid rgba(0,200,255,0.08)",
    }}>
      {/* Entry / exit row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px 70px", gap: "10px", alignItems: "start" }}>
        <div>
          <div style={mono("11px")}>{fmtDT(s.entry_time)}</div>
          <div style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
            <span style={mono("9px", "var(--text-muted)")}>ENTERED</span>
            {s.camera_id && <CamChip id={s.camera_id} />}
          </div>
        </div>
        <div>
          <div style={mono("11px", "var(--text-muted)")}>{fmtDT(s.exit_time)}</div>
          <div style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
            <span style={mono("9px", "var(--text-muted)")}>EXITED</span>
            {s.exit_camera_id && <CamChip id={s.exit_camera_id} />}
          </div>
        </div>
        <div style={mono("12px", "var(--amber)")}>{fmtDur(s.duration_minutes)}</div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: "10px", textAlign: "right",
          color: statusColor, letterSpacing: "0.05em",
        }}>
          {s.status}
        </div>
      </div>
    </div>
  );
}

function AlertRow({ a }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "160px 80px 1fr",
      gap: "10px", alignItems: "center",
      padding: "8px 0", borderBottom: "1px solid rgba(255,60,60,0.10)",
    }}>
      <div style={mono("11px")}>{fmtDT(a.timestamp)}</div>
      <CamChip id={a.camera_id} />
      <div style={mono("11px", "var(--red, #ff4444)")}>{a.message}</div>
    </div>
  );
}

export default function PlateModal({ plate, onClose }) {
  const [tab, setTab] = useState("detections");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!plate) return;
    setLoading(true);
    setError(null);
    apiFetch(`${API}/vehicles/${encodeURIComponent(plate)}/timeline`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [plate]);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const detections = data?.detections ?? [];
  const sessions   = data?.sessions   ?? [];
  const alerts     = data?.alerts     ?? [];
  const hasAlerts  = alerts.length > 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-cyan)",
        borderRadius: "6px",
        width: "min(760px, 95vw)",
        maxHeight: "84vh",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: "12px",
          padding: "14px 18px", borderBottom: "1px solid var(--border-cyan)",
        }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--cyan)", letterSpacing: "0.15em" }}>
            {plate}
          </span>
          <span style={mono("10px", "var(--text-muted)")}>INVESTIGATION</span>
          <button onClick={onClose} style={{
            marginLeft: "auto", background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer", fontSize: "18px", lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Summary bar */}
        {data && (
          <div style={{
            display: "flex", gap: "20px", padding: "10px 18px",
            borderBottom: "1px solid rgba(0,200,255,0.08)",
            background: "rgba(0,200,255,0.03)",
            flexWrap: "wrap",
          }}>
            {[
              ["DETECTIONS", data.total_detections, "var(--cyan)"],
              ["SESSIONS",   data.total_sessions,   "var(--green)"],
              ["ALERTS",     data.total_alerts,      "var(--red)"],
            ].map(([label, val, color]) => (
              <div key={label} style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: "15px", color }}>{val}</span>
                <span style={mono("9px", "var(--text-muted)")}>{label}</span>
              </div>
            ))}
            {data.first_seen && (
              <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={mono("9px", "var(--text-muted)")}>FIRST SEEN</span>
                <span style={mono("10px")}>{fmtDT(data.first_seen)}</span>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-cyan)" }}>
          <button style={TAB(tab === "detections")} onClick={() => setTab("detections")}>
            DETECTIONS ({detections.length})
          </button>
          <button style={TAB(tab === "sessions")} onClick={() => setTab("sessions")}>
            SESSIONS ({sessions.length})
          </button>
          {hasAlerts && (
            <button style={{ ...TAB(tab === "alerts"), color: tab === "alerts" ? "var(--red)" : "var(--text-muted)" }} onClick={() => setTab("alerts")}>
              ALERTS ({alerts.length})
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
          {loading && <div style={mono("12px", "var(--text-muted)")}>Loading…</div>}
          {error   && <div style={mono("12px", "var(--red, #ff4444)")}>Error: {error}</div>}

          {!loading && !error && tab === "detections" && (
            detections.length === 0
              ? <div style={mono("12px", "var(--text-muted)")}>No detections recorded.</div>
              : detections.map((d) => <DetectionRow key={d.id} d={d} />)
          )}

          {!loading && !error && tab === "sessions" && (
            sessions.length === 0
              ? <div style={mono("12px", "var(--text-muted)")}>No sessions recorded.</div>
              : sessions.map((s) => <SessionRow key={s.id} s={s} />)
          )}

          {!loading && !error && tab === "alerts" && (
            alerts.length === 0
              ? <div style={mono("12px", "var(--text-muted)")}>No alerts recorded.</div>
              : alerts.map((a) => <AlertRow key={a.id} a={a} />)
          )}
        </div>
      </div>
    </div>
  );
}
