import { useState, useRef } from "react";
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

function PlateStatusCard({ p }) {
  return (
    <div className={`search-plate-card${p.is_inside ? " inside" : ""}`}>
      <div className="search-plate-num">{p.plate_number}</div>
      <div className={`pvc-status-badge${p.is_inside ? " inside" : " outside"}`} style={{ marginBottom: 12 }}>
        {p.is_inside ? "● INSIDE NOW" : "○ OUTSIDE"}
      </div>
      {p.is_inside && p.entry_time && (
        <div className="search-plate-meta">
          Entered at {new Date(p.entry_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
      <div className="search-plate-stats">
        <div className="search-plate-stat">
          <div className="search-plate-stat-val color-amber">{p.today_visits}</div>
          <div className="search-plate-stat-label">Today</div>
        </div>
        <div className="search-plate-stat">
          <div className="search-plate-stat-val color-cyan">{p.week_visits}</div>
          <div className="search-plate-stat-label">This Week</div>
        </div>
        <div className="search-plate-stat">
          <div className="search-plate-stat-val color-purple">{p.month_visits}</div>
          <div className="search-plate-stat-label">This Month</div>
        </div>
      </div>
    </div>
  );
}

export default function VehicleSearch() {
  const [query,    setQuery]   = useState("");
  const [result,   setResult]  = useState(null);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState("");
  const inputRef = useRef(null);

  const handleSearch = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setError("Enter at least 2 characters"); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await authFetch(`${API}/me/search?plate=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResult(null);
    setError("");
    inputRef.current?.focus();
  };

  return (
    <div className="portal-page">
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">Vehicle Search</h1>
          <p className="portal-page-sub">
            Search your registered vehicles — enter a plate number or partial match
          </p>
        </div>
      </div>

      {/* ── Search box ── */}
      <div className="search-box-wrap">
        <form className="search-form" onSubmit={handleSearch}>
          <div className="search-input-wrap">
            <span className="search-icon">🔍</span>
            <input
              ref={inputRef}
              className="search-input"
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              placeholder="e.g. MH20DV2363"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button type="button" className="search-clear" onClick={handleClear}>✕</button>
            )}
          </div>
          <button type="submit" className="portal-btn-primary search-submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {error && <div className="portal-error-inline" style={{ marginTop: 12 }}>⚠ {error}</div>}

        <p className="search-hint">
          Only shows results for vehicles registered to your account.
        </p>
      </div>

      {/* ── Results ── */}
      {result && (
        result.found ? (
          <div className="search-results">
            {/* Plate status cards */}
            <div className="search-plates-row">
              {result.plates.map(p => <PlateStatusCard key={p.plate_number} p={p} />)}
            </div>

            {/* Session history */}
            {result.sessions.length > 0 && (
              <section className="portal-section" style={{ marginTop: 24 }}>
                <div className="portal-section-header">
                  <h2 className="portal-section-title">Recent Sessions</h2>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    Last {result.sessions.length} records
                  </span>
                </div>
                <div className="portal-table-wrap">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th className="portal-th">Plate</th>
                        <th className="portal-th">Entry</th>
                        <th className="portal-th">Exit</th>
                        <th className="portal-th">Duration</th>
                        <th className="portal-th">Camera</th>
                        <th className="portal-th">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.sessions.map(s => (
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
                            <span className={`portal-status-badge ${s.status === "ENTERED" ? "badge-active" : "badge-exited"}`}>
                              {s.status === "ENTERED" ? "● Inside" : "✓ Exited"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="portal-empty" style={{ marginTop: 32 }}>
            <div className="portal-empty-icon">🔍</div>
            <div className="portal-empty-text">
              No vehicle matching <strong style={{ color: "var(--cyan)" }}>"{result.query}"</strong> found
            </div>
            <p className="portal-empty-hint">
              Only your registered vehicles are searchable. Register the vehicle first in My Vehicles.
            </p>
          </div>
        )
      )}

      {/* ── Initial state ── */}
      {!result && !loading && !error && (
        <div className="search-initial-hint">
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔎</div>
          <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: 14 }}>
            Enter a plate number above to see live status,<br/>
            today's activity, and visit history.
          </div>
        </div>
      )}
    </div>
  );
}
