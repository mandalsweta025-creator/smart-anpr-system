import { useState, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { logout, getUsername, getUserRole, isAdminOrOp } from "../../store/dashboardStore";

const ADMIN_MENUS = [
  {
    label: "MONITOR",
    items: [
      { label: "Dashboard",   to: "/",          icon: "⬛" },
      { label: "Live Feed",   to: "/live",       icon: "📹" },
      { label: "Sessions",    to: "/sessions",   icon: "🅿️" },
    ],
  },
  {
    label: "ANALYTICS",
    items: [
      { label: "Statistics",  to: "/analytics",  icon: "📈" },
    ],
  },
  {
    label: "MANAGEMENT",
    items: [
      { label: "Vehicle Registry", to: "/registry", icon: "🚗" },
      { label: "Alerts",           to: "/alerts",   icon: "⛔" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { label: "Configuration", to: "/settings", icon: "⚙️" },
    ],
  },
];

const ROLE_COLORS = {
  admin:    { bg: "rgba(255,45,85,0.18)",    border: "rgba(255,45,85,0.5)",    text: "#ff2d55" },
  operator: { bg: "rgba(255,184,0,0.18)",    border: "rgba(255,184,0,0.5)",    text: "#ffb800" },
  user:     { bg: "rgba(0,212,255,0.18)",    border: "rgba(0,212,255,0.4)",    text: "#00d4ff" },
};

function RoleBadge({ role }) {
  const c = ROLE_COLORS[role] || ROLE_COLORS.user;
  const label = role === "user" ? "OWNER" : role.toUpperCase();
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 3, fontSize: 10,
      fontFamily: "var(--font-mono)", letterSpacing: "0.1em",
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    }}>{label}</span>
  );
}

function DropMenu({ menu, onClose }) {
  return (
    <div className="tb-dropdown">
      {menu.items.map(item => (
        <NavLink key={item.to + item.label} to={item.to}
                 className="tb-drop-item" onClick={onClose}>
          <span className="tb-drop-icon">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem("anpr_theme") !== "light");
  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("anpr_theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("light-mode", !next);
  };
  return [dark, toggle];
}

export default function Topbar({ onHamburger, portalMode = false }) {
  const [time, setTime]       = useState(new Date());
  const [openMenu, setOpenMenu] = useState(null);
  const [dark, toggleTheme]   = useTheme();
  const navRef = useRef(null);
  const username = getUsername();
  const role     = getUserRole();

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  const ss = String(time.getSeconds()).padStart(2, "0");
  const dateStr = time.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <header className="topbar">
      {/* ── LEFT: BRAND ── */}
      <div className="tb-brand">
        <div className="tb-emblem">
          <svg viewBox="0 0 40 40" width="36" height="36">
            <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,184,0,0.75)" strokeWidth="1.5"/>
            <circle cx="20" cy="20" r="12" fill="none" stroke="rgba(255,184,0,0.35)" strokeWidth="1"/>
            {[0,45,90,135,180,225,270,315].map(deg => (
              <line key={deg}
                x1={20 + 12*Math.cos(deg*Math.PI/180)} y1={20 + 12*Math.sin(deg*Math.PI/180)}
                x2={20 + 18*Math.cos(deg*Math.PI/180)} y2={20 + 18*Math.sin(deg*Math.PI/180)}
                stroke="rgba(255,184,0,0.6)" strokeWidth="1.5"/>
            ))}
            <text x="20" y="23.5" textAnchor="middle"
                  fontFamily="Orbitron,monospace" fontSize="7.5" fontWeight="900"
                  fill="rgba(255,184,0,0.95)">CIL</text>
          </svg>
        </div>
        <div className="tb-brand-text">
          <div className="tb-org">Coal India Limited</div>
          <div className="tb-dept">
            {portalMode ? "Vehicle Owner Portal" : "Smart ANPR Intelligence Platform"}
          </div>
        </div>
        <div className="tb-divider"/>
      </div>

      {/* ── CENTER: NAV (admin/op only) ── */}
      {!portalMode && isAdminOrOp() && (
        <nav className="tb-nav" ref={navRef}>
          {ADMIN_MENUS.map(menu => (
            <div key={menu.label} className="tb-nav-item"
                 onMouseEnter={() => setOpenMenu(menu.label)}
                 onMouseLeave={() => setOpenMenu(null)}>
              <button className={`tb-nav-btn${openMenu === menu.label ? " active" : ""}`}
                      onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}>
                {menu.label}
                <span className="tb-arrow">{openMenu === menu.label ? "▲" : "▾"}</span>
              </button>
              {openMenu === menu.label && (
                <DropMenu menu={menu} onClose={() => setOpenMenu(null)}/>
              )}
            </div>
          ))}
        </nav>
      )}

      {/* ── RIGHT: USER INFO + CLOCK + LOGOUT ── */}
      <div className="tb-right">
        {username && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              color: "var(--text-secondary)", letterSpacing: "0.06em",
            }}>
              {username}
            </span>
            <RoleBadge role={role} />
          </div>
        )}
        <div className="tb-status">
          <div className="pulse-dot"/>
          SYSTEM ACTIVE
        </div>
        <div className="tb-clock">
          <div className="tb-time">{hh}:{mm}:{ss}</div>
          <div className="tb-date">{dateStr}</div>
        </div>
        <button
          onClick={toggleTheme}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            background: "none", border: "1px solid var(--border-cyan)",
            borderRadius: 3, cursor: "pointer", padding: "4px 8px",
            fontSize: 14, color: "var(--text-secondary)", lineHeight: 1,
          }}
        >
          {dark ? "☀" : "🌙"}
        </button>
        <button className="tb-logout" onClick={logout} title="Sign out">⏻</button>
      </div>

      {/* ── HAMBURGER (mobile) ── */}
      <button className="tb-hamburger" onClick={onHamburger} aria-label="Menu">
        <span/><span/><span/>
      </button>
    </header>
  );
}
