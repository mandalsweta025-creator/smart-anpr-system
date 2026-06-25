import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch, getToken } from "../store/dashboardStore";
import { useToast } from "../components/Toast";
import { relTime, absTime } from "../utils/time";

// ── Severity config ──────────────────────────────────────────────────────────
const SEVERITY = {
  CRITICAL: { color: "var(--red)",    bg: "var(--red-dim)",       label: "CRITICAL" },
  HIGH:     { color: "var(--amber)",  bg: "var(--amber-dim)",     label: "HIGH"     },
  MEDIUM:   { color: "#f59e0b",       bg: "rgba(245,158,11,.12)", label: "MEDIUM"   },
  LOW:      { color: "var(--cyan)",   bg: "var(--cyan-dim)",      label: "LOW"      },
};

const TYPE_LABELS = {
  BLACKLIST_ENTRY_ATTEMPT: "Blacklist Attempt",
  PLATE_CLONING_SUSPICION: "Plate Cloning",
  GHOST_EXIT:              "Ghost Exit",
  DUPLICATE_ENTRY:         "Duplicate Entry",
  TAILGATING_SUSPICION:    "Tailgating",
  EXCESSIVE_DURATION:      "Excessive Duration",
  OVERNIGHT_STAY:          "Overnight Stay",
  REPEATED_ENTRIES:        "Repeated Entries",
  QUICK_TURNAROUND:        "Quick Turnaround",
  WATCHLIST_SIGHTING:      "Watchlist Sighting",
};

const STATUS_COLOR = {
  OPEN:           { color: "var(--red)",    label: "OPEN"    },
  ACKNOWLEDGED:   { color: "var(--amber)",  label: "ACK'D"   },
  RESOLVED:       { color: "var(--green)",  label: "RESOLVED" },
  FALSE_POSITIVE: { color: "var(--purple)", label: "FALSE +"  },
};

const API = import.meta.env.VITE_API_URL ?? "";

