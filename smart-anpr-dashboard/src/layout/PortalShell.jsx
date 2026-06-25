import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import Topbar from "../components/layout/Topbar";
import { logout, isAdminOrOp } from "../store/dashboardStore";
import "../styles/nexus.css";

const PORTAL_NAV = [
  { to: "/portal",           end: true, icon: "🏠", label: "Dashboard" },
  { to: "/portal/vehicles",  icon: "🚗", label: "My Vehicles" },
  { to: "/portal/activity",  icon: "📋", label: "Activity" },
  { to: "/portal/analytics", icon: "📊", label: "Analytics" },
  { to: "/portal/search",    icon: "🔍", label: "Search" },
];

function PortalSidebar({ open, onClose }) {
  const navigate = useNavigate();

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`portal-sidebar${open ? " portal-sidebar-open" : ""}`}>
        <button className="sidebar-close" onClick={onClose}>✕</button>

        <div className="portal-sidebar-header">
          <div className="portal-sidebar-icon">🏛</div>
          <div className="portal-sidebar-title">My Portal</div>
        </div>

        <nav className="portal-nav">
          {PORTAL_NAV.map(({ to, end, icon, label }) => (
            <NavLink key={to} to={to} end={end} onClick={onClose}
              className={({ isActive }) => `portal-nav-item${isActive ? " active" : ""}`}>
              <span className="portal-nav-icon">{icon}</span>
              <span className="portal-nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="portal-sidebar-footer">
          {isAdminOrOp() && (
            <button className="portal-switch-btn" onClick={() => navigate("/")}>
              ⬛ Admin Panel
            </button>
          )}
          <button className="portal-logout-btn" onClick={logout}>
            ⏻ Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

export default function PortalShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <div className="bg-grid"/>
      <div className="bg-radial"/>
      <div className="portal-aurora"/>
      <div className="scanline"/>

      <Topbar
        onHamburger={() => setSidebarOpen(o => !o)}
        portalMode={true}
      />

      <div className="shell">
        <PortalSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="main-content portal-main">
          <Outlet />
        </main>
      </div>
    </>
  );
}
