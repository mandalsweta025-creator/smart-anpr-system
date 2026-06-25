import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { authFetch, API } from "../../store/dashboardStore";

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDuration(min) {
  if (!min) return "—";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function timeSince(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return fmtDate(iso);
}

function VehicleStatusCard({ v }) {
  return (
    <div className={`pvc-card${v.is_inside ? " pvc-inside" : " pvc-outside"}`}>
      <div className="pvc-plate">{v.plate_number}</div>
      {v.vehicle_type && <div className="pvc-type">{v.vehicle_type}</div>}
      <div className={`pvc-status-badge${v.is_inside ? " inside" : " outside"}`}>
        {v.is_inside ? "● INSIDE" : "○ OUTSIDE"}
      </div>
      {v.is_inside && v.entry_time && (
        <div className="pvc-since">
          Entered at <strong>{fmt(v.entry_time)}</strong>
        </div>
      )}
      {!v.is_inside && v.last_seen && (
        <div className="pvc-since">Last seen {timeSince(v.last_seen)}</div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color = "cyan" }) {
  return (
    <div className="portal-stat-card">
      <div className={`portal-stat-value color-${color}`}>{value}</div>
      <div className="portal-stat-label">{label}</div>
      {sub && <div className="portal-stat-sub">{sub}</div>}
    </div>
  );
}

function ActivityRow({ s }) {
  const statusColor = s.status === "ENTERED" ? "#00ff88" : "#00d4ff";
  return (
    <tr className="portal-table-row">
      <td className="portal-td">
        <span className="portal-plate-chip">{s.plate_number}</span>
      </td>
      <td className="portal-td">{fmtDate(s.entry_time)} {fmt(s.entry_time)}</td>
      <td className="portal-td">{s.exit_time ? `${fmtDate(s.exit_time)} ${fmt(s.exit_time)}` : "—"}</td>
      <td className="portal-td">{fmtDuration(s.duration_minutes)}</td>
      <td className="portal-td">
        <span style={{ color: statusColor, fontFamily: "var(--font-mono)", fontSize: 11 }}>
          {s.status}
        </span>
      </td>
    </tr>
  );
}

export default function UserDashboard() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/me/dashboard`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) return (
    <div className="portal-loading">
      <div className="portal-spinner"/>
      <div>Loading your dashboard…</div>
    </div>
  );

  if (error) return (
    <div className="portal-error">
      <div>⚠ {error}</div>
      <button className="portal-btn-outline" onClick={load}>Retry</button>
    </div>
  );

  const { username, vehicles = [], today_activity = [], recent_visits = [], stats = {} } = data;
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="portal-page">
      {/* ── Header ── */}
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">{greeting}, {username}</h1>
          <p className="portal-page-sub">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link to="/portal/vehicles" className="portal-btn-primary">+ Add Vehicle</Link>
          <button className="portal-btn-outline" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div className="portal-stats-row">
        <StatCard label="Vehicles Registered" value={vehicles.length} color="cyan" />
        <StatCard label="Active Inside"        value={stats.active_now ?? 0} color="green" />
        <StatCard label="Visits Today"         value={stats.total_visits_today ?? 0} color="amber" />
        <StatCard label="Visits This Week"     value={stats.total_visits_week ?? 0} color="purple" />
        <StatCard label="Visits This Month"    value={stats.total_visits_month ?? 0} color="cyan"
          sub={stats.total_duration_month_min > 0 ? `${fmtDuration(stats.total_duration_month_min)} parked` : null} />
      </div>

      {/* ── Vehicle Status Cards ── */}
      <section className="portal-section">
        <div className="portal-section-header">
          <h2 className="portal-section-title">My Vehicles</h2>
          <Link to="/portal/vehicles" className="portal-section-link">Manage →</Link>
        </div>
        {vehicles.length === 0 ? (
          <div className="portal-empty">
            <div className="portal-empty-icon">🚗</div>
            <div className="portal-empty-text">No vehicles registered yet</div>
            <Link to="/portal/vehicles" className="portal-btn-primary" style={{ marginTop: 12 }}>
              Register your first vehicle
            </Link>
          </div>
        ) : (
          <div className="pvc-grid">
            {vehicles.map(v => <VehicleStatusCard key={v.plate_number} v={v} />)}
          </div>
        )}
      </section>

      {/* ── Today's Activity ── */}
      <section className="portal-section">
        <div className="portal-section-header">
          <h2 className="portal-section-title">Today's Activity</h2>
          <Link to="/portal/activity" className="portal-section-link">Full history →</Link>
        </div>
        {today_activity.length === 0 ? (
          <div className="portal-empty-inline">No activity recorded today.</div>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th className="portal-th">Plate</th>
                  <th className="portal-th">Entry</th>
                  <th className="portal-th">Exit</th>
                  <th className="portal-th">Duration</th>
                  <th className="portal-th">Status</th>
                </tr>
              </thead>
              <tbody>
                {today_activity.map(s => <ActivityRow key={s.id} s={s} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent Visits ── */}
      <section className="portal-section">
        <div className="portal-section-header">
          <h2 className="portal-section-title">Recent Visits</h2>
          <Link to="/portal/activity" className="portal-section-link">View all →</Link>
        </div>
        {recent_visits.length === 0 ? (
          <div className="portal-empty-inline">No visit history yet.</div>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th className="portal-th">Plate</th>
                  <th className="portal-th">Entry</th>
                  <th className="portal-th">Exit</th>
                  <th className="portal-th">Duration</th>
                  <th className="portal-th">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent_visits.slice(0, 20).map(s => <ActivityRow key={s.id} s={s} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
