import { useState, useCallback } from "react";
import { API, apiFetch, getSnapshotURL } from "../store/dashboardStore";
import { useToast } from "../components/Toast";
import { relTime, absTime } from "../utils/time";

const SEL = {
  background: "var(--bg-glass)",
  border: "1px solid var(--border-cyan)",
  color: "var(--text-primary)",
  borderRadius: "4px",
  padding: "6px 10px",
  fontSize: "12px",
  fontFamily: "var(--font-mono)",
  outline: "none",
};

const INPUT = {
  ...SEL,
  background: "rgba(0,0,0,0.3)",
};

const EVENT_COLORS = {
  ENTRY:     "var(--green)",
  EXIT:      "var(--red)",
  DETECTION: "var(--cyan)",
};

function SnapThumb({ path }) {
  if (!path) {
    return (
      <div style={{
        width: 56, height: 32, borderRadius: 3,
        background: "rgba(0,0,0,0.4)", border: "1px solid var(--border-cyan)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
      }}>
        —
      </div>
    );
  }
  return (
    <img
      src={getSnapshotURL(path)}
      alt="plate"
      style={{
        width: 56, height: 32, objectFit: "cover",
        borderRadius: 3, border: "1px solid var(--border-cyan)",
        cursor: "pointer",
      }}
      onError={e => { e.target.style.display = "none"; }}
    />
  );
}

