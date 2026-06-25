import { NavLink } from "react-router-dom";
import { useAnomalyBadge } from "../../store/dashboardStore";

const NAV = [
  { to: "/",          end: true, icon: "⬛", label: "DASHBOARD" },
  { to: "/live",      icon: "📹", label: "LIVE FEED"  },
  { to: "/analytics", icon: "📈", label: "ANALYTICS"  },
  { to: "/sessions",  icon: "🅿️", label: "SESSIONS"   },
  { to: "/search",    icon: "🔍", label: "SEARCH"     },
  { to: "/alerts",    icon: "⛔", label: "ALERTS"     },
  { to: "/anomalies", icon: "⚠️", label: "ANOMALIES"  },
  { to: "/cameras",   icon: "📡", label: "CAMERAS"    },
  { to: "/registry",  icon: "🚗", label: "REGISTRY"   },
  { to: "/reports",   icon: "📄", label: "REPORTS"    },
  { to: "/settings",  icon: "⚙️", label: "CONFIG"     },
];

export default function Sidebar({ open, onClose }) {
  const anomalyCounts = useAnomalyBadge();

  return (
    <>
      {/* Overlay backdrop — mobile only */}
      {open && <div className="sidebar-backdrop" onClick={onClose}/>}

      <aside className={`sidebar${open ? " sidebar-open" : ""}`}>
        {/* Mobile close button */}
        <button className="sidebar-close" onClick={onClose}>✕</button>

        {/* CIL mini badge */}
        <div className="sidebar-badge">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(255,184,0,0.6)" strokeWidth="1.5"/>
            {[0,60,120,180,240,300].map(deg => (
              <line key={deg}
                x1={16 + 9*Math.cos(deg*Math.PI/180)}
                y1={16 + 9*Math.sin(deg*Math.PI/180)}
                x2={16 + 14*Math.cos(deg*Math.PI/180)}
                y2={16 + 14*Math.sin(deg*Math.PI/180)}
                stroke="rgba(255,184,0,0.5)" strokeWidth="1.5"/>
            ))}
            <text x="16" y="19" textAnchor="middle"
                  fontFamily="Orbitron,monospace" fontSize="6" fontWeight="900"
                  fill="rgba(255,184,0,0.85)">CIL</text>
          </svg>
        </div>

        <div className="nav-divider"/>

        {NAV.map(({ to, end, icon, label }) => {
          const isAnomalies = to === "/anomalies";
          const badgeCount  = isAnomalies ? anomalyCounts.total_open : 0;
          const badgeColor  = anomalyCounts.critical > 0
            ? "var(--red)"
            : anomalyCounts.high > 0
            ? "var(--amber)"
            : "var(--red)";

          return (
            <NavLink key={to + label} to={to} end={end} onClick={onClose}
                     className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                     style={{ textDecoration: "none", color: "inherit", position: "relative" }}>
              <span className="nav-icon">{icon}</span>
              <span className="nav-label">{label}</span>
              {isAnomalies && badgeCount > 0 && (
                <span style={{
                  position: "absolute", top: 4, right: 6,
                  background: badgeColor,
                  color: "#fff",
                  borderRadius: "10px",
                  fontSize: "9px",
                  fontWeight: 900,
                  minWidth: "16px",
                  height: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                  fontFamily: "var(--font-display)",
                  boxShadow: `0 0 6px ${badgeColor}`,
                  animation: anomalyCounts.critical > 0 ? "pulse-badge 2s infinite" : "none",
                }}>
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </NavLink>
          );
        })}

        <div className="nav-spacer"/>

        {/* System status indicator */}
        <div className="sys-status">
          <div className="sys-dot online" title="System Online"/>
          <div className="sys-dot warn" title="Camera Active"/>
        </div>
      </aside>
    </>
  );
}
