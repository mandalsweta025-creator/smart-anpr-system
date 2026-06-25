import { useState, useEffect, useRef } from "react";
import { API, authFetch } from "../store/dashboardStore";

// ── Health score ring ────────────────────────────────────────────
function HealthRing({ score }) {
  const col   = score >= 70 ? "var(--green)" : score >= 40 ? "var(--amber)" : "var(--red)";
  const r     = 20;
  const circ  = 2 * Math.PI * r;
  const dash  = (score / 100) * circ;
  return (
    <div className="ch-ring-wrap" title={`Health: ${score}/100`}>
      <svg width="52" height="52" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4"/>
        <circle cx="26" cy="26" r={r} fill="none" stroke={col} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 26 26)"
          style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1)" }}
        />
        <text x="26" y="30" textAnchor="middle"
          fontFamily="Orbitron,monospace" fontSize="10" fontWeight="700"
          fill={col}>{score}</text>
      </svg>
    </div>
  );
}

function GaugeBar({ value, max = 100, col = "cyan" }) {
  const pct = Math.min((value / Math.max(max, 1)) * 100, 100);
  return (
    <div className="ch-gauge">
      <div className="ch-gauge-fill" style={{ width: `${pct}%`, background: `var(--${col})` }} />
    </div>
  );
}

const ROLE_LABELS  = { entry: "ENTRY CAM", exit: "EXIT CAM", smart: "SMART ENTRY/EXIT", mixed: "LEGACY MIXED" };
const ROLE_COLS    = { entry: "green",     exit: "red",      smart: "cyan",              mixed: "amber"        };
const CONF_LABELS  = ["0.5–0.6", "0.6–0.7", "0.7–0.8", "0.8–0.9", "0.9+"];
const CONF_COLORS  = ["var(--red)", "var(--amber)", "#f59e0b", "var(--green)", "var(--cyan)"];

