import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import "../styles/nexus.css";

export default function NexusDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      {/* Animated background layers */}
      <div className="bg-grid"/>
      <div className="bg-radial"/>
      <div className="bg-aurora"/>
      <div className="scanline"/>

      <Topbar onHamburger={() => setSidebarOpen(o => !o)}/>

      <div className="shell">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)}/>
        <main className="main-content">
          <Outlet/>
        </main>
      </div>
    </>
  );
}
