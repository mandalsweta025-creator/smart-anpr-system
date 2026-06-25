import { useState, useCallback, useEffect } from "react";
import { authFetch, API } from "../../store/dashboardStore";

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function fmtDuration(min) {
  if (min == null) return "—";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StatusBadge({ status }) {
  const isActive = status === "ENTERED";
  return (
    <span className={`portal-status-badge${isActive ? " badge-active" : " badge-exited"}`}>
      {isActive ? "● Inside" : "✓ Exited"}
    </span>
  );
}

export default function MyActivity() {
  const [sessions, setSessions] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selectedPlate, setSelectedPlate] = useState("");
  const [limit,  setLimit]  = useState(50);
  const [loading, setLoading] = useState(true);

  const loadVehicles = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/me/vehicles`);
      const data = await res.json();
      setVehicles(data);
    } catch {}
  }, []);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit });
      if (selectedPlate) params.set("plate", selectedPlate);
      const res = await authFetch(`${API}/me/sessions?${params}`);
      setSessions(await res.json());
    } finally {
      setLoading(false);
    }
  }, [selectedPlate, limit]);

  useEffect(() => { loadVehicles(); }, [loadVehicles]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  const totalDuration = sessions.reduce((s, r) => s + (r.duration_minutes || 0), 0);
  const insideCount   = sessions.filter(s => s.status === "ENTERED").length;
  const exitedCount   = sessions.filter(s => s.status === "EXITED").length;

  return (
    <div className="portal-page">
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">Activity History</h1>
          <p className="portal-page-sub">Entry and exit records for your registered vehicles</p>
        </div>
      </div>

      {/* ── Quick stats ── */}
      <div className="portal-stats-row" style={{ marginBottom: 20 }}>
        <div className="portal-stat-card">
          <div className="portal-stat-value color-cyan">{sessions.length}</div>
          <div className="portal-stat-label">Total Records</div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-value color-green">{insideCount}</div>
          <div className="portal-stat-label">Currently Inside</div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-value color-amber">{exitedCount}</div>
          <div className="portal-stat-label">Completed Visits</div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-value color-purple">{fmtDuration(totalDuration)}</div>
          <div className="portal-stat-label">Total Duration</div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="portal-filters">
        <div className="portal-filter-group">
          <label className="portal-filter-label">Filter by Vehicle</label>
          <select className="portal-filter-select" value={selectedPlate}
            onChange={e => setSelectedPlate(e.target.value)}>
            <option value="">All vehicles</option>
            {vehicles.map(v => (
              <option key={v.plate_number} value={v.plate_number}>{v.plate_number}</option>
            ))}
          </select>
        </div>
        <div className="portal-filter-group">
          <label className="portal-filter-label">Show last</label>
          <select className="portal-filter-select" value={limit}
            onChange={e => setLimit(Number(e.target.value))}>
            <option value={20}>20 records</option>
            <option value={50}>50 records</option>
            <option value={100}>100 records</option>
            <option value={200}>200 records</option>
          </select>
        </div>
        <button className="portal-btn-outline" onClick={loadSessions}>↻ Refresh</button>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="portal-loading"><div className="portal-spinner"/><div>Loading sessions…</div></div>
      ) : sessions.length === 0 ? (
        <div className="portal-empty-inline">No activity records found.</div>
      ) : (
        <div className="portal-table-wrap">
          <table className="portal-table">
            <thead>
              <tr>
                <th className="portal-th">Plate</th>
                <th className="portal-th">Entry Time</th>
                <th className="portal-th">Exit Time</th>
                <th className="portal-th">Duration</th>
                <th className="portal-th">Entry Camera</th>
                <th className="portal-th">Exit Camera</th>
                <th className="portal-th">Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.id} className="portal-table-row">
                  <td className="portal-td">
                    <span className="portal-plate-chip">{s.plate_number}</span>
                  </td>
                  <td className="portal-td">{fmt(s.entry_time)}</td>
                  <td className="portal-td">{fmt(s.exit_time)}</td>
                  <td className="portal-td">{fmtDuration(s.duration_minutes)}</td>
                  <td className="portal-td">
                    {s.camera_id
                      ? <span className="portal-cam-chip">▶ {s.camera_id}</span>
                      : "—"}
                  </td>
                  <td className="portal-td">
                    {s.exit_camera_id
                      ? <span className="portal-cam-chip exit">◀ {s.exit_camera_id}</span>
                      : "—"}
                  </td>
                  <td className="portal-td"><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
