import { useState, useEffect, useCallback, useRef } from "react";
import { API, apiFetch, getSnapshotURL } from "../store/dashboardStore";
import PlateModal from "../components/PlateModal";
import { relTime, absTime } from "../utils/time";

function fmtDateTime(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function timeSince(isoStr) {
  if (!isoStr) return "—";
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const totalMin = Math.floor(diffMs / 60000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function fmtDuration(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const S = {
  page: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    height: "100%",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: "var(--font-display)",
    fontSize: "13px",
    color: "var(--cyan)",
    letterSpacing: "0.1em",
  },
  refreshBtn: {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    background: "none",
    border: "1px solid var(--border-cyan)",
    color: "var(--cyan)",
    padding: "4px 12px",
    cursor: "pointer",
    borderRadius: "2px",
  },
  statsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" },
  statCard: (dimColor, borderColor) => ({
    background: dimColor,
    border: `1px solid ${borderColor}`,
    borderRadius: "4px",
    padding: "14px 16px",
  }),
  statLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    color: "var(--text-muted)",
    letterSpacing: "0.08em",
  },
  statValue: (color) => ({
    fontFamily: "var(--font-display)",
    fontSize: "30px",
    color,
    marginTop: "4px",
  }),
  tabs: { display: "flex", gap: "2px", borderBottom: "1px solid var(--border-cyan)" },
  tab: (active) => ({
    fontFamily: "var(--font-display)",
    fontSize: "11px",
    padding: "8px 18px",
    background: active ? "var(--cyan-dim)" : "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--cyan)" : "2px solid transparent",
    color: active ? "var(--cyan)" : "var(--text-muted)",
    cursor: "pointer",
    letterSpacing: "0.05em",
  }),
  empty: {
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    textAlign: "center",
    padding: "32px 0",
  },
  list: { display: "flex", flexDirection: "column", gap: "8px" },
  exitBtn: {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    background: "var(--red-dim, rgba(255,60,60,0.08))",
    border: "1px solid var(--red)",
    color: "var(--red)",
    padding: "4px 10px",
    cursor: "pointer",
    borderRadius: "2px",
    whiteSpace: "nowrap",
  },
  loadMoreBtn: {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    background: "none",
    border: "1px solid var(--border-cyan)",
    color: "var(--cyan)",
    padding: "8px 0",
    cursor: "pointer",
    borderRadius: "2px",
    width: "100%",
    marginTop: "4px",
  },
};

function SnapThumb({ path }) {
  const [failed, setFailed] = useState(false);
  const url = getSnapshotURL(path);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt="plate snap"
      onError={() => setFailed(true)}
      style={{
        width: "72px", height: "36px", objectFit: "cover",
        borderRadius: "2px", border: "1px solid var(--border-cyan)",
      }}
    />
  );
}

function CamInfo({ inCam, outCam }) {
  const base = { fontFamily: "var(--font-mono)", fontSize: "9px", lineHeight: "1.4" };
  if (!inCam) return <div style={{ ...base, color: "var(--text-muted)" }}>—</div>;
  return (
    <div>
      <div style={{ ...base, color: "var(--green)" }}>▶ {inCam}</div>
      {outCam
        ? <div style={{ ...base, color: "var(--cyan)", marginTop: "1px" }}>◀ {outCam}</div>
        : null}
      <div style={{ ...base, color: "var(--text-muted)", marginTop: "2px", fontSize: "8px", letterSpacing: "0.06em" }}>
        {outCam ? "IN / OUT" : "ENTRY CAM"}
      </div>
    </div>
  );
}

function ActiveCard({ v, onExit, onPlateClick }) {
  const [ticked, setTicked] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTicked((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const markExited = async () => {
    setExiting(true);
    try {
      await apiFetch(`${API}/sessions/${encodeURIComponent(v.plate_number)}/exit`, { method: "POST" });
      onExit();
    } catch {}
    setExiting(false);
  };

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-green)",
        borderRadius: "4px",
        padding: "12px 16px",
        display: "grid",
        gridTemplateColumns: "72px 150px 1fr 90px 110px auto",
        gap: "12px",
        alignItems: "center",
      }}
    >
      {/* Entry snapshot */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        width: "72px", height: "36px", background: "rgba(0,0,0,0.3)",
        borderRadius: "2px", border: "1px solid var(--border-cyan)", overflow: "hidden" }}>
        {v.snapshot_path
          ? <SnapThumb path={v.snapshot_path} />
          : <span style={{ fontSize: "18px" }}>🚗</span>}
      </div>

      {/* Plate */}
      <div>
        <div
          style={{ fontFamily: "var(--font-display)", fontSize: "15px", color: "var(--green)", letterSpacing: "0.12em", cursor: "pointer" }}
          onClick={() => onPlateClick(v.plate_number)}
          title="Click for full history"
        >
          {v.plate_number}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px", letterSpacing: "0.08em" }}>
          PLATE NUMBER
        </div>
      </div>

      {/* Entry time */}
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-primary)" }}
             title={absTime(v.entry_time)}>
          {relTime(v.entry_time)}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px" }}>
          ENTRY TIME
        </div>
      </div>

      {/* Camera */}
      <CamInfo inCam={v.camera_id} outCam={null} />

      {/* Inside for */}
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "14px", color: "var(--amber)" }}>
          {timeSince(v.entry_time)}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px" }}>
          INSIDE FOR
        </div>
      </div>

      <button style={{ ...S.exitBtn, opacity: exiting ? 0.5 : 1, cursor: exiting ? "not-allowed" : "pointer" }} onClick={markExited} disabled={exiting}>
        {exiting ? "…" : "MARK EXITED"}
      </button>
    </div>
  );
}

