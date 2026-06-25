import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { API } from "../store/dashboardStore";

export default function Register() {
  const [form, setForm]     = useState({ username: "", email: "", password: "", confirm: "" });
  const [error, setError]   = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Registration failed");
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="bg-grid" />
      <div className="bg-radial" />
      <div className="scanline" />

      <div className="login-container" style={{ maxWidth: 420 }}>
        <div className="login-emblem">
          <svg viewBox="0 0 56 56" width="48" height="48">
            <circle cx="28" cy="28" r="26" fill="none" stroke="rgba(0,212,255,0.7)" strokeWidth="1.5"/>
            <circle cx="28" cy="28" r="18" fill="none" stroke="rgba(0,212,255,0.3)" strokeWidth="1"/>
            <text x="28" y="33" textAnchor="middle"
              fontFamily="Orbitron,monospace" fontSize="9" fontWeight="900"
              fill="rgba(0,212,255,0.9)">CIL</text>
          </svg>
        </div>

        <div className="login-org">Coal India Limited</div>
        <div className="login-title" style={{ fontSize: 18 }}>VEHICLE OWNER PORTAL</div>
        <div className="login-subtitle">Create your account · Access your vehicle history</div>

        <div className="login-divider" />

        {success ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
            <div style={{ color: "var(--green)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
              Account created successfully!
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8 }}>
              Redirecting to login…
            </div>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit}>
            <div className="login-field">
              <label className="login-label">USERNAME</label>
              <input className="login-input" type="text" value={form.username}
                onChange={set("username")} placeholder="Choose a username"
                autoComplete="username" required minLength={3} />
            </div>

            <div className="login-field">
              <label className="login-label">EMAIL ADDRESS</label>
              <input className="login-input" type="email" value={form.email}
                onChange={set("email")} placeholder="your@email.com"
                autoComplete="email" required />
            </div>

            <div className="login-field">
              <label className="login-label">PASSWORD</label>
              <input className="login-input" type="password" value={form.password}
                onChange={set("password")} placeholder="Min. 6 characters"
                autoComplete="new-password" required minLength={6} />
            </div>

            <div className="login-field">
              <label className="login-label">CONFIRM PASSWORD</label>
              <input className="login-input" type="password" value={form.confirm}
                onChange={set("confirm")} placeholder="Repeat password"
                autoComplete="new-password" required />
            </div>

            {error && <div className="login-error">⚠ {error}</div>}

            <button className="login-btn" type="submit" disabled={loading}
              style={{ background: "linear-gradient(135deg,rgba(0,212,255,0.25),rgba(0,212,255,0.1))" }}>
              {loading ? "CREATING ACCOUNT…" : "CREATE ACCOUNT"}
            </button>
          </form>
        )}

        <div className="login-register-link" style={{ marginTop: 16 }}>
          Already have an account?{" "}
          <Link to="/login" className="login-register-anchor">Sign in</Link>
        </div>

        <div className="login-footer">
          VEHICLE OWNER PORTAL · COAL INDIA LIMITED · v2.0
        </div>
      </div>
    </div>
  );
}