export default function Search() {
  const { toastError } = useToast();

  const [plate,   setPlate]   = useState("");
  const [camera,  setCamera]  = useState("");
  const [fromDt,  setFromDt]  = useState("");
  const [toDt,    setToDt]    = useState("");
  const [days,    setDays]    = useState("");
  const [limit,   setLimit]   = useState(50);

  const [results, setResults] = useState(null);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async (offsetVal = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: offsetVal });
      if (plate.trim())  params.set("plate",  plate.trim().toUpperCase());
      if (camera.trim()) params.set("camera", camera.trim());
      if (days)          params.set("days",   days);
      else {
        if (fromDt) params.set("from", fromDt);
        if (toDt)   params.set("to",   toDt);
      }

      const res = await apiFetch(`${API}/search?${params}`);
      if (!res.ok) { toastError("Search failed"); return; }
      const data = await res.json();
      setResults(data.results || []);
      setTotal(data.total || 0);
      setSearched(true);
    } catch (e) {
      toastError("Search error: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [plate, camera, fromDt, toDt, days, limit, toastError]);

  const fmtTime = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" });
  };

  const canSearch = plate.trim() || camera.trim() || fromDt || toDt || days;

  return (
    <div style={{ padding: "24px", overflowY: "auto", height: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--cyan)", letterSpacing: 2, margin: 0 }}>
          ADVANCED SEARCH
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4, fontFamily: "var(--font-mono)" }}>
          Search detections by partial plate, camera, or date range
        </p>
      </div>

      {/* Search form */}
      <div style={{
        background: "var(--bg-card)", border: "1px solid var(--border-cyan)",
        borderRadius: 8, padding: "18px 20px", marginBottom: 20,
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: 1 }}>PLATE FRAGMENT</label>
            <input
              value={plate}
              onChange={e => setPlate(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && canSearch && runSearch()}
              placeholder="e.g. MH20 or AB1234"
              style={{ ...INPUT, textTransform: "uppercase" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: 1 }}>CAMERA ID</label>
            <input
              value={camera}
              onChange={e => setCamera(e.target.value)}
              onKeyDown={e => e.key === "Enter" && canSearch && runSearch()}
              placeholder="e.g. 1 or service"
              style={INPUT}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: 1 }}>FROM DATE</label>
            <input
              type="datetime-local"
              value={fromDt}
              onChange={e => { setFromDt(e.target.value); setDays(""); }}
              style={{ ...INPUT, colorScheme: "dark" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: 1 }}>TO DATE</label>
            <input
              type="datetime-local"
              value={toDt}
              onChange={e => { setToDt(e.target.value); setDays(""); }}
              style={{ ...INPUT, colorScheme: "dark" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: 1 }}>QUICK RANGE</label>
            <select
              value={days}
              onChange={e => { setDays(e.target.value); if (e.target.value) { setFromDt(""); setToDt(""); } }}
              style={SEL}
            >
              <option value="">Custom date range</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: 1 }}>LIMIT</label>
            <select value={limit} onChange={e => setLimit(+e.target.value)} style={SEL}>
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
              <option value={200}>200 rows</option>
            </select>
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
            <button
              onClick={() => runSearch()}
              disabled={!canSearch || loading}
              style={{
                background: canSearch && !loading ? "var(--cyan-dim)" : "rgba(0,0,0,0.2)",
                border: "1px solid var(--border-cyan)",
                color: canSearch && !loading ? "var(--cyan)" : "var(--text-muted)",
                padding: "6px 20px", borderRadius: 4,
                fontSize: 12, fontFamily: "var(--font-mono)",
                cursor: canSearch && !loading ? "pointer" : "not-allowed",
                letterSpacing: 1,
              }}
            >
              {loading ? "SEARCHING…" : "🔍 SEARCH"}
            </button>
            <button
              onClick={() => { setPlate(""); setCamera(""); setFromDt(""); setToDt(""); setDays(""); setResults(null); setSearched(false); }}
              style={{
                background: "transparent", border: "1px solid var(--border-cyan)",
                color: "var(--text-muted)", padding: "6px 14px", borderRadius: 4,
                fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer",
              }}
            >
              CLEAR
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {!searched && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">ENTER SEARCH CRITERIA</div>
          <div>Use plate fragment, camera, or date range to find detections</div>
        </div>
      )}

      {searched && results !== null && (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 12,
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)" }}>
              {total} result{total !== 1 ? "s" : ""} found
              {total > limit && ` — showing first ${limit}`}
            </span>
            {total === 0 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                Try a different plate fragment or date range
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <div style={{
              padding: "40px 0", textAlign: "center",
              fontFamily: "var(--font-mono)", fontSize: 12,
              color: "var(--text-muted)",
              border: "1px solid var(--border-cyan)", borderRadius: 8,
            }}>
              No detections match your search
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(0,212,255,.06)" }}>
                    {["SNAP", "PLATE", "CAMERA", "EVENT", "CONFIDENCE", "TIMESTAMP"].map(h => (
                      <th key={h} style={{
                        padding: "8px 12px", textAlign: "left",
                        color: "var(--cyan)", fontSize: 10,
                        fontFamily: "var(--font-display)", letterSpacing: 1,
                        borderBottom: "1px solid var(--border-cyan)", whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id} style={{ borderBottom: "1px solid rgba(0,212,255,.06)" }}
                      className="anom-row">
                      <td style={{ padding: "6px 12px" }}>
                        <SnapThumb path={r.image_path} />
                      </td>
                      <td style={{ padding: "6px 12px" }}>
                        <span style={{
                          fontFamily: "var(--font-display)", fontSize: 13,
                          color: "var(--amber)", fontWeight: 700, letterSpacing: 1,
                        }}>
                          {r.plate_number}
                        </span>
                      </td>
                      <td style={{ padding: "6px 12px", color: "var(--text-muted)" }}>
                        {r.camera_id || "—"}
                      </td>
                      <td style={{ padding: "6px 12px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                          color: EVENT_COLORS[r.event_type] || "var(--cyan)",
                          background: `${EVENT_COLORS[r.event_type] || "var(--cyan)"}18`,
                          border: `1px solid ${EVENT_COLORS[r.event_type] || "var(--cyan)"}44`,
                        }}>
                          {r.event_type}
                        </span>
                      </td>
                      <td style={{ padding: "6px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: r.confidence >= 0.8 ? "var(--green)" : r.confidence >= 0.6 ? "var(--amber)" : "var(--red)" }}>
                            {r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "—"}
                          </span>
                          {r.confidence != null && (
                            <div style={{ width: 48, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2 }}>
                              <div style={{
                                width: `${r.confidence * 100}%`, height: "100%", borderRadius: 2,
                                background: r.confidence >= 0.8 ? "var(--green)" : r.confidence >= 0.6 ? "var(--amber)" : "var(--red)",
                              }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "6px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}
                          title={absTime(r.timestamp)}>
                        {relTime(r.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <style>{`.anom-row:hover { background: rgba(0,212,255,.03); }`}</style>
    </div>
  );
}
