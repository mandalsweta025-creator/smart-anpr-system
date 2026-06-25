import { useState, useEffect, useCallback } from "react";
import { API, apiFetch, getSnapshotURL } from "../store/dashboardStore";
import { useToast } from "../components/Toast";

// ── Shared helpers ──────────────────────────────────────────
function CmdBtn({ label, onClick, color = "cyan", disabled = false, small = false }) {
  return (
    <button
      className="cmd-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        borderColor: `var(--border-${color})`,
        color: `var(--${color})`,
        background: `var(--${color}-dim)`,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: small ? "10px" : undefined,
        padding: small ? "3px 8px" : undefined,
      }}
    >
      {label}
    </button>
  );
}

function StatusMsg({ msg }) {
  if (!msg) return null;
  const isErr = msg.startsWith("ERR");
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: "11px",
      color: isErr ? "var(--red)" : "var(--green)",
      background: isErr ? "rgba(255,50,50,0.05)" : "rgba(0,255,136,0.04)",
      border: `1px solid ${isErr ? "var(--border-red, #ff3232)" : "var(--border-green)"}`,
      borderRadius: "4px", padding: "8px 12px", marginTop: "10px",
    }}>
      {isErr ? "✗" : "✓"} {msg}
    </div>
  );
}

// ── BLACKLIST PANEL ─────────────────────────────────────────
function BlacklistPanel() {
  const [list, setList] = useState([]);
  const [plate, setPlate] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API}/vehicles/blacklisted`);
      setList(await r.json());
    } catch {
      setMsg("ERR: Could not fetch blacklist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addToBlacklist = async () => {
    const p = plate.trim().toUpperCase();
    if (!p) return;
    try {
      const r = await apiFetch(`${API}/vehicles/${encodeURIComponent(p)}/blacklist`, { method: "POST" });
      const d = await r.json();
      if (d.success) {
        setMsg(`${p} added to blacklist`);
        setPlate("");
        load();
      } else {
        setMsg(`ERR: ${d.detail || "Failed"}`);
      }
    } catch (e) {
      setMsg(`ERR: ${e.message}`);
    }
  };

  const removeFromBlacklist = async (plateNum) => {
    try {
      const r = await apiFetch(`${API}/vehicles/${encodeURIComponent(plateNum)}/blacklist`, { method: "DELETE" });
      const d = await r.json();
      if (d.success) {
        setMsg(`${plateNum} removed from blacklist`);
        load();
      } else {
        setMsg(`ERR: ${d.detail || "Failed"}`);
      }
    } catch (e) {
      setMsg(`ERR: ${e.message}`);
    }
  };

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-red, #ff3232)", borderRadius: "4px", padding: "16px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "12px", color: "var(--red)", letterSpacing: "0.08em", marginBottom: "14px" }}>
        ⛔ BLACKLIST
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginLeft: "10px" }}>
          {list.length} plate{list.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Add form */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addToBlacklist()}
          placeholder="Plate number e.g. WB02W1169"
          style={{
            flex: 1, background: "rgba(0,0,0,0.3)",
            border: "1px solid var(--border-cyan)", color: "var(--text-primary)",
            fontFamily: "var(--font-mono)", fontSize: "12px",
            padding: "5px 8px", borderRadius: "2px", outline: "none",
          }}
        />
        <CmdBtn label="+ BLACKLIST" color="red" onClick={addToBlacklist} />
      </div>

      {/* List */}
      <div style={{ maxHeight: "280px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
        {loading && <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>Loading...</div>}
        {!loading && list.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>No blacklisted vehicles.</div>
        )}
        {list.map((v) => (
          <div key={v.id} style={{
            display: "flex", alignItems: "center", gap: "10px",
            background: "rgba(255,50,50,0.05)", border: "1px solid rgba(255,50,50,0.2)",
            borderRadius: "3px", padding: "7px 10px",
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--red)", flex: 1, letterSpacing: "0.05em" }}>
              {v.plate_number}
            </span>
            {v.owner_name && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>{v.owner_name}</span>
            )}
            <CmdBtn label="REMOVE" color="cyan" small onClick={() => removeFromBlacklist(v.plate_number)} />
          </div>
        ))}
      </div>

      <StatusMsg msg={msg} />
    </div>
  );
}

// ── SNAPSHOT GALLERY MODAL ──────────────────────────────────
function SnapshotGalleryModal({ plate, onClose }) {
  const [snaps,   setSnaps]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    apiFetch(`${API}/detections/${encodeURIComponent(plate)}/snapshots?limit=48`)
      .then(r => r.json())
      .then(d => { setSnaps(d.snapshots || []); setTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [plate]);

  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border-cyan)",
        borderRadius: 8, padding: 24, width: "min(800px, 95vw)",
        maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 16,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--cyan)", letterSpacing: 2 }}>
              SNAPSHOT GALLERY
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--amber)", marginTop: 4 }}>
              {plate} · {total} snapshot{total !== 1 ? "s" : ""}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--border-red)",
            color: "var(--red)", width: 28, height: 28, borderRadius: 4,
            cursor: "pointer", fontSize: 14, fontFamily: "var(--font-mono)",
          }}>✕</button>
        </div>

        {/* Grid */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading && (
            <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "24px 0", textAlign: "center" }}>
              Loading snapshots…
            </div>
          )}
          {!loading && snaps.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "32px 0", textAlign: "center" }}>
              No snapshots found for this plate
            </div>
          )}
          {!loading && snaps.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
              {snaps.map(s => (
                <div key={s.id} style={{
                  background: "rgba(0,0,0,0.4)", border: "1px solid var(--border-cyan)",
                  borderRadius: 4, overflow: "hidden", cursor: "pointer",
                  transition: "border-color 0.15s",
                }} onClick={() => setLightbox(s)}>
                  <img
                    src={getSnapshotURL(s.image_path)}
                    alt={plate}
                    style={{ width: "100%", height: 80, objectFit: "cover", display: "block" }}
                    onError={e => { e.target.src = ""; e.target.style.display = "none"; }}
                  />
                  <div style={{ padding: "5px 7px" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)" }}>
                      {fmtTime(s.timestamp)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span style={{
                        fontSize: 9, fontFamily: "var(--font-mono)",
                        color: s.event_type === "ENTRY" ? "var(--green)" : s.event_type === "EXIT" ? "var(--red)" : "var(--cyan)",
                      }}>{s.event_type}</span>
                      {s.confidence != null && (
                        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                          {(s.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {total > 48 && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", textAlign: "center" }}>
            Showing 48 of {total} — use Advanced Search for full history
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9100,
          background: "rgba(0,0,0,0.95)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 12,
        }} onClick={() => setLightbox(null)}>
          <img
            src={getSnapshotURL(lightbox.image_path)}
            alt={plate}
            style={{ maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 4 }}
          />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
            {plate} · {fmtTime(lightbox.timestamp)} · {lightbox.camera_id} · {(lightbox.confidence * 100).toFixed(0)}% conf
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
            Click anywhere to close
          </div>
        </div>
      )}
    </div>
  );
}


// ── CSV IMPORT PANEL ────────────────────────────────────────
function CsvImportPanel({ onImported }) {
  const { toastSuccess, toastError } = useToast();
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const url = `${API}/vehicles/import-csv?update_existing=${updateExisting}`;
      const r = await apiFetch(url, { method: "POST", body: form });
      const d = await r.json();
      if (r.ok && d.success) {
        setResult(d);
        toastSuccess(`Imported: +${d.added} added, ${d.updated} updated, ${d.skipped} skipped`);
        onImported();
      } else {
        toastError(d.detail || "Import failed");
      }
    } catch (err) {
      toastError("Import error: " + err.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const downloadTemplate = () => {
    const csv = "plate_number,owner_name,vehicle_type,is_blacklisted,is_watchlisted,watchlist_reason\nMH12AB1234,Owner Name,Car,0,0,\nKL45CD5678,Another Owner,Truck,1,0,stolen vehicle\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vehicle_import_template.csv";
    a.click();
  };

  const inputStyle = {
    background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-cyan)",
    color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "11px",
    padding: "5px 8px", borderRadius: "2px", outline: "none",
  };

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid rgba(0,212,255,0.3)", borderRadius: "4px", padding: "16px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "12px", color: "var(--cyan)", letterSpacing: "0.08em", marginBottom: "12px" }}>
        📥 BULK IMPORT — CSV
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginBottom: "12px", lineHeight: 1.6 }}>
        Upload a CSV file to bulk-register vehicles. Required column: <code style={{ color: "var(--amber)" }}>plate_number</code>.
        Optional: <code style={{ color: "var(--text-secondary)" }}>owner_name, vehicle_type, is_blacklisted, is_watchlisted, watchlist_reason</code>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{
          padding: "5px 14px", borderRadius: 2, cursor: loading ? "not-allowed" : "pointer",
          border: "1px solid var(--border-cyan)", background: "var(--cyan-dim)",
          color: "var(--cyan)", fontFamily: "var(--font-mono)", fontSize: "11px",
          opacity: loading ? 0.5 : 1,
        }}>
          {loading ? "IMPORTING…" : "📂 CHOOSE CSV"}
          <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={loading}
            style={{ display: "none" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={updateExisting} onChange={e => setUpdateExisting(e.target.checked)}
            style={{ accentColor: "var(--cyan)" }} />
          Update existing plates
        </label>
        <button onClick={downloadTemplate} style={{
          padding: "5px 14px", borderRadius: 2, cursor: "pointer",
          border: "1px solid rgba(0,212,255,0.25)", background: "transparent",
          color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "10px",
        }}>⬇ Template</button>
      </div>
      {result && (
        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 3,
          background: "rgba(0,255,136,0.04)", border: "1px solid rgba(0,255,136,0.2)",
          fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--green)",
          display: "flex", gap: 20, flexWrap: "wrap",
        }}>
          <span>✓ {result.added} added</span>
          <span style={{ color: "var(--cyan)" }}>↻ {result.updated} updated</span>
          <span style={{ color: "var(--text-muted)" }}>— {result.skipped} skipped</span>
          {result.parse_errors?.length > 0 && (
            <span style={{ color: "var(--amber)" }}>⚠ {result.parse_errors.length} row errors</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── VEHICLE REGISTRY PANEL ──────────────────────────────────
function RegistryPanel() {
  const { toastSuccess, toastError } = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ plate_number: "", owner_name: "", vehicle_type: "" });
  const [filter, setFilter] = useState("");
  const [galleryPlate, setGalleryPlate] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API}/vehicles`);
      setVehicles(await r.json());
    } catch {
      setMsg("ERR: Could not fetch vehicles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const register = async () => {
    const p = form.plate_number.trim().toUpperCase();
    if (!p) return;
    try {
      const r = await apiFetch(`${API}/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, plate_number: p }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg(`${p} registered`);
        setForm({ plate_number: "", owner_name: "", vehicle_type: "" });
        load();
      } else {
        setMsg(`ERR: ${d.detail || "Failed"}`);
      }
    } catch (e) {
      setMsg(`ERR: ${e.message}`);
    }
  };

  const deleteVehicle = async (plateNum) => {
    if (!confirm(`Delete ${plateNum} from registry?`)) return;
    try {
      const r = await apiFetch(`${API}/vehicles/${encodeURIComponent(plateNum)}`, { method: "DELETE" });
      const d = await r.json();
      if (d.success) {
        toastSuccess(`${plateNum} deleted from registry`);
        setMsg("");
        load();
      } else {
        toastError(d.detail || "Delete failed");
      }
    } catch (e) {
      toastError(e.message);
    }
  };

  const toggleWatchlist = async (plateNum, currently) => {
    try {
      const r = await apiFetch(`${API}/vehicles/${encodeURIComponent(plateNum)}/watchlist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currently }),
      });
      const d = await r.json();
      if (d.success) {
        toastSuccess(`${plateNum} ${!currently ? "added to" : "removed from"} watchlist`);
        load();
      } else {
        toastError(d.detail || "Watchlist update failed");
      }
    } catch (e) {
      toastError(e.message);
    }
  };

  const inputStyle = {
    background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-cyan)",
    color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "12px",
    padding: "5px 8px", borderRadius: "2px", outline: "none",
  };

  const filtered = vehicles.filter(v =>
    !filter || v.plate_number.toLowerCase().includes(filter.toLowerCase()) ||
    (v.owner_name || "").toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: "4px", padding: "16px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "12px", color: "var(--cyan)", letterSpacing: "0.08em", marginBottom: "14px" }}>
        🚗 VEHICLE REGISTRY
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginLeft: "10px" }}>
          {vehicles.length} registered
        </span>
      </div>

      {/* Register form */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <input value={form.plate_number} onChange={(e) => setForm(f => ({ ...f, plate_number: e.target.value }))}
          placeholder="Plate *" style={{ ...inputStyle, flex: "1 1 140px" }} />
        <input value={form.owner_name} onChange={(e) => setForm(f => ({ ...f, owner_name: e.target.value }))}
          placeholder="Owner name" style={{ ...inputStyle, flex: "2 1 160px" }} />
        <input value={form.vehicle_type} onChange={(e) => setForm(f => ({ ...f, vehicle_type: e.target.value }))}
          placeholder="Type e.g. Car, Truck" style={{ ...inputStyle, flex: "1 1 120px" }} />
        <CmdBtn label="+ REGISTER" color="green" onClick={register} />
      </div>

      {/* Filter */}
      <input value={filter} onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by plate or owner..."
        style={{ ...inputStyle, width: "100%", marginBottom: "10px", boxSizing: "border-box" }} />

      {/* Table */}
      <div style={{ maxHeight: "340px", overflowY: "auto" }}>
        {loading && <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>Loading...</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>No vehicles found.</div>
        )}

        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
          {filtered.length > 0 && (
            <thead>
              <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-cyan)" }}>
                {["PLATE", "OWNER", "TYPE", "STATUS", "ACTIONS"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 8px", fontWeight: "normal" }}>{h}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "6px 8px", color: v.is_blacklisted ? "var(--red)" : v.is_watchlisted ? "var(--amber)" : "var(--cyan)", letterSpacing: "0.04em" }}>
                  {v.plate_number}
                  {v.is_watchlisted && <span style={{ marginLeft: 5, fontSize: 8, color: "var(--amber)" }}>👁 WATCH</span>}
                </td>
                <td style={{ padding: "6px 8px", color: "var(--text-primary)" }}>{v.owner_name || "—"}</td>
                <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{v.vehicle_type || "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  {v.is_blacklisted
                    ? <span style={{ color: "var(--red)", fontSize: "9px" }}>⛔ BLACKLISTED</span>
                    : v.is_authorized
                      ? <span style={{ color: "var(--green)", fontSize: "9px" }}>✓ AUTH</span>
                      : <span style={{ color: "var(--amber)", fontSize: "9px" }}>⚠ UNAUTH</span>}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    <CmdBtn label="📷 SNAPS"  color="cyan"  small onClick={() => setGalleryPlate(v.plate_number)} />
                    <CmdBtn
                      label={v.is_watchlisted ? "UNWATCH" : "👁 WATCH"}
                      color={v.is_watchlisted ? "amber" : "purple"}
                      small
                      onClick={() => toggleWatchlist(v.plate_number, v.is_watchlisted)}
                    />
                    <CmdBtn label="DEL" color="red" small onClick={() => deleteVehicle(v.plate_number)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <StatusMsg msg={msg} />

      {/* Snapshot Gallery Modal */}
      {galleryPlate && (
        <SnapshotGalleryModal plate={galleryPlate} onClose={() => setGalleryPlate(null)} />
      )}
    </div>
  );
}

// ── PAGE ────────────────────────────────────────────────────
export default function Registry() {
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = () => setRefreshKey(k => k + 1);

  return (
    <div style={{ padding: "16px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "14px", color: "var(--cyan)", letterSpacing: "0.1em" }}>
        VEHICLE REGISTRY &amp; ACCESS CONTROL
      </div>
      <CsvImportPanel onImported={reload} />
      <BlacklistPanel key={"bl-" + refreshKey} />
      <RegistryPanel key={"reg-" + refreshKey} />
    </div>
  );
}
