import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { API, parseJwt } from "../store/dashboardStore";

const CIL_SPOKES = [0, 45, 90, 135, 180, 225, 270, 315];

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from ?? null;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("username", username);
      form.append("password", password);
      const res = await fetch(`${API}/auth/login`, { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Invalid credentials");
      }
      const data = await res.json();
      localStorage.setItem("anpr_token", data.access_token);

      // Role-based redirect
      const role = data.role || parseJwt(data.access_token)?.role;
      if (role === "user") {
        navigate(from && from.startsWith("/portal") ? from : "/portal", { replace: true });
      } else {
        navigate(from && !from.startsWith("/portal") ? from : "/", { replace: true });
      }
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="bg-grid" />
      <div className="bg-radial" />
      <div className="scanline" />

      <div className="login-container">
        {/* CIL emblem */}
        <div className="login-emblem">
          <svg viewBox="0 0 56 56" width="56" height="56">
            <circle cx="28" cy="28" r="26" fill="none" stroke="rgba(255,184,0,0.8)" strokeWidth="1.5" />
            <circle cx="28" cy="28" r="18" fill="none" stroke="rgba(255,184,0,0.35)" strokeWidth="1" />
            {CIL_SPOKES.map((deg) => (
              <line key={deg}
                x1={28 + 18 * Math.cos((deg * Math.PI) / 180)}
                y1={28 + 18 * Math.sin((deg * Math.PI) / 180)}
                x2={28 + 26 * Math.cos((deg * Math.PI) / 180)}
                y2={28 + 26 * Math.sin((deg * Math.PI) / 180)}
                stroke="rgba(255,184,0,0.6)" strokeWidth="1.5"
              />
            ))}
            <text x="28" y="33" textAnchor="middle"
              fontFamily="Orbitron,monospace" fontSize="10" fontWeight="900"
              fill="rgba(255,184,0,0.95)">CIL</text>
          </svg>
        </div>

        <div className="login-org">Coal India Limited</div>
        <div className="login-title">SMART ANPR SYSTEM</div>
        <div className="login-subtitle">Intelligence Platform · Secure Access</div>

        <div className="login-divider" />

        <form className="login-form" onSubmit={handleLogin}>
          <div className="login-field">
            <label className="login-label">USERNAME</label>
            <input className="login-input" type="text" value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username" autoComplete="username" required />
          </div>

          <div className="login-field">
            <label className="login-label">PASSWORD</label>
            <input className="login-input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password" autoComplete="current-password" required />
          </div>

          {error && <div className="login-error">⚠ {error}</div>}

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? "AUTHENTICATING…" : "ACCESS SYSTEM"}
          </button>
        </form>

        <div className="login-register-link">
          Vehicle owner?{" "}
          <Link to="/register" className="login-register-anchor">
            Register your account
          </Link>
        </div>

        <div className="login-footer">
          SECURED SYSTEM · COAL INDIA LIMITED · v2.0
        </div>
        <div className="login-hint">
          First login? Default: <code>admin</code> / <code>Admin@1234</code>
        </div>
      </div>
    </div>
  );
}
