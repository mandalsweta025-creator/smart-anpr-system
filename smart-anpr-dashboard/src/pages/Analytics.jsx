import { useState, useEffect } from "react";
import { API, apiFetch } from "../store/dashboardStore";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Traffic Heatmap (day-of-week × hour-of-day) ──────────────────────────────
function TrafficHeatmap({ hmDays }) {
  const [heatData, setHeatData]   = useState([]);
  const [maxCount, setMaxCount]   = useState(1);
  const [loading,  setLoading]    = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`${API}/analytics/heatmap?days=${hmDays}`)
      .then(r => r.json())
      .then(d => {
        setHeatData(d.data || []);
        setMaxCount(d.max_count || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [hmDays]);

  // Build 7×24 lookup
  const grid = {};
  heatData.forEach(({ day, hour, count }) => { grid[`${day}_${hour}`] = count; });

  const cellColor = (count) => {
    if (!count) return "rgba(0,212,255,0.04)";
    const intensity = Math.pow(count / maxCount, 0.6);  // gamma compress for visibility
    const r = Math.round(0   + intensity * 0);
    const g = Math.round(100 + intensity * 155);
    const b = Math.round(180 + intensity * 75);
    return `rgba(${r},${g},${b},${0.15 + intensity * 0.75})`;
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="panel-title">TRAFFIC HEATMAP — last {hmDays} days</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          dark = low · bright = high
        </div>
      </div>
      {loading ? (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading…</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          {/* Hour labels */}
          <div style={{ display: "flex", marginLeft: 38, marginBottom: 2 }}>
            {hours.map(h => (
              <div key={h} style={{
                flex: 1, textAlign: "center", fontSize: 9,
                color: "var(--text-muted)", fontFamily: "var(--font-mono)",
                minWidth: 18,
              }}>
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </div>
            ))}
          </div>
          {/* Grid rows */}
          {DAYS_OF_WEEK.map((dayLabel, day) => (
            <div key={day} style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
              <div style={{
                width: 32, fontSize: 10, color: "var(--text-muted)",
                fontFamily: "var(--font-mono)", flexShrink: 0,
              }}>
                {dayLabel}
              </div>
              {hours.map(hour => {
                const count = grid[`${day}_${hour}`] || 0;
                return (
                  <div
                    key={hour}
                    title={`${dayLabel} ${String(hour).padStart(2,"0")}:00 — ${count} detections`}
                    style={{
                      flex: 1, height: 18, minWidth: 18,
                      background: cellColor(count),
                      border: "1px solid rgba(0,212,255,0.06)",
                      borderRadius: 2,
                      cursor: "default",
                      transition: "opacity .1s",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dwell Time Distribution ───────────────────────────────────────────────────
function DwellChart({ days }) {
  const [buckets, setBuckets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`${API}/analytics/dwell?days=${days}`)
      .then(r => r.json())
      .then(d => { setBuckets(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days]);

  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const total    = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="panel-title">DWELL TIME DISTRIBUTION</div>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {total} sessions
        </span>
      </div>
      {loading ? (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {buckets.map(({ label, count }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", width: 80, flexShrink: 0 }}>
                {label}
              </span>
              <div style={{ flex: 1, height: 10, background: "rgba(0,0,0,0.3)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  background: "linear-gradient(90deg, var(--cyan), var(--green))",
                  width: `${(count / maxCount) * 100}%`,
                  transition: "width .4s",
                }} />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--cyan)", width: 28, textAlign: "right" }}>
                {count}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", width: 38, textAlign: "right" }}>
                {total > 0 ? `${Math.round((count / total) * 100)}%` : "—"}
              </span>
            </div>
          ))}
          {buckets.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>No session data yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── By-Camera Detection Share ─────────────────────────────────────────────────
function ByCameraChart({ days }) {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`${API}/analytics/by-camera?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days]);

  const maxCount = Math.max(...data.map(d => d.count), 1);

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 16 }}>
      <div className="panel-title" style={{ marginBottom: 12 }}>DETECTIONS BY CAMERA — last {days}d</div>
      {loading ? (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading…</div>
      ) : data.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>No data yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.map(({ camera_id, count, pct }) => (
            <div key={camera_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", width: 80, flexShrink: 0 }}>
                {camera_id}
              </span>
              <div style={{ flex: 1, height: 8, background: "rgba(0,0,0,0.3)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: "var(--cyan)", width: `${(count / maxCount) * 100}%`, transition: "width 0.4s" }} />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--cyan)", width: 40, textAlign: "right" }}>{count}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", width: 36, textAlign: "right" }}>{pct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Main Analytics Page ────────────────────────────────────────────────────────
export default function Analytics() {
  const [days,      setDays]      = useState(7);
  const [hmDays,    setHmDays]    = useState(28);
  const [hourly,    setHourly]    = useState([]);
  const [topPlates, setTopPlates] = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`${API}/analytics/hourly?days=${days}`).then(r => r.json()),
      apiFetch(`${API}/analytics/plates/top?limit=10&days=${days}`).then(r => r.json()),
    ]).then(([h, t]) => {
      setHourly(Array.isArray(h) ? h : []);
      setTopPlates(Array.isArray(t) ? t : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [days]);

  const maxCount = Math.max(...hourly.map(h => h.count), 1);

  const BTN = (d) => (
    <button
      key={d}
      onClick={() => setDays(d)}
      style={{
        fontFamily: "var(--font-mono)", fontSize: "11px",
        background: days === d ? "var(--cyan-dim)" : "none",
        border: `1px solid ${days === d ? "var(--cyan)" : "var(--border-cyan)"}`,
        color:   days === d ? "var(--cyan)" : "var(--text-muted)",
        padding: "4px 12px", cursor: "pointer", borderRadius: "2px",
      }}
    >{d}d</button>
  );

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, height: "100%", overflowY: "auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--cyan)", letterSpacing: "0.1em" }}>
          DETECTION ANALYTICS
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 7, 30].map(BTN)}
        </div>
      </div>

      {/* ── Detections by Hour / Day ── */}
      <div className="panel" style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>
          {days === 1 ? "DETECTIONS BY HOUR" : "DETECTIONS BY DAY"}
        </div>
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading…</div>
        ) : (
          <div className="chart-area" style={{ height: 180 }}>
            {hourly.map(({ label, hour, count }) => (
              <div key={label ?? hour} className="bar-grp">
                <div className="bar-val">{count || ""}</div>
                <div className="bar-wrap">
                  <div className="bar-fill bar-cyan" style={{ height: `${(count / maxCount) * 100}%` }} />
                </div>
                <div className="bar-label">{label ?? `${String(hour).padStart(2, "0")}h`}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Traffic Heatmap ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: -10 }}>
        {[14, 28, 60, 90].map(d => (
          <button key={d} onClick={() => setHmDays(d)}
            style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              background: hmDays === d ? "var(--cyan-dim)" : "none",
              border: `1px solid ${hmDays === d ? "var(--cyan)" : "var(--border-cyan)"}`,
              color:   hmDays === d ? "var(--cyan)" : "var(--text-muted)",
              padding: "3px 8px", cursor: "pointer", borderRadius: 2,
            }}
          >{d}d</button>
        ))}
      </div>
      <TrafficHeatmap hmDays={hmDays} />

      {/* ── Dwell Time Distribution ── */}
      <DwellChart days={days} />

      {/* ── By Camera ── */}
      <ByCameraChart days={days} />

      {/* ── Top Plates ── */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>MOST FREQUENT PLATES</div>
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {topPlates.map(({ plate, count }, i) => (
              <div key={plate} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", width: 20 }}>#{i + 1}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, flex: 1, letterSpacing: "0.1em" }}>{plate}</span>
                <div style={{ flex: 2, height: 6, background: "rgba(0,0,0,0.3)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: "var(--cyan)", width: `${(count / (topPlates[0]?.count || 1)) * 100}%` }} />
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--cyan)", width: 30, textAlign: "right" }}>{count}</span>
              </div>
            ))}
            {topPlates.length === 0 && (
              <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>No data yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
