import { useState, useEffect, useCallback } from "react";
import { API, apiFetch, isAdmin } from "../store/dashboardStore";
import { useToast } from "../components/Toast";

// ── helpers ───────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}
function weekAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

const REPORT_TYPES = [
  { value: "traffic_summary", label: "Traffic Summary",   desc: "Detections, sessions, top plates, hourly chart" },
  { value: "anomaly_log",     label: "Anomaly Log",        desc: "Anomaly events by severity and type" },
  { value: "session_export",  label: "Session Export",     desc: "Full session list with entry/exit/duration" },
];

// ══════════════════════════════════════════════════════════════
//  ONE-OFF REPORT GENERATOR
// ══════════════════════════════════════════════════════════════

function GenerateSection() {
  const toast = useToast();
  const [type,   setType]   = useState("traffic_summary");
  const [fmt,    setFmt]    = useState("pdf");
  const [fromDt, setFrom]   = useState(weekAgo());
  const [toDt,   setTo]     = useState(today());
  const [busy,   setBusy]   = useState(false);

  async function handleGenerate() {
    setBusy(true);
    try {
      const res = await apiFetch(`${API}/reports/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          format: fmt,
          from_dt: `${fromDt}T00:00:00`,
          to_dt:   `${toDt}T23:59:59`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        toast.error(err.detail || "Report generation failed");
        return;
      }
      // Trigger download via blob
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const ext  = fmt;
      a.href     = url;
      a.download = `anpr_${type}_${fromDt}_${toDt}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Report downloaded!");
    } catch (e) {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 20, marginBottom: 24 }}>
      <div className="panel-title" style={{ marginBottom: 16 }}>GENERATE REPORT</div>

      {/* Report type */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>REPORT TYPE</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {REPORT_TYPES.map(rt => (
            <button key={rt.value} onClick={() => setType(rt.value)}
              style={{
                padding: "6px 14px",
                background: type === rt.value ? "var(--cyan)" : "var(--bg-void)",
                color: type === rt.value ? "#000" : "var(--text-primary)",
                border: `1px solid ${type === rt.value ? "var(--cyan)" : "var(--border-cyan)"}`,
                borderRadius: 3, cursor: "pointer", fontSize: 11,
                fontFamily: "var(--font-mono)", fontWeight: 700,
              }}>
              {rt.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 6 }}>
          {REPORT_TYPES.find(r => r.value === type)?.desc}
        </div>
      </div>

      {/* Date range + format */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>FROM</span>
          <input type="date" value={fromDt} onChange={e => setFrom(e.target.value)}
            style={{ background: "var(--bg-void)", color: "var(--text-primary)", border: "1px solid var(--border-cyan)", borderRadius: 3, padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 12 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>TO</span>
          <input type="date" value={toDt} onChange={e => setTo(e.target.value)}
            style={{ background: "var(--bg-void)", color: "var(--text-primary)", border: "1px solid var(--border-cyan)", borderRadius: 3, padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 12 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>FORMAT</span>
          <select value={fmt} onChange={e => setFmt(e.target.value)}
            style={{ background: "var(--bg-void)", color: "var(--text-primary)", border: "1px solid var(--border-cyan)", borderRadius: 3, padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            <option value="pdf">PDF</option>
            {type === "session_export" && <option value="xlsx">XLSX</option>}
          </select>
        </label>
        <button onClick={handleGenerate} disabled={busy}
          style={{
            padding: "8px 20px", background: busy ? "var(--bg-void)" : "var(--cyan)",
            color: busy ? "var(--text-muted)" : "#000",
            border: "1px solid var(--cyan)", borderRadius: 3, cursor: busy ? "default" : "pointer",
            fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12,
          }}>
          {busy ? "GENERATING…" : "GENERATE & DOWNLOAD"}
        </button>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════
//  SCHEDULED REPORTS  (admin only)
// ══════════════════════════════════════════════════════════════

function SchedulesSection() {
  const toast = useToast();
  const [schedules, setSchedules] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);

  // New schedule form
  const [name,     setName]     = useState("");
  const [rtype,    setRtype]    = useState("traffic_summary");
  const [rfmt,     setRfmt]     = useState("pdf");
  const [sched,    setSched]    = useState("daily");
  const [hour,     setHour]     = useState(8);
  const [recips,   setRecips]   = useState("");
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API}/reports/schedules`);
      if (res.ok) setSchedules(await res.json());
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`${API}/reports/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, report_type: rtype, format: rfmt, schedule: sched, hour: Number(hour), recipients: recips }),
      });
      if (res.ok) {
        toast.success("Schedule created");
        setShowForm(false);
        setName(""); setRecips("");
        load();
      } else {
        const err = await res.json().catch(() => ({ detail: "Error" }));
        toast.error(err.detail || "Failed to create");
      }
    } catch (_) { toast.error("Network error"); }
    setSaving(false);
  }

  async function handleDelete(id) {
    const res = await apiFetch(`${API}/reports/schedules/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Deleted"); load(); }
    else toast.error("Delete failed");
  }

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div className="panel-title">SCHEDULED REPORTS</div>
        <button onClick={() => setShowForm(s => !s)}
          style={{ padding: "5px 12px", background: "var(--bg-void)", color: "var(--cyan)", border: "1px solid var(--cyan)", borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
          {showForm ? "CANCEL" : "+ NEW SCHEDULE"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: "var(--bg-void)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 14, marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {[
            { label: "Name",      node: <input value={name}   onChange={e => setName(e.target.value)}   placeholder="Monthly Traffic" style={_inp} /> },
            { label: "Type",      node: <select value={rtype} onChange={e => setRtype(e.target.value)}  style={_inp}>{REPORT_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select> },
            { label: "Format",    node: <select value={rfmt}  onChange={e => setRfmt(e.target.value)}   style={_inp}><option value="pdf">PDF</option><option value="xlsx">XLSX</option></select> },
            { label: "Frequency", node: <select value={sched} onChange={e => setSched(e.target.value)}  style={_inp}><option value="daily">Daily</option><option value="weekly">Weekly</option></select> },
            { label: "Hour (UTC)",node: <input type="number" min={0} max={23} value={hour} onChange={e => setHour(e.target.value)} style={_inp} /> },
            { label: "Recipients (comma-sep emails)", node: <input value={recips} onChange={e => setRecips(e.target.value)} placeholder="ops@example.com" style={{ ..._inp, width: 220 }} /> },
          ].map(({ label, node }) => (
            <label key={label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{label.toUpperCase()}</span>
              {node}
            </label>
          ))}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={handleCreate} disabled={saving}
              style={{ padding: "7px 16px", background: "var(--cyan)", color: "#000", border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11 }}>
              {saving ? "SAVING…" : "CREATE"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading…</div>
      ) : schedules.length === 0 ? (
        <div className="empty-state">No scheduled reports configured yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-cyan)" }}>
              {["Name","Type","Format","Frequency","Hour","Recipients","Last Run","Active",""].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "5px 8px", fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => (
              <tr key={s.id} style={{ borderBottom: "1px solid rgba(0,212,255,0.08)" }}>
                <td style={_td}>{s.name}</td>
                <td style={_td}>{REPORT_TYPES.find(r => r.value === s.report_type)?.label ?? s.report_type}</td>
                <td style={_td}>{s.format.toUpperCase()}</td>
                <td style={_td}>{s.schedule}</td>
                <td style={_td}>{s.hour}:00 UTC</td>
                <td style={{ ..._td, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.recipients}>{s.recipients || "—"}</td>
                <td style={_td}>{s.last_run ? s.last_run.slice(0, 16) : "Never"}</td>
                <td style={_td}>
                  <span style={{ color: s.active ? "var(--green)" : "var(--text-muted)", fontSize: 10, fontWeight: 700 }}>
                    {s.active ? "YES" : "NO"}
                  </span>
                </td>
                <td style={_td}>
                  <button onClick={() => handleDelete(s.id)}
                    style={{ padding: "2px 8px", background: "transparent", color: "var(--red)", border: "1px solid var(--red)", borderRadius: 2, cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)" }}>
                    DEL
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const _inp = {
  background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-cyan)",
  borderRadius: 3, padding: "5px 8px", fontFamily: "var(--font-mono)", fontSize: 11, width: 140,
};
const _td  = { padding: "6px 8px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-primary)" };


// ══════════════════════════════════════════════════════════════
//  PAGE
// ══════════════════════════════════════════════════════════════

export default function Reports() {
  const admin = isAdmin();

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "var(--font-display)", color: "var(--cyan)", letterSpacing: 2 }}>
          📄 REPORTS
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
          Generate and download PDF / XLSX reports. Scheduled delivery requires admin privileges.
        </div>
      </div>

      <GenerateSection />

      {admin ? (
        <SchedulesSection />
      ) : (
        <div className="admin-only-notice" style={{ padding: 16, borderRadius: 4 }}>
          Scheduled report configuration is available to administrators only.
        </div>
      )}
    </div>
  );
}