function ExitedCard({ v, onPlateClick }) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-cyan)",
        borderRadius: "4px",
        padding: "12px 16px",
        display: "grid",
        gridTemplateColumns: "72px 130px 1fr 1fr 90px 80px",
        gap: "12px",
        alignItems: "center",
      }}
    >
      {/* Snapshot */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        width: "72px", height: "36px", background: "rgba(0,0,0,0.3)",
        borderRadius: "2px", border: "1px solid var(--border-cyan)", overflow: "hidden" }}>
        {v.snapshot_path
          ? <SnapThumb path={v.snapshot_path} />
          : <span style={{ fontSize: "18px" }}>🚗</span>}
      </div>

      {/* Plate */}
      <div>
        <div
          style={{ fontFamily: "var(--font-display)", fontSize: "14px", color: "var(--cyan)", letterSpacing: "0.1em", cursor: "pointer" }}
          onClick={() => onPlateClick(v.plate_number)}
          title="Click for full history"
        >
          {v.plate_number}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px" }}>
          PLATE
        </div>
      </div>

      {/* Entry time */}
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-primary)" }}
             title={absTime(v.entry_time)}>
          {relTime(v.entry_time)}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px" }}>
          ENTERED
        </div>
      </div>

      {/* Exit time */}
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-secondary)" }}
             title={absTime(v.exit_time)}>
          {relTime(v.exit_time)}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px" }}>
          EXITED
        </div>
      </div>

      {/* Cameras */}
      <CamInfo inCam={v.camera_id} outCam={v.exit_camera_id} />

      {/* Duration */}
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "13px", color: "var(--amber)" }}>
          {fmtDuration(v.duration_minutes)}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px" }}>
          DURATION
        </div>
      </div>
    </div>
  );
}

