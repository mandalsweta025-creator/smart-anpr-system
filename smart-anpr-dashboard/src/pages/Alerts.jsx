import { useState, useEffect, useCallback, useRef } from "react";
import { API, apiFetch, useWebSocket } from "../store/dashboardStore";

function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "Z");
  return d.toLocaleString();
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const limitRef = useRef(100);

  const load = useCallback(async (limit = limitRef.current) => {
    try {
      const r = await apiFetch(`${API}/alerts?limit=${limit}`);
      setAlerts(await r.json());
    } catch {
      /* silent — no server yet */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Increment count and prepend new alert card on WS alert events
  useWebSocket((msg) => {
    if (msg.type === "alert") {
      const newAlert = {
        id: Date.now(),
        plate_number: msg.plate,
        message: msg.message || "BLACKLISTED VEHICLE DETECTED",
        camera_id: msg.camera_id || null,
        timestamp: msg.timestamp || new Date().toISOString(),
      };
      setAlerts((prev) => [newAlert, ...prev]);
    }
  });

  const loadMore = () => {
    limitRef.current += 100;
    load(limitRef.current);
  };

  const filtered = filter
    ? alerts.filter((a) => a.plate_number.toLowerCase().includes(filter.toLowerCase()))
    : alerts;

  return (
    <div style={{ padding: "16px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "14px", color: "var(--red)", letterSpacing: "0.1em" }}>
          ⛔ BLACKLIST ALERT HISTORY
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginLeft: "10px" }}>
            {alerts.length} record{alerts.length !== 1 ? "s" : ""} loaded
          </span>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by plate…"
          style={{
            background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-cyan)",
            color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "12px",
            padding: "5px 10px", borderRadius: "2px", outline: "none", width: "220px",
          }}
        />
      </div>

      {/* Table */}
      <div style={{ background: "var(--bg-card)", border: "1px solid rgba(255,50,50,0.35)", borderRadius: "4px", padding: "14px" }}>
        {loading && (
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
            No alert records found.
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid rgba(255,50,50,0.3)" }}>
                {["TIME", "PLATE", "MESSAGE", "CAMERA"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "5px 10px", fontWeight: "normal", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "7px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmt(a.timestamp)}</td>
                  <td style={{ padding: "7px 10px" }}>
                    <span style={{
                      fontFamily: "var(--font-display)", fontSize: "13px",
                      color: "var(--red)", letterSpacing: "0.05em",
                      background: "rgba(255,50,50,0.08)", padding: "2px 7px", borderRadius: "2px",
                    }}>
                      {a.plate_number}
                    </span>
                  </td>
                  <td style={{ padding: "7px 10px", color: "var(--amber)" }}>{a.message}</td>
                  <td style={{ padding: "7px 10px", color: "var(--text-muted)" }}>{a.camera_id || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Load more */}
      {!loading && alerts.length >= limitRef.current && (
        <button
          onClick={loadMore}
          className="cmd-btn"
          style={{
            alignSelf: "center", borderColor: "var(--border-cyan)",
            color: "var(--cyan)", background: "var(--cyan-dim)",
          }}
        >
          LOAD MORE
        </button>
      )}
    </div>
  );
}