function ConfHistogram({ buckets }) {
  if (!buckets || buckets.every(v => v === 0)) {
    return (
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", padding: "6px 0" }}>
        No confirmed detections yet
      </div>
    );
  }
  const max = Math.max(...buckets, 1);
  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "flex-end", height: "48px", marginTop: "6px" }}>
      {buckets.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
          <div style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{v}</div>
          <div style={{
            width: "100%",
            height: `${Math.max(4, (v / max) * 32)}px`,
            background: CONF_COLORS[i],
            borderRadius: "2px 2px 0 0",
            opacity: v === 0 ? 0.2 : 0.85,
            transition: "height 0.4s ease",
          }} />
          <div style={{ fontSize: "8px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", textAlign: "center" }}>
            {CONF_LABELS[i]}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReconnectChip({ state }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const tick = () => setSecs(Math.max(0, Math.round(state.next_retry_ts - Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state.next_retry_ts]);

  return (
    <span style={{
      padding: "2px 7px", borderRadius: 3, fontSize: 9, fontFamily: "var(--font-mono)",
      fontWeight: 700, letterSpacing: "0.05em",
      background: "var(--amber-dim)", border: "1px solid var(--amber)", color: "var(--amber)",
      animation: "pulse-badge 2s infinite",
    }}>
      RECONNECTING {state.attempt}/{state.max_attempts} · {secs}s
    </span>
  );
}

function CameraCard({ id, stats: s, onAction }) {
  const accept    = 100 - (s.rejection_rate_pct ?? 0);
  const statusCol = s.health_score >= 70 ? "green" : s.health_score >= 40 ? "amber" : "red";
  const uptime    = s.uptime_seconds ?? 0;
  const uptimeStr = uptime < 60
    ? `${uptime}s`
    : uptime < 3600
    ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
    : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

  const lastDetAgo = s.last_detection_ago_s;
  const lastFrmAgo = s.last_frame_ago_s;

  const role    = s.camera_role || "mixed";
  const roleCol = ROLE_COLS[role] || "amber";

  const [actionMsg, setActionMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [roleVal, setRoleVal]  = useState(role);

  const doAction = async (path, method = "POST") => {
    try {
      const r = await authFetch(`${API}${path}`, { method });
      const d = await r.json();
      setActionMsg(d.success === false ? (d.error || "Failed") : "✓ Done");
    } catch (e) {
      setActionMsg("Error: " + e.message);
    }
    setTimeout(() => setActionMsg(""), 3000);
    onAction();
  };

  const testCamera = async () => {
    setTesting(true);
    setActionMsg("");
    try {
      const r  = await authFetch(`${API}/camera/${id}/test-once`);
      const d  = await r.json();
      setActionMsg(d.success ? `Plate: ${d.plate}` : `No plate: ${d.error || "empty"}`);
    } catch (e) {
      setActionMsg("Error: " + e.message);
    } finally {
      setTesting(false);
    }
  };

  const saveRole = async (newRole) => {
    setRoleVal(newRole);
    try {
      await authFetch(`${API}/camera/${id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      onAction();
    } catch {}
  };

  const statRows = [
    { k: "FRAMES TOTAL",    v: (s.frames_total ?? 0).toLocaleString(),     col: "text-secondary" },
    { k: "OCR RUNS",        v: (s.ocr_runs ?? 0).toLocaleString(),         col: "cyan"           },
    { k: "EASYOCR RUNS",    v: (s.easyocr_runs ?? 0).toLocaleString(),     col: "amber"          },
    { k: "VOTE CONFIRMED",  v: (s.vote_confirmed ?? 0).toLocaleString(),    col: "green"          },
    { k: "BYPASS CONFIRMED",v: (s.bypass_confirmed ?? 0).toLocaleString(),  col: "purple"         },
    { k: "DUP SUPPRESSED",  v: (s.duplicate_suppressed ?? 0).toLocaleString(), col: "red"        },
    { k: "RECONNECTS",      v: (s.reconnect_count ?? 0).toLocaleString(),   col: "amber"          },
    { k: "AVG LATENCY",     v: s.avg_latency_ms != null ? `${s.avg_latency_ms}ms` : "—", col: "amber" },
    { k: "P95 LATENCY",     v: s.p95_latency_ms != null ? `${s.p95_latency_ms}ms` : "—", col: "amber" },
    { k: "BLUR THRESHOLD",  v: s.blur_threshold != null ? s.blur_threshold.toFixed(1) : "—", col: "text-muted" },
  ];

  return (
    <div className="ch-card">
      {/* Header */}
      <div className="ch-card-header">
        <div className="ch-card-title">
          <span className="ch-cam-dot" style={{ background: `var(--${statusCol})`, boxShadow: `0 0 8px var(--${statusCol})` }} />
          CAM <span style={{ color: `var(--${statusCol})` }}>{id.toUpperCase()}</span>
          <span className="ch-role-badge" style={{ color: `var(--${roleCol})`, borderColor: `var(--${roleCol})` }}>
            {ROLE_LABELS[roleVal] || roleVal.toUpperCase()}
          </span>
          {s.reconnect_state && s.reconnect_state.attempt > 0 && (
            <ReconnectChip state={s.reconnect_state} />
          )}
        </div>
        <HealthRing score={s.health_score ?? 0} />
      </div>

      {/* Source */}
      {s.current_source && (
        <div className="ch-source">{s.current_source}</div>
      )}

      {/* Timestamp info */}
      <div className="ch-ts-row">
        <span className="ch-ts-item">
          <span className="ch-ts-k">UPTIME</span>
          <span className="ch-ts-v">{uptimeStr}</span>
        </span>
        <span className="ch-ts-item">
          <span className="ch-ts-k">LAST FRAME</span>
          <span className="ch-ts-v">{lastFrmAgo != null ? `${lastFrmAgo}s ago` : "—"}</span>
        </span>
        <span className="ch-ts-item">
          <span className="ch-ts-k">LAST DET</span>
          <span className="ch-ts-v">{lastDetAgo != null ? `${lastDetAgo}s ago` : "—"}</span>
        </span>
      </div>

      {/* Gauge bars */}
      <div className="ch-gauges">
        <div className="ch-gauge-row">
          <span className="ch-gauge-label">OCR FPS</span>
          <span className="ch-gauge-value" style={{ color: "var(--cyan)" }}>{s.ocr_fps ?? "—"}</span>
          <GaugeBar value={s.ocr_fps ?? 0} max={10} col="cyan" />
        </div>
        <div className="ch-gauge-row">
          <span className="ch-gauge-label">ACCEPT RATE</span>
          <span className="ch-gauge-value" style={{ color: `var(--${statusCol})` }}>{accept.toFixed(1)}%</span>
          <GaugeBar value={accept} max={100} col={statusCol} />
        </div>
        <div className="ch-gauge-row">
          <span className="ch-gauge-label">PLATES CONFIRMED</span>
          <span className="ch-gauge-value" style={{ color: "var(--purple)" }}>{s.plates_confirmed ?? 0}</span>
          <GaugeBar value={s.plates_confirmed ?? 0} max={Math.max(s.plates_confirmed ?? 1, 10)} col="purple" />
        </div>
      </div>

      {/* OCR Confidence Histogram */}
      <div style={{
        margin: "10px 0",
        padding: "10px",
        background: "rgba(0,0,0,0.2)",
        borderRadius: "4px",
        border: "1px solid rgba(0,212,255,0.1)",
      }}>
        <div style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: "0.08em", marginBottom: "4px" }}>
          OCR CONFIDENCE DISTRIBUTION
        </div>
        <ConfHistogram buckets={s.conf_buckets} />
      </div>

      {/* Stats grid */}
      <div className="ch-stats">
        {statRows.map(({ k, v, col }) => (
          <div key={k} className="ch-stat-row">
            <span className="ch-stat-k">{k}</span>
            <span className="ch-stat-v" style={{ color: `var(--${col})` }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Role selector */}
      <div className="ch-role-row">
        <span className="ch-stat-k">CAMERA ROLE</span>
        <div className="ch-role-btns" style={{ flexWrap: "wrap" }}>
          {[
            { key: "entry", label: "Entry" },
            { key: "exit",  label: "Exit"  },
            { key: "smart", label: "Smart Entry/Exit" },
            { key: "mixed", label: "Legacy Mixed" },
          ].map(({ key: r, label }) => (
            <button key={r}
              className={`ch-role-btn${roleVal === r ? " active" : ""}`}
              title={
                r === "entry" ? "All detections = ENTRY. Pair with an Exit camera." :
                r === "exit"  ? "All detections = EXIT. Pair with an Entry camera." :
                r === "smart" ? "First detection = ENTRY, second = EXIT. Single-gate mode." :
                "Legacy: entry-only with timeout-based exit (not recommended)."
              }
              style={roleVal === r ? {
                borderColor: `var(--${ROLE_COLS[r]})`,
                color: `var(--${ROLE_COLS[r]})`,
                background: `var(--${ROLE_COLS[r]}-dim)`,
              } : {}}
              onClick={() => saveRole(r)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="ch-actions">
        <button className="ch-btn ch-btn-green"
          onClick={() => doAction(`/camera/${id}/start`)}>
          ▶ START
        </button>
        <button className="ch-btn ch-btn-red"
          onClick={() => doAction(`/camera/${id}/stop`)}>
          ■ STOP
        </button>
        <button className="ch-btn ch-btn-cyan"
          onClick={testCamera}
          disabled={testing}>
          {testing ? "…" : "⊙ TEST"}
        </button>
      </div>

      {actionMsg && (
        <div className="ch-action-msg">{actionMsg}</div>
      )}
    </div>
  );
}

export default function CameraHealth() {
  const [metrics,     setMetrics]  = useState({});
  const [lastUpdated, setLast]     = useState(null);
  const [loading,     setLoading]  = useState(true);
  const [storage,     setStorage]  = useState(null);

  const load = () => {
    authFetch(`${API}/metrics`)
      .then(r => r.json())
      .then(d => { if (d && typeof d === "object") { setMetrics(d); setLast(new Date()); } setLoading(false); })
      .catch(() => setLoading(false));

    authFetch(`${API}/storage/stats`)
      .then(r => r.json())
      .then(d => setStorage(d))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, []);

  const cameras = Object.entries(metrics);
  const totalScore = cameras.length
    ? Math.round(cameras.reduce((s, [, m]) => s + (m.health_score ?? 0), 0) / cameras.length)
    : null;

  return (
    <div className="ch-root">
      <div className="ch-header">
        <div>
          <div className="ch-title">CAMERA HEALTH MONITOR</div>
          <div className="ch-sub">Real-time per-camera ANPR pipeline metrics · auto-refreshes every 5s</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
          {totalScore != null && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
                FLEET HEALTH
              </span>
              <HealthRing score={totalScore} />
            </div>
          )}
          <div className="ch-ts">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}</div>
        </div>
      </div>

      {/* Storage stats bar */}
      {storage && (
        <div className="ch-storage-bar">
          <span className="ch-storage-item">
            <span className="ch-storage-k">FILES</span>
            <span className="ch-storage-v">{storage.total_files.toLocaleString()}</span>
          </span>
          <span className="ch-storage-item">
            <span className="ch-storage-k">SIZE</span>
            <span className="ch-storage-v">{storage.total_size_mb} MB</span>
          </span>
          <span className="ch-storage-item">
            <span className="ch-storage-k">CAPACITY</span>
            <span className="ch-storage-v"
              style={{ color: storage.used_pct > 80 ? "var(--red)" : storage.used_pct > 60 ? "var(--amber)" : "var(--green)" }}>
              {storage.used_pct}%
            </span>
          </span>
          <span className="ch-storage-item">
            <span className="ch-storage-k">RETENTION</span>
            <span className="ch-storage-v">{storage.retention_days}d / {storage.max_size_mb} MB</span>
          </span>
        </div>
      )}

      {loading && <div className="ch-empty">Fetching metrics…</div>}
      {!loading && cameras.length === 0 && (
        <div className="ch-empty">No cameras running. Start a camera from the Settings page.</div>
      )}

      <div className="ch-grid">
        {cameras.map(([id, stats]) => (
          <CameraCard key={id} id={id} stats={stats} onAction={load} />
        ))}
      </div>
    </div>
  );
}