export default function Sessions() {
  const [active, setActive] = useState({ active_count: 0, vehicles: [] });
  const [exited, setExited] = useState([]);
  const [counts, setCounts] = useState({ active: 0, exited: 0, total: 0 });
  const [tab, setTab] = useState("active");
  const [loading, setLoading] = useState(true);
  const [exitedLimit, setExitedLimit] = useState(100);
  const exitedLimitRef = useRef(100);
  const [search, setSearch] = useState("");
  const [modalPlate, setModalPlate] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [activeRes, exitedRes, countsRes] = await Promise.all([
        apiFetch(`${API}/sessions/active`),
        apiFetch(`${API}/sessions/exited?limit=${exitedLimitRef.current}`),
        apiFetch(`${API}/sessions/counts`),
      ]);
      if (activeRes.ok)  setActive(await activeRes.json());
      if (exitedRes.ok)  setExited(await exitedRes.json());
      if (countsRes.ok)  setCounts(await countsRes.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 10000);
    return () => clearInterval(t);
  }, [fetchData]);

  const loadMore = () => {
    const next = exitedLimitRef.current + 100;
    exitedLimitRef.current = next;
    setExitedLimit(next);
    fetchData();
  };

  const q = search.trim().toUpperCase();
  const filteredActive = q
    ? active.vehicles.filter(v => v.plate_number.includes(q))
    : active.vehicles;
  const filteredExited = q
    ? exited.filter(v => v.plate_number.includes(q))
    : exited;

  const [exporting, setExporting] = useState(false);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await apiFetch(`${API}/export/sessions`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "anpr_sessions.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("XLSX export failed:", e);
      alert("Export failed — " + e.message);
    }
    setExporting(false);
  };

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.title}>VEHICLE SESSION TRACKER</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter plate…"
            style={{
              fontFamily: "var(--font-mono)", fontSize: "11px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border-cyan)",
              color: "var(--text-primary)", padding: "4px 10px",
              borderRadius: "2px", outline: "none", width: "130px",
            }}
          />
          <button
            style={{ ...S.refreshBtn, color: "var(--green)", borderColor: "var(--border-green)",
                     opacity: exporting ? 0.5 : 1, cursor: exporting ? "not-allowed" : "pointer" }}
            onClick={exportXlsx}
            disabled={exporting}
          >
            {exporting ? "EXPORTING…" : "EXPORT XLSX"}
          </button>
          <button style={S.refreshBtn} onClick={fetchData}>
            REFRESH
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={S.statsGrid}>
        <div style={S.statCard("var(--green-dim)", "var(--border-green)")}>
          <div style={S.statLabel}>CURRENTLY INSIDE</div>
          <div style={S.statValue("var(--green)")}>{counts.active}</div>
        </div>
        <div style={S.statCard("var(--cyan-dim)", "var(--border-cyan)")}>
          <div style={S.statLabel}>TOTAL EXITED</div>
          <div style={S.statValue("var(--cyan)")}>{counts.exited}</div>
        </div>
        <div style={S.statCard("var(--amber-dim)", "var(--border-amber)")}>
          <div style={S.statLabel}>TOTAL SESSIONS</div>
          <div style={S.statValue("var(--amber)")}>{counts.total}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {[
          ["active", `ACTIVE VEHICLES (${counts.active})`],
          ["exited", `EXITED VEHICLES (${counts.exited})`],
        ].map(([key, label]) => (
          <button key={key} style={S.tab(tab === key)} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* Active vehicles */}
      {tab === "active" && (
        loading ? (
          <div style={S.empty}>Loading…</div>
        ) : filteredActive.length === 0 ? (
          <div style={S.empty}>{q ? `No active vehicles matching "${q}".` : "No vehicles currently inside."}</div>
        ) : (
          <div style={S.list}>
            {filteredActive.map((v) => (
              <ActiveCard key={v.id} v={v} onExit={fetchData} onPlateClick={setModalPlate} />
            ))}
          </div>
        )
      )}

      {/* Exited vehicles */}
      {tab === "exited" && (
        loading ? (
          <div style={S.empty}>Loading…</div>
        ) : filteredExited.length === 0 ? (
          <div style={S.empty}>{q ? `No exited vehicles matching "${q}".` : "No exited vehicles recorded yet."}</div>
        ) : (
          <div style={S.list}>
            {filteredExited.map((v) => (
              <ExitedCard key={v.id} v={v} onPlateClick={setModalPlate} />
            ))}
            {!q && exited.length >= exitedLimit && (
              <button style={S.loadMoreBtn} onClick={loadMore}>
                LOAD MORE
              </button>
            )}
          </div>
        )
      )}

      {/* Plate history modal */}
      {modalPlate && <PlateModal plate={modalPlate} onClose={() => setModalPlate(null)} />}
    </div>
  );
}
