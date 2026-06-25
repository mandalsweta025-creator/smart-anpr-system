import { useState, useEffect, useCallback } from "react";
import { useVehicleSearch, API, apiFetch, getToken } from "../store/dashboardStore";

function parseJwt(token) {
  try { return JSON.parse(atob(token.split(".")[1])); } catch { return null; }
}

function CmdBtn({ label, onClick, color = "cyan", disabled = false }) {
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
      }}
    >
      {label}
    </button>
  );
}

// ── Single-camera control row ────────────────────────────────
function CameraRow({ camId, isActive = false, onRemove }) {
  const [source, setSource] = useState("");
  const [status, setStatus] = useState(isActive ? "running" : "idle");
  const [msg, setMsg] = useState("");
  const [role, setRole] = useState("mixed");

  // Load persisted role on mount
  useEffect(() => {
    apiFetch(`${API}/camera/${camId}/role`)
      .then(r => r.json())
      .then(d => { if (d.role) setRole(d.role); })
      .catch(() => {});
  }, [camId]);

  const saveRole = async (newRole) => {
    setRole(newRole);
    try {
      await apiFetch(`${API}/camera/${camId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
    } catch (e) {
      setMsg("Role save failed: " + e.message);
    }
  };

  const setSourceAndStart = async () => {
    if (!source.trim()) return;
    setStatus("starting");
    try {
      await apiFetch(`${API}/camera/${camId}/source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const r = await apiFetch(`${API}/camera/${camId}/start`, { method: "POST" });
      const d = await r.json();
      setStatus(d.success ? "running" : "error");
      setMsg(d.success ? `Started — ${source}` : d.error || "Failed");
    } catch (e) {
      setStatus("error");
      setMsg(e.message);
    }
  };

  const stop = async () => {
    await apiFetch(`${API}/camera/${camId}/stop`, { method: "POST" });
    setStatus("idle");
    setMsg("Stopped");
  };

  const [diagResult, setDiagResult] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const diagnose = async () => {
    setDiagLoading(true);
    setDiagResult(null);
    try {
      const r = await apiFetch(`${API}/camera/${camId}/diagnose`);
      setDiagResult(await r.json());
    } catch (e) {
      setDiagResult({ error: e.message });
    } finally {
      setDiagLoading(false);
    }
  };

  const statusColor = { idle: "text-muted", running: "green", error: "red", starting: "yellow" };

  return (
    <div
      style={{
        border: "1px solid var(--border-cyan)",
        borderRadius: "4px",
        padding: "12px",
        marginBottom: "8px",
        background: "var(--bg-card)",
      }}
    >
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--cyan)", minWidth: "80px" }}>
          CAM: {camId}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: `var(--${statusColor[status]})`,
            marginLeft: "auto",
          }}
        >
          ● {status.toUpperCase()}
        </span>
        <CmdBtn label="✕" color="red" onClick={() => { stop(); onRemove(camId); }} />
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="0  or  http://ip:port/video"
          style={{
            flex: 1,
            background: "rgba(0,0,0,0.3)",
            border: "1px solid var(--border-cyan)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            padding: "5px 8px",
            borderRadius: "2px",
            outline: "none",
          }}
        />
        <CmdBtn label="▶ START" color="green" onClick={setSourceAndStart} disabled={status === "running"} />
        <CmdBtn label="■ STOP" color="red" onClick={stop} disabled={status !== "running"} />
        <CmdBtn
          label={diagLoading ? "…" : "🔍 DIAGNOSE"}
          onClick={diagnose}
          disabled={diagLoading || (status !== "running" && status !== "error")}
        />
      </div>

      {/* Camera role selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", minWidth: "50px" }}>
          ROLE
        </span>
        {[
          { v: "entry", label: "ENTRY",      col: "green",  tip: "All detections = ENTRY"                      },
          { v: "exit",  label: "EXIT",        col: "red",    tip: "All detections = EXIT (close session)"       },
          { v: "smart", label: "SMART ⇄",    col: "cyan",   tip: "1st detection = ENTRY, 2nd = EXIT (single gate)" },
          { v: "mixed", label: "LEGACY",      col: "amber",  tip: "Timeout-based (not recommended)"             },
        ].map(({ v, label, col, tip }) => (
          <button key={v}
            onClick={() => saveRole(v)}
            title={tip}
            style={{
              padding: "3px 10px",
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              letterSpacing: "0.08em",
              border: `1px solid var(--border-${col})`,
              borderRadius: "2px",
              cursor: "pointer",
              background: role === v ? `var(--${col}-dim)` : "rgba(0,0,0,0.2)",
              color: role === v ? `var(--${col})` : "var(--text-muted)",
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)" }}>
          {role === "entry" ? "All detections = ENTRY" :
           role === "exit"  ? "All detections = EXIT" :
           role === "smart" ? "1st detection = ENTRY · 2nd = EXIT (single-gate)" :
           "Timeout-based legacy mode"}
        </span>
      </div>

      {msg && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginTop: "6px" }}>
          {msg}
        </div>
      )}

      {diagResult && (
        <div style={{
          marginTop: "8px",
          padding: "8px",
          background: "rgba(0,0,0,0.4)",
          border: "1px solid var(--border-cyan)",
          borderRadius: "3px",
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--text-primary)",
          maxHeight: "220px",
          overflowY: "auto",
        }}>
          {diagResult.error && diagResult.hint ? (
            /* Network / startup diagnostic (camera not running) */
            <div>
              <div style={{ color: "var(--red)", marginBottom: "4px" }}>{diagResult.error}</div>
              <div style={{ color: "var(--text-muted)", marginBottom: "4px" }}>
                Source: <span style={{ color: "var(--cyan)" }}>{diagResult.source}</span>
              </div>
              <div style={{
                color: diagResult.network_reachable ? "var(--green)" : "var(--amber)",
                marginBottom: "4px",
              }}>
                Network: {diagResult.network_reachable ? "✓ Reachable" : "✕ Unreachable"}
              </div>
              <div style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>{diagResult.hint}</div>
            </div>
          ) : diagResult.error ? (
            <div style={{ color: "var(--red)" }}>{diagResult.error}</div>
          ) : (
            <>
              <div style={{ color: "var(--cyan)", marginBottom: "4px" }}>
                Frame: {diagResult.frame_size} | Contours: {diagResult.contour_candidates} | YOLO strips: {diagResult.yolo_strips}
              </div>
              {[...(diagResult.contour_ocr || []), ...(diagResult.yolo_ocr || [])].map((r, i) => (
                <div key={i} style={{ marginBottom: "2px", color: r.valid ? "var(--green)" : r.raw_text === "(empty)" ? "var(--text-muted)" : "var(--amber)" }}>
                  [{r.label}] {r.size} → &quot;{r.raw_text ?? "?"}&quot;
                  {r.cleaned && r.cleaned !== r.raw_text ? ` → "${r.cleaned}"` : ""}
                  {r.confidence != null ? ` (${(r.confidence * 100).toFixed(0)}%)` : ""}
                  {r.valid ? " ✓ VALID" : r.error ? ` ERR: ${r.error}` : ""}
                </div>
              ))}
              {diagResult.contour_ocr?.length === 0 && diagResult.yolo_ocr?.length === 0 && (
                <div style={{ color: "var(--amber)" }}>
                  No plate-shaped regions found — plate may be too small or at wrong angle.
                </div>
              )}
              <div style={{ color: "var(--text-muted)", marginTop: "6px", lineHeight: 1.4 }}>
                {diagResult.tip}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── User Management section ──────────────────────────────────
function UserManagement({ inputStyle }) {
  const me = parseJwt(getToken() || "");
  const isAdmin = me?.role === "admin";

  const [users, setUsers] = useState([]);
  const [uLoading, setULoading] = useState(false);
  const [uMsg, setUMsg] = useState("");

  // Add-user form
  const [addForm, setAddForm] = useState({ username: "", email: "", password: "", role: "operator" });
  const [adding, setAdding] = useState(false);

  // Change-password form (own account)
  const [pwForm, setPwForm] = useState({ password: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    setULoading(true);
    try {
      const r = await apiFetch(`${API}/users`);
      if (r.ok) setUsers(await r.json());
    } catch (e) {
      setUMsg("Load failed: " + e.message);
    } finally {
      setULoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const addUser = async () => {
    const { username, email, password, role } = addForm;
    if (!username.trim() || !email.trim() || !password.trim()) {
      setUMsg("Username, email and password are required.");
      return;
    }
    setAdding(true);
    setUMsg("");
    try {
      const r = await apiFetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password }),
      });
      const d = await r.json();
      if (!r.ok) { setUMsg(d.detail || "Register failed"); setAdding(false); return; }
      // set role if not operator (default)
      if (role !== "operator") {
        const r2 = await apiFetch(`${API}/users/${d.id}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });
        if (!r2.ok) setUMsg("User created but role update failed.");
      }
      setAddForm({ username: "", email: "", password: "", role: "operator" });
      setUMsg(`✓ User "${d.username}" created`);
      loadUsers();
    } catch (e) {
      setUMsg("Error: " + e.message);
    } finally {
      setAdding(false);
    }
  };

  const deleteUser = async (id, username) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    setUMsg("");
    try {
      const r = await apiFetch(`${API}/users/${id}`, { method: "DELETE" });
      if (r.ok || r.status === 204) {
        setUMsg(`✓ Deleted "${username}"`);
        loadUsers();
      } else {
        const d = await r.json();
        setUMsg(d.detail || "Delete failed");
      }
    } catch (e) {
      setUMsg("Error: " + e.message);
    }
  };

  const toggleRole = async (id, username, currentRole) => {
    const newRole = currentRole === "admin" ? "operator" : "admin";
    setUMsg("");
    try {
      const r = await apiFetch(`${API}/users/${id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const d = await r.json();
      if (r.ok) {
        setUMsg(`✓ ${username} → ${newRole}`);
        loadUsers();
      } else {
        setUMsg(d.detail || "Role update failed");
      }
    } catch (e) {
      setUMsg("Error: " + e.message);
    }
  };

  const changeOwnPassword = async () => {
    if (pwForm.password.length < 6) { setPwMsg("Password must be at least 6 characters."); return; }
    if (pwForm.password !== pwForm.confirm) { setPwMsg("Passwords do not match."); return; }
    setPwSaving(true);
    setPwMsg("");
    try {
      const meRes = await apiFetch(`${API}/users/me`);
      if (!meRes.ok) { setPwMsg("Could not resolve user ID."); setPwSaving(false); return; }
      const meData = await meRes.json();
      const r = await apiFetch(`${API}/users/${meData.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwForm.password }),
      });
      const d = await r.json();
      if (r.ok) {
        setPwMsg("✓ Password changed successfully.");
        setPwForm({ password: "", confirm: "" });
      } else {
        setPwMsg(d.detail || "Failed to change password.");
      }
    } catch (e) {
      setPwMsg("Error: " + e.message);
    } finally {
      setPwSaving(false);
    }
  };

  const roleBadge = (role) => ({
    display: "inline-block",
    padding: "1px 7px",
    fontFamily: "var(--font-mono)",
    fontSize: "9px",
    letterSpacing: "0.06em",
    borderRadius: "2px",
    border: role === "admin" ? "1px solid var(--border-amber)" : "1px solid var(--border-cyan)",
    color: role === "admin" ? "var(--amber)" : "var(--cyan)",
    background: role === "admin" ? "var(--amber-dim)" : "var(--cyan-dim)",
  });

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-purple)", borderRadius: "4px", padding: "16px" }}>
      <div className="panel-title" style={{ marginBottom: "14px", color: "var(--purple, #a78bfa)" }}>
        USER MANAGEMENT
      </div>

      {/* Session info */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginBottom: "14px" }}>
        Logged in as <span style={{ color: "var(--cyan)" }}>{me?.sub ?? "unknown"}</span>
        &nbsp;·&nbsp;
        <span style={roleBadge(me?.role)}>{(me?.role ?? "operator").toUpperCase()}</span>
      </div>

      {/* Operator: show access restricted notice */}
      {!isAdmin && (
        <div className="admin-only-notice">
          ⚠ User management requires Administrator access. Contact your admin to manage accounts.
        </div>
      )}

      {/* ── User list (admin only) ── */}
      {isAdmin && (
        <>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginBottom: "8px" }}>
            {uLoading ? "Loading users…" : `${users.length} user${users.length !== 1 ? "s" : ""}`}
          </div>
          <div style={{ marginBottom: "14px" }}>
            {users.map(u => (
              <div key={u.id} style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 70px 60px 50px",
                alignItems: "center",
                gap: "8px",
                padding: "6px 8px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
              }}>
                <span style={{ color: u.username === me?.sub ? "var(--green)" : "var(--text-primary)" }}>
                  {u.username}{u.username === me?.sub ? " (you)" : ""}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.email}
                </span>
                <span><span style={roleBadge(u.role)}>{u.role.toUpperCase()}</span></span>
                <button
                  onClick={() => toggleRole(u.id, u.username, u.role)}
                  disabled={u.username === me?.sub}
                  title={u.username === me?.sub ? "Cannot change your own role" : `Toggle to ${u.role === "admin" ? "operator" : "admin"}`}
                  style={{
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid var(--border-amber)",
                    color: "var(--amber)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    padding: "2px 6px",
                    borderRadius: "2px",
                    cursor: u.username === me?.sub ? "not-allowed" : "pointer",
                    opacity: u.username === me?.sub ? 0.3 : 1,
                  }}
                >
                  ROLE
                </button>
                <button
                  onClick={() => deleteUser(u.id, u.username)}
                  disabled={u.username === me?.sub}
                  title={u.username === me?.sub ? "Cannot delete yourself" : `Delete ${u.username}`}
                  style={{
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid var(--border-red)",
                    color: "var(--red)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    padding: "2px 6px",
                    borderRadius: "2px",
                    cursor: u.username === me?.sub ? "not-allowed" : "pointer",
                    opacity: u.username === me?.sub ? 0.3 : 1,
                  }}
                >
                  DEL
                </button>
              </div>
            ))}
          </div>

          {/* ── Add user form ── */}
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginBottom: "8px" }}>
            ADD USER
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 80px 70px", gap: "6px", marginBottom: "8px" }}>
            <input
              value={addForm.username}
              onChange={e => setAddForm(p => ({ ...p, username: e.target.value }))}
              placeholder="username"
              style={{ ...inputStyle, fontSize: "11px" }}
            />
            <input
              value={addForm.email}
              onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))}
              placeholder="email"
              style={{ ...inputStyle, fontSize: "11px" }}
            />
            <input
              type="password"
              value={addForm.password}
              onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))}
              placeholder="password"
              onKeyDown={e => e.key === "Enter" && addUser()}
              style={{ ...inputStyle, fontSize: "11px" }}
            />
            <select
              value={addForm.role}
              onChange={e => setAddForm(p => ({ ...p, role: e.target.value }))}
              style={{ ...inputStyle, fontSize: "11px" }}
            >
              <option value="operator">operator</option>
              <option value="admin">admin</option>
            </select>
            <CmdBtn label={adding ? "…" : "+ ADD"} color="green" onClick={addUser} disabled={adding} />
          </div>
        </>
      )}

      {/* ── Change own password ── */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginBottom: "8px", marginTop: isAdmin ? "14px" : "0" }}>
        CHANGE PASSWORD
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: "6px" }}>
        <input
          type="password"
          value={pwForm.password}
          onChange={e => setPwForm(p => ({ ...p, password: e.target.value }))}
          placeholder="new password"
          style={{ ...inputStyle, fontSize: "11px" }}
        />
        <input
          type="password"
          value={pwForm.confirm}
          onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
          placeholder="confirm"
          onKeyDown={e => e.key === "Enter" && changeOwnPassword()}
          style={{ ...inputStyle, fontSize: "11px" }}
        />
        <CmdBtn
          label={pwSaving ? "…" : "SAVE"}
          color="purple"
          onClick={changeOwnPassword}
          disabled={pwSaving}
        />
      </div>
      {pwMsg && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", marginTop: "6px",
          color: pwMsg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>
          {pwMsg}
        </div>
      )}

      {/* Status message */}
      {uMsg && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", marginTop: "10px",
          color: uMsg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>
          {uMsg}
        </div>
      )}
    </div>
  );
}

// ── Adjacent Camera Pairs ────────────────────────────────────
function AdjacentCamerasPanel({ cameras }) {
  const [pairs,   setPairs]   = useState([]);
  const [saved,   setSaved]   = useState(false);
  const [camA,    setCamA]    = useState("");
  const [camB,    setCamB]    = useState("");
  const [msg,     setMsg]     = useState("");

  useEffect(() => {
    apiFetch(`${API}/config/adjacent-cameras`)
      .then(r => r.json())
      .then(d => setPairs(d.pairs || []))
      .catch(() => {});
  }, []);

  const save = async (newPairs) => {
    try {
      const r = await apiFetch(`${API}/config/adjacent-cameras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs: newPairs }),
      });
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } catch (e) { setMsg("Save failed: " + e.message); }
  };

  const addPair = () => {
    const a = camA.trim(), b = camB.trim();
    if (!a || !b || a === b) { setMsg("Enter two different camera IDs"); return; }
    const already = pairs.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
    if (already) { setMsg("Pair already exists"); return; }
    const next = [...pairs, [a, b].sort()];
    setPairs(next);
    save(next);
    setCamA(""); setCamB(""); setMsg("");
  };

  const removePair = (i) => {
    const next = pairs.filter((_, idx) => idx !== i);
    setPairs(next);
    save(next);
  };

  const camIds = cameras.map(c => c.id);
  const inputStyle = {
    background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-cyan)",
    color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "11px",
    padding: "5px 8px", borderRadius: "2px", outline: "none",
  };
  const selStyle = { ...inputStyle, cursor: "pointer" };

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: "4px", padding: "16px" }}>
      <div className="panel-title" style={{ marginBottom: "6px" }}>ADJACENT CAMERA PAIRS</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginBottom: "12px", lineHeight: 1.6 }}>
        Cameras in the same pair are physically co-located (e.g. entry + exit at the same gate).
        Plate cloning alerts are <strong style={{ color: "var(--cyan)" }}>never raised</strong> between adjacent cameras,
        preventing false alerts when the same vehicle moves from one to the other within seconds.
      </div>

      {/* Existing pairs */}
      {pairs.length === 0 ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginBottom: "12px" }}>
          No pairs configured. If cameras 1 &amp; 2 are at the same gate, add them below.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {pairs.map((p, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "3px 10px", borderRadius: 3,
              border: "1px solid var(--border-cyan)", background: "var(--cyan-dim)",
              fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--cyan)",
            }}>
              CAM-{p[0]} ↔ CAM-{p[1]}
              <button onClick={() => removePair(i)} style={{
                background: "none", border: "none", color: "var(--red)",
                cursor: "pointer", fontSize: "12px", lineHeight: 1, padding: 0,
              }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Add pair */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {camIds.length > 0 ? (
          <>
            <select value={camA} onChange={e => setCamA(e.target.value)} style={selStyle}>
              <option value="">Camera A…</option>
              {camIds.map(id => <option key={id} value={id}>CAM-{id}</option>)}
            </select>
            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>↔</span>
            <select value={camB} onChange={e => setCamB(e.target.value)} style={selStyle}>
              <option value="">Camera B…</option>
              {camIds.map(id => <option key={id} value={id}>CAM-{id}</option>)}
            </select>
          </>
        ) : (
          <>
            <input value={camA} onChange={e => setCamA(e.target.value)} placeholder="Camera A ID" style={{ ...inputStyle, width: 120 }} />
            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>↔</span>
            <input value={camB} onChange={e => setCamB(e.target.value)} placeholder="Camera B ID" style={{ ...inputStyle, width: 120 }} />
          </>
        )}
        <CmdBtn label={saved ? "✓ SAVED" : "+ ADD PAIR"} color={saved ? "green" : "cyan"} onClick={addPair} />
      </div>
      {msg && <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--amber)", marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

// ── Main Settings page ───────────────────────────────────────
// ── Database Backup Section ───────────────────────────────────
function BackupSection() {
  const [backups, setBackups]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [backing, setBacking]   = useState(false);
  const [msg,     setMsg2]      = useState("");

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/admin/backups`);
      if (r.ok) setBackups(await r.json());
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const createBackup = async () => {
    setBacking(true); setMsg2("");
    try {
      const r = await apiFetch(`${API}/admin/backup`);
      const d = await r.json();
      if (r.ok) {
        setMsg2(`Backup created: ${d.filename} (${d.size_mb} MB)`);
        loadBackups();
      } else {
        setMsg2(`Error: ${d.detail || "failed"}`);
      }
    } catch (e) { setMsg2(`Network error: ${e.message}`); }
    setBacking(false);
  };

  const fmtMtime = (epoch) => {
    if (!epoch) return "—";
    return new Date(epoch * 1000).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <div style={{ marginTop: 24, background: "var(--bg-card)", border: "1px solid var(--border-cyan)", borderRadius: 4, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 12, color: "var(--cyan)", letterSpacing: 2 }}>DATABASE BACKUPS</div>
        <button onClick={createBackup} disabled={backing}
          style={{ padding: "6px 14px", background: "var(--bg-void)", color: "var(--cyan)", border: "1px solid var(--cyan)", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11 }}>
          {backing ? "BACKING UP…" : "BACKUP NOW"}
        </button>
      </div>
      {msg && <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--green)", marginBottom: 10 }}>{msg}</div>}
      {loading ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>Loading…</div>
      ) : backups.length === 0 ? (
        <div className="empty-state">No backups yet. Click "Backup Now" to create one.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-cyan)" }}>
              {["Filename", "Size", "Created"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "4px 8px", fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{h}</th>
              ))}
              <th style={{ width: 80 }}/>
            </tr>
          </thead>
          <tbody>
            {backups.map(b => (
              <tr key={b.filename} style={{ borderBottom: "1px solid rgba(0,212,255,0.06)" }}>
                <td style={{ padding: "5px 8px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{b.filename}</td>
                <td style={{ padding: "5px 8px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{b.size_mb} MB</td>
                <td style={{ padding: "5px 8px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{fmtMtime(b.created_at)}</td>
                <td style={{ padding: "5px 8px" }}>
                  <a href={`${API}/admin/backups/${b.filename}?token=${getToken()}`}
                     download={b.filename}
                     style={{ fontSize: 10, color: "var(--cyan)", textDecoration: "none", fontFamily: "var(--font-mono)", border: "1px solid var(--border-cyan)", padding: "2px 7px", borderRadius: 2 }}>
                    DL
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Settings() {
  const [msg, setMsg] = useState("");
  const [source, setSource] = useState("0");
  const { results, searching, search } = useVehicleSearch();
  const [plate, setPlate] = useState("");

  // Multi-camera state
  const [cameras, setCameras] = useState([{ id: "service" }]);
  const [newCamId, setNewCamId] = useState("");

  // Exit timeout state
  const [exitTimeout, setExitTimeout] = useState(300);
  const [timeoutSaved, setTimeoutSaved] = useState(false);

  // Load camera list from backend on mount
  useEffect(() => {
    apiFetch(`${API}/cameras`)
      .then((r) => r.json())
      .then((d) => {
        const activeSet = new Set((d.active || []).map(String));
        const ids = new Set(
          [...(d.available || []), ...(d.active || []), "service"].map(String)
        );
        setCameras([...ids].map((id) => ({ id, isActive: activeSet.has(id) })));
      })
      .catch(() => {});
  }, []);

  // Load current exit timeout from backend on mount
  useEffect(() => {
    apiFetch(`${API}/config/exit-timeout`)
      .then((r) => r.json())
      .then((d) => setExitTimeout(d.exit_timeout_seconds ?? 300))
      .catch(() => {});
  }, []);

  const addCamera = () => {
    const id = newCamId.trim();
    if (!id || cameras.find((c) => c.id === id)) return;
    setCameras((prev) => [...prev, { id }]);
    setNewCamId("");
  };

  const removeCamera = (id) => {
    if (id === "service") return;
    setCameras((prev) => prev.filter((c) => c.id !== id));
  };

  const call = async (url, method = "POST") => {
    try {
      const r = await apiFetch(`${API}${url}`, { method });
      const d = await r.json();
      setMsg(JSON.stringify(d));
    } catch (e) {
      setMsg("Error: " + e.message);
    }
  };

  const setLegacySource = async () => {
    try {
      const r = await apiFetch(`${API}/camera/service/source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const d = await r.json();
      setMsg(JSON.stringify(d));
    } catch (e) {
      setMsg("Error: " + e.message);
    }
  };

  const saveExitTimeout = async () => {
    try {
      const r = await apiFetch(`${API}/config/exit-timeout`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: exitTimeout }),
      });
      if (r.ok) {
        setTimeoutSaved(true);
        setTimeout(() => setTimeoutSaved(false), 2000);
      }
    } catch {}
  };

  const inputStyle = {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid var(--border-cyan)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    padding: "6px 10px",
    borderRadius: "2px",
    outline: "none",
  };

  return (
    <div
      style={{
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        overflowY: "auto",
        height: "100%",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "14px",
          color: "var(--cyan)",
          letterSpacing: "0.1em",
        }}
      >
        SYSTEM CONFIGURATION
      </div>

      {/* ── DEFAULT PASSWORD WARNING ── */}
      {parseJwt(getToken() || "")?.sub === "admin" && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.5)",
          borderLeft: "4px solid var(--amber)", borderRadius: 4, padding: "12px 16px",
        }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 11, color: "var(--amber)", letterSpacing: 1, marginBottom: 3 }}>
              DEFAULT ADMIN ACCOUNT DETECTED
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
              You are logged in as <strong style={{ color: "var(--amber)" }}>admin</strong> — the default system account.
              Change the password below and create named operator accounts for your team. Do not use this account for day-to-day operations.
            </div>
          </div>
          <a href="#user-mgmt" style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--amber)",
            border: "1px solid rgba(255,184,0,0.4)", borderRadius: 2,
            padding: "3px 10px", textDecoration: "none", whiteSpace: "nowrap",
          }}>Change Password ↓</a>
        </div>
      )}

      {/* ── USER MANAGEMENT ── */}
      <div id="user-mgmt">
        <UserManagement inputStyle={inputStyle} />
      </div>

      {/* ── MULTI-CAMERA MANAGEMENT ── */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-cyan)",
          borderRadius: "4px",
          padding: "16px",
        }}
      >
        <div className="panel-title" style={{ marginBottom: "14px" }}>
          CAMERA MANAGEMENT
        </div>

        {cameras.map((cam) => (
          <CameraRow key={cam.id} camId={cam.id} isActive={cam.isActive} onRemove={removeCamera} />
        ))}

        {/* Add new camera */}
        <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
          <input
            value={newCamId}
            onChange={(e) => setNewCamId(e.target.value)}
            placeholder="New camera ID  e.g. entrance"
            onKeyDown={(e) => e.key === "Enter" && addCamera()}
            style={{ ...inputStyle, flex: 1 }}
          />
          <CmdBtn label="+ ADD CAMERA" onClick={addCamera} />
        </div>
      </div>

      {/* ── EXIT TIMEOUT (legacy) ── */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid rgba(255,184,0,0.3)",
          borderRadius: "4px",
          padding: "16px",
          opacity: 0.75,
        }}
      >
        <div className="panel-title" style={{ marginBottom: "6px", color: "var(--amber)" }}>
          VEHICLE EXIT TIMEOUT <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: "normal", marginLeft: 8 }}>LEGACY · DISABLED</span>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--amber)", marginBottom: "8px" }}>
          ⚠ Auto-exit has been disabled. Sessions now close only on real exit-camera detection or admin close. This setting is stored but not used.
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginBottom: "12px" }}>
          Previously: seconds of no detection before a vehicle was auto-marked EXITED.
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <input
            type="range"
            min={30}
            max={3600}
            step={30}
            value={exitTimeout}
            onChange={(e) => setExitTimeout(Number(e.target.value))}
            style={{ flex: 1, accentColor: "var(--amber)" }}
          />
          <input
            type="number"
            min={30}
            max={3600}
            value={exitTimeout}
            onChange={(e) => setExitTimeout(Math.max(30, Number(e.target.value)))}
            style={{ ...inputStyle, width: "80px", textAlign: "center" }}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", minWidth: "16px" }}>s</span>
          <CmdBtn
            label={timeoutSaved ? "✓ SAVED" : "SAVE"}
            color={timeoutSaved ? "green" : "amber"}
            onClick={saveExitTimeout}
          />
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginTop: "8px" }}>
          Current: {exitTimeout}s ({(exitTimeout / 60).toFixed(1)} min)
        </div>
      </div>

      {/* ── ADJACENT CAMERA PAIRS ── */}
      <AdjacentCamerasPanel cameras={cameras} />

      {/* ── QUICK CONTROLS (legacy service camera) ── */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-cyan)",
          borderRadius: "4px",
          padding: "16px",
        }}
      >
        <div className="panel-title" style={{ marginBottom: "14px" }}>
          QUICK CONTROLS (service camera)
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <CmdBtn label="▶ START" color="green" onClick={() => call("/camera/service/start")} />
          <CmdBtn label="■ STOP" color="red" onClick={() => call("/camera/service/stop")} />
          <CmdBtn label="ℹ STATUS" onClick={() => call("/camera/current", "GET")} />
        </div>
      </div>

      {/* ── LIVE FEED SOURCE ── */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-cyan)",
          borderRadius: "4px",
          padding: "16px",
        }}
      >
        <div className="panel-title" style={{ marginBottom: "14px" }}>
          LIVE FEED SOURCE
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>
          Sets both the LIVE page MJPEG stream and the service camera ANPR source.
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="0 or rtsp://... or http://..."
            style={{ ...inputStyle, flex: 1 }}
          />
          <CmdBtn label="SET SOURCE" onClick={setLegacySource} />
        </div>
      </div>

      {/* ── PLATE SEARCH ── */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-cyan)",
          borderRadius: "4px",
          padding: "16px",
        }}
      >
        <div className="panel-title" style={{ marginBottom: "14px" }}>
          SEARCH PLATE HISTORY
        </div>
        <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="Enter plate e.g. WB02"
            onKeyDown={(e) => e.key === "Enter" && search(plate)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <CmdBtn label={searching ? "SEARCHING..." : "SEARCH"} onClick={() => search(plate)} />
        </div>
        {results.map((d) => (
          <div key={d.id} className="det-card" style={{ marginBottom: "6px" }}>
            <span className="det-plate">{d.plate_number}</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--text-muted)",
                marginLeft: "10px",
              }}
            >
              {new Date(d.timestamp).toLocaleString()} · {Math.round(d.confidence * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* ── API RESPONSE LOG ── */}
      {msg && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--green)",
            background: "rgba(0,255,136,0.04)",
            border: "1px solid var(--border-green)",
            borderRadius: "4px",
            padding: "10px 14px",
          }}
        >
          ✓ {msg}
        </div>
      )}

      {/* ── AUDIT LOG — admin only ── */}
      {parseJwt(getToken() || "")?.role === "admin"
        ? <AuditLogSection />
        : (
          <div className="admin-only-notice" style={{ marginTop: "16px" }}>
            ⚠ Audit log requires Administrator access.
          </div>
        )
      }

      {/* ── DATABASE BACKUPS — admin only ── */}
      {parseJwt(getToken() || "")?.role === "admin"
        ? <BackupSection />
        : (
          <div className="admin-only-notice" style={{ marginTop: "16px" }}>
            ⚠ Database backups require Administrator access.
          </div>
        )
      }
    </div>
  );
}