function SeverityBadge({ severity }) {
  const cfg = SEVERITY[severity] || SEVERITY.LOW;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 700, fontFamily: "var(--font-display)",
      letterSpacing: 1, color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}44`,
    }}>{cfg.label}</span>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_COLOR[status] || STATUS_COLOR.OPEN;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
      color: cfg.color, background: `${cfg.color}18`, border: `1px solid ${cfg.color}44`,
    }}>{cfg.label}</span>
  );
}

function StatCard({ value, label, color, pulsing }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: `1px solid ${color}44`,
      borderRadius: 8, padding: "16px 20px", minWidth: 130,
      position: "relative", overflow: "hidden",
    }}>
      {pulsing && value > 0 && (
        <div style={{
          position: "absolute", top: 8, right: 8,
          width: 8, height: 8, borderRadius: "50%",
          background: color, animation: "pulse-dot 2s infinite",
        }} />
      )}
      <div style={{ fontSize: 32, fontWeight: 900, fontFamily: "var(--font-display)", color, lineHeight: 1 }}>
        {value ?? "—"}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
    </div>
  );
}

function ActionBtn({ label, color, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "3px 10px", borderRadius: 4,
      border: `1px solid ${color}55`, background: `${color}12`,
      color, fontSize: 11, fontFamily: "var(--font-mono)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1, transition: "all .15s",
    }}>{label}</button>
  );
}

export default function Anomalies() {
  const { toastSuccess, toastError } = useToast();

  const [items,   setItems]   = useState([]);
  const [counts,  setCounts]  = useState({ total_open: 0, critical: 0, high: 0, medium: 0, low: 0 });
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [total,   setTotal]   = useState(0);

  // Filters
  const [severity,    setSeverity]    = useState("");
  const [filterStatus, setFilterStatus] = useState("OPEN");
  const [anomalyType, setAnomalyType] = useState("");
  const [plateFrag,   setPlateFrag]   = useState("");
  const [days,        setDays]        = useState(7);
  const [limit,       setLimit]       = useState(50);

  // Bulk selection
  const [selected, setSelected] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const dirtyRef = useRef(false);

  const fetchAnomalies = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ days, limit });
      if (severity)    params.set("severity",     severity);
      if (filterStatus) params.set("status",      filterStatus);
      if (anomalyType) params.set("anomaly_type", anomalyType);
      if (plateFrag)   params.set("plate",        plateFrag);

      const [listRes, countRes, statsRes] = await Promise.all([
        apiFetch(`${API}/anomalies?${params}`),
        apiFetch(`${API}/anomalies/count`),
        apiFetch(`${API}/anomalies/stats?days=${days}`),
      ]);

      if (listRes.ok) {
        const d = await listRes.json();
        setItems(d.items || []);
        setTotal(d.total || 0);
      }
      if (countRes.ok) setCounts(await countRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (e) {
      console.error("Anomalies fetch error", e);
    } finally {
      setLoading(false);
      dirtyRef.current = false;
    }
  }, [severity, filterStatus, anomalyType, plateFrag, days, limit]);

  useEffect(() => { fetchAnomalies(); }, [fetchAnomalies]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws?token=${token}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "anomaly") {
          dirtyRef.current = true;
          setTimeout(() => { if (dirtyRef.current) fetchAnomalies(); }, 800);
        }
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [fetchAnomalies]);

  // ── Single action ──────────────────────────────────────────────────────────
  const doAction = async (id, action) => {
    const res = await apiFetch(`${API}/anomalies/${id}/${action}`, { method: "PATCH" });
    if (res.ok) {
      toastSuccess(`Anomaly ${action.replace(/_/g, " ")} successfully`);
      fetchAnomalies();
    } else {
      toastError("Action failed");
    }
  };

  // ── Bulk FP by type ───────────────────────────────────────────────────────
  const [bulkFpType, setBulkFpType] = useState("");
  const [bulkFpLoading, setBulkFpLoading] = useState(false);

  const doBulkFpByType = async () => {
    if (!bulkFpType) return;
    const label = TYPE_LABELS[bulkFpType] || bulkFpType;
    if (!window.confirm(`Mark ALL "${label}" anomalies (last ${days} days) as FALSE POSITIVE?`)) return;
    setBulkFpLoading(true);
    try {
      const res = await apiFetch(`${API}/anomalies/bulk-fp-by-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anomaly_type: bulkFpType, days }),
      });
      if (res.ok) {
        const d = await res.json();
        toastSuccess(`${d.marked_fp} "${label}" anomalies marked as FALSE POSITIVE`);
        fetchAnomalies();
      } else {
        toastError("Bulk FP by type failed");
      }
    } catch {
      toastError("Network error");
    } finally {
      setBulkFpLoading(false);
    }
  };

  // ── Bulk action ────────────────────────────────────────────────────────────
  const doBulkAction = async (action) => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await apiFetch(`${API}/anomalies/bulk-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action }),
      });
      if (res.ok) {
        const d = await res.json();
        toastSuccess(`${d.succeeded} / ${d.processed} anomalies updated`);
        fetchAnomalies();
      } else {
        toastError("Bulk action failed");
      }
    } catch (e) {
      toastError("Network error");
    } finally {
      setBulkLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(i => i.id)));
    }
  };

  const fmtTime = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" });
  };

  const SEL = {
    background: "var(--bg-glass)", border: "1px solid var(--border-cyan)",
    color: "var(--text-primary)", borderRadius: 4, padding: "4px 8px", fontSize: 12,
  };

  return (
    <div style={{ padding: "24px", overflowY: "auto", height: "100%" }}>
      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(1.6)} }
        .anom-row:hover { background: rgba(0,212,255,.04) !important; }
        .anom-row td    { border-bottom: 1px solid rgba(0,212,255,.06); }
        .anom-row.selected-row { background: rgba(0,212,255,.06) !important; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--cyan)", letterSpacing: 2, margin: 0 }}>
            ANOMALY DETECTION
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            Behavioral anomalies detected by the ANPR engine — {total} record{total !== 1 ? "s" : ""} shown
          </p>
        </div>
        <button onClick={fetchAnomalies} style={{
          background: "var(--cyan-dim)", border: "1px solid var(--border-cyan)",
          color: "var(--cyan)", padding: "6px 14px", borderRadius: 4,
          fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
        }}>↺ REFRESH</button>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard value={counts.total_open}       label="Open"      color="var(--text-primary)" pulsing />
        <StatCard value={counts.critical}         label="Critical"  color="var(--red)"    pulsing />
        <StatCard value={counts.high}             label="High"      color="var(--amber)"  pulsing />
        <StatCard value={counts.medium}           label="Medium"    color="#f59e0b" />
        <StatCard value={counts.low}              label="Low"       color="var(--cyan)" />
        {stats && <>
          <StatCard value={stats.resolved}        label="Resolved"  color="var(--green)" />
          <StatCard value={stats.false_positives} label="False +"   color="var(--purple)" />
        </>}
      </div>

      {/* ── Anomaly type breakdown ───────────────────────────────────────────── */}
      {stats && Object.keys(stats.by_type).length > 0 && (
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border-cyan)",
          borderRadius: 8, padding: "14px 18px", marginBottom: 18,
        }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
            Anomaly Breakdown — last {days} days
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {Object.entries(stats.by_type).sort(([, a], [, b]) => b - a).map(([type, cnt]) => (
              <div key={type} style={{
                background: "var(--bg-glass)", border: "1px solid var(--border-cyan)",
                borderRadius: 4, padding: "4px 10px", fontSize: 12,
                display: "flex", gap: 8, alignItems: "center",
              }}>
                <span style={{ color: "var(--text-secondary)" }}>{TYPE_LABELS[type] || type}</span>
                <span style={{ color: "var(--cyan)", fontWeight: 700 }}>{cnt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16,
        background: "var(--bg-card)", border: "1px solid var(--border-cyan)",
        borderRadius: 8, padding: "12px 14px", alignItems: "center",
      }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, minWidth: 52 }}>
          Filters
        </span>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={SEL}>
          <option value="">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
          <option value="FALSE_POSITIVE">False Positive</option>
        </select>
        <select value={severity} onChange={e => setSeverity(e.target.value)} style={SEL}>
          <option value="">All Severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <select value={anomalyType} onChange={e => setAnomalyType(e.target.value)} style={SEL}>
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          value={plateFrag}
          onChange={e => setPlateFrag(e.target.value.toUpperCase())}
          placeholder="Plate…"
          style={{ ...SEL, width: 100, textTransform: "uppercase" }}
        />
        <select value={days} onChange={e => setDays(+e.target.value)} style={SEL}>
          <option value={1}>Today</option>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
        <select value={limit} onChange={e => setLimit(+e.target.value)} style={SEL}>
          <option value={25}>25 rows</option>
          <option value={50}>50 rows</option>
          <option value={100}>100 rows</option>
          <option value={200}>200 rows</option>
        </select>
      </div>

      {/* ── Bulk FP by type ─────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        background: "var(--bg-card)", border: "1px solid rgba(168,85,247,.25)",
        borderRadius: 8, padding: "10px 14px", marginBottom: 12,
      }}>
        <span style={{ fontSize: 11, color: "var(--purple)", textTransform: "uppercase", letterSpacing: 1, minWidth: 70 }}>
          Bulk FP
        </span>
        <select
          value={bulkFpType}
          onChange={e => setBulkFpType(e.target.value)}
          style={{ ...SEL, borderColor: "rgba(168,85,247,.4)" }}
        >
          <option value="">Select type…</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          onClick={doBulkFpByType}
          disabled={!bulkFpType || bulkFpLoading}
          style={{
            padding: "4px 14px", borderRadius: 4,
            border: "1px solid rgba(168,85,247,.5)", background: "rgba(168,85,247,.12)",
            color: "var(--purple)", fontSize: 12, fontFamily: "var(--font-mono)",
            cursor: !bulkFpType || bulkFpLoading ? "not-allowed" : "pointer",
            opacity: !bulkFpType || bulkFpLoading ? 0.4 : 1,
          }}
        >
          {bulkFpLoading ? "WORKING…" : "MARK ALL FP"}
        </button>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          — dismisses all anomalies of selected type within the active date window
        </span>
      </div>

      {/* ── Bulk action toolbar ──────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(0,212,255,.08)", border: "1px solid var(--border-cyan)",
          borderRadius: 6, padding: "8px 14px", marginBottom: 12,
        }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--cyan)" }}>
            {selected.size} selected
          </span>
          <ActionBtn label="ACK ALL"     color="var(--amber)"  disabled={bulkLoading} onClick={() => doBulkAction("acknowledge")} />
          <ActionBtn label="RESOLVE ALL" color="var(--green)"  disabled={bulkLoading} onClick={() => doBulkAction("resolve")} />
          <ActionBtn label="FALSE + ALL" color="var(--purple)" disabled={bulkLoading} onClick={() => doBulkAction("false_positive")} />
          <button onClick={() => setSelected(new Set())} style={{
            marginLeft: "auto", background: "transparent",
            border: "none", color: "var(--text-muted)",
            cursor: "pointer", fontSize: 13,
          }}>✕ Clear</button>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: "40px 0", textAlign: "center", fontFamily: "var(--font-mono)" }}>
          SCANNING…
        </div>
      ) : items.length === 0 ? (
        <div style={{
          color: "var(--green)", padding: "48px 0", textAlign: "center",
          fontFamily: "var(--font-mono)", fontSize: 13,
          border: "1px solid var(--border-green)", borderRadius: 8,
          background: "var(--green-dim)",
        }}>
          ✓ NO ANOMALIES MATCH CURRENT FILTERS
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(0,212,255,.06)" }}>
                {/* Select-all checkbox */}
                <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-cyan)", width: 32 }}>
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={toggleSelectAll}
                    style={{ cursor: "pointer", accentColor: "var(--cyan)" }}
                    title="Select all"
                  />
                </th>
                {["SEV", "TYPE", "PLATE", "CAMERA", "DESCRIPTION", "TIME", "STATUS", "ACTIONS"].map(h => (
                  <th key={h} style={{
                    padding: "8px 10px", textAlign: "left",
                    color: "var(--cyan)", fontSize: 10,
                    fontFamily: "var(--font-display)", letterSpacing: 1,
                    borderBottom: "1px solid var(--border-cyan)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(a => (
                <tr
                  key={a.id}
                  className={`anom-row${selected.has(a.id) ? " selected-row" : ""}`}
                  style={{ verticalAlign: "top" }}
                >
                  <td style={{ padding: "8px 10px" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      style={{ cursor: "pointer", accentColor: "var(--cyan)" }}
                    />
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <SeverityBadge severity={a.severity} />
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {TYPE_LABELS[a.anomaly_type] || a.anomaly_type}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {a.plate_number
                      ? <span style={{ color: "var(--amber)", fontWeight: 700 }}>{a.plate_number}</span>
                      : <span style={{ color: "var(--text-muted)" }}>—</span>}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>
                    {a.camera_id || "—"}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-primary)", maxWidth: 320 }}>
                    {a.description}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}
                      title={absTime(a.created_at)}>
                    {relTime(a.created_at)}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <StatusBadge status={a.status} />
                    {a.acknowledged_by && (
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        by {a.acknowledged_by}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <ActionBtn label="ACK"     color="var(--amber)"  disabled={a.status !== "OPEN"} onClick={() => doAction(a.id, "acknowledge")} />
                      <ActionBtn label="RESOLVE" color="var(--green)"  disabled={["RESOLVED","FALSE_POSITIVE"].includes(a.status)} onClick={() => doAction(a.id, "resolve")} />
                      <ActionBtn label="FP"      color="var(--purple)" disabled={a.status === "FALSE_POSITIVE"} onClick={() => doAction(a.id, "false_positive")} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