// ── Audit Log section (appended after existing Settings content) ─────────────
function AuditLogSection() {
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [days,    setDays]    = useState(7);
  const [userFlt, setUserFlt] = useState("");
  const [actFlt,  setActFlt]  = useState("");
  const [actions, setActions] = useState([]);

  const SEL = {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid var(--border-cyan)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    padding: "4px 8px",
    borderRadius: "2px",
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days, limit: 100 });
      if (userFlt) params.set("username", userFlt);
      if (actFlt)  params.set("action",   actFlt);
      const [logsRes, actRes] = await Promise.all([
        apiFetch(`${API}/audit?${params}`),
        apiFetch(`${API}/audit/actions`),
      ]);
      if (logsRes.ok) { const d = await logsRes.json(); setLogs(d.items || []); setTotal(d.total || 0); }
      if (actRes.ok)  setActions(await actRes.json());
    } catch { /* backend offline */ }
    finally { setLoading(false); }
  }, [days, userFlt, actFlt]);

  useEffect(() => { load(); }, [load]);

  const ACTION_COLOR = {
    LOGIN:              "var(--green)",
    ANOMALY_ACK:        "var(--amber)",
    ANOMALY_RESOLVE:    "var(--green)",
    ANOMALY_FP:         "var(--purple)",
    BLACKLIST_ADD:      "var(--red)",
    BLACKLIST_REMOVE:   "var(--cyan)",
    USER_CREATE:        "var(--green)",
    USER_DELETE:        "var(--red)",
    USER_ROLE_CHANGE:   "var(--amber)",
    CAMERA_START:       "var(--green)",
    CAMERA_STOP:        "var(--red)",
  };

  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" }) : "—";

  return (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border-cyan)",
      borderRadius: "4px",
      padding: "16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="panel-title">AUDIT LOG</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {total} record{total !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={days} onChange={e => setDays(+e.target.value)} style={SEL}>
          <option value={1}>Today</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <select value={actFlt} onChange={e => setActFlt(e.target.value)} style={SEL}>
          <option value="">All Actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          value={userFlt}
          onChange={e => setUserFlt(e.target.value)}
          placeholder="Filter user…"
          style={{ ...SEL, width: 120 }}
        />
        <button onClick={load} style={{ ...SEL, cursor: "pointer", color: "var(--cyan)", borderColor: "var(--border-cyan)" }}>
          ↺ Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>Loading…</div>
      ) : logs.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>No audit records in this range.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "rgba(0,212,255,0.05)" }}>
                {["TIME", "USER", "ACTION", "RESOURCE", "IP"].map(h => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "var(--cyan)", fontSize: 10, fontFamily: "var(--font-display)", letterSpacing: 1, borderBottom: "1px solid var(--border-cyan)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} style={{ borderBottom: "1px solid rgba(0,212,255,0.05)" }}>
                  <td style={{ padding: "5px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmtTime(l.created_at)}</td>
                  <td style={{ padding: "5px 10px", color: "var(--text-secondary)" }}>{l.username || "—"}</td>
                  <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                    <span style={{
                      color: ACTION_COLOR[l.action] || "var(--text-primary)",
                      fontWeight: 700, letterSpacing: 0.5,
                    }}>{l.action}</span>
                  </td>
                  <td style={{ padding: "5px 10px", color: "var(--text-muted)" }}>
                    {l.resource_type && l.resource_id
                      ? `${l.resource_type}: ${l.resource_id}`
                      : l.resource_type || "—"}
                  </td>
                  <td style={{ padding: "5px 10px", color: "var(--text-muted)" }}>{l.ip_address || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
