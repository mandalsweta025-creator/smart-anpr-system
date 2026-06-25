import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import NexusDashboard from "../layout/NexusDashboard";
import PortalShell from "../layout/PortalShell";
import Dashboard from "../pages/Dashboard";
import LiveMonitor from "../pages/LiveMonitor";
import Analytics from "../pages/Analytics";
import Registry from "../pages/Registry";
import Sessions from "../pages/Sessions";
import Settings from "../pages/Settings";
import Alerts from "../pages/Alerts";
import CameraHealth from "../pages/CameraHealth";
import Anomalies from "../pages/Anomalies";
import Search from "../pages/Search";
import Reports from "../pages/Reports";
import Login from "../pages/Login";
import Register from "../pages/Register";
import UserDashboard from "../pages/portal/UserDashboard";
import MyVehicles from "../pages/portal/MyVehicles";
import MyActivity from "../pages/portal/MyActivity";
import MyAnalytics from "../pages/portal/MyAnalytics";
import VehicleSearch from "../pages/portal/VehicleSearch";
import StartupSequence from "../components/StartupSequence";
import { isAuthenticated, isAdminOrOp, isVehicleOwner } from "../store/dashboardStore";

// Any authenticated user — redirect to /login if not
function PrivateRoute({ children }) {
  const location = useLocation();
  if (!isAuthenticated()) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

// Admin/operator only — vehicle owners bounce to /portal
function AdminRoute({ children }) {
  const location = useLocation();
  if (!isAuthenticated()) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (isVehicleOwner()) return <Navigate to="/portal" replace />;
  return children;
}

// Authenticated user going to /portal — all roles can access
function PortalRoute({ children }) {
  const location = useLocation();
  if (!isAuthenticated()) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function AppRouter() {
  const [splashDone, setSplashDone] = useState(false);

  return (
    <>
      <AnimatePresence>
        {!splashDone && (
          <StartupSequence onDone={() => setSplashDone(true)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {splashDone && (
          <motion.div
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            style={{ position: "fixed", inset: 0 }}
          >
            <BrowserRouter>
              <Routes>
                {/* ── Public ── */}
                <Route path="/login"    element={<Login />} />
                <Route path="/register" element={<Register />} />

                {/* ── Vehicle Owner Portal ── */}
                <Route path="/portal" element={
                  <PortalRoute><PortalShell /></PortalRoute>
                }>
                  <Route index element={<UserDashboard />} />
                  <Route path="vehicles" element={<MyVehicles />} />
                  <Route path="activity" element={<MyActivity />} />
                  <Route path="analytics" element={<MyAnalytics />} />
                  <Route path="search"   element={<VehicleSearch />} />
                  <Route path="*" element={<Navigate to="/portal" replace />} />
                </Route>

                {/* ── Admin / Operator ── */}
                <Route path="/" element={
                  <AdminRoute><NexusDashboard /></AdminRoute>
                }>
                  <Route index element={<Dashboard />} />
                  <Route path="live"      element={<LiveMonitor />} />
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="sessions"  element={<Sessions />} />
                  <Route path="search"    element={<Search />} />
                  <Route path="reports"   element={<Reports />} />
                  <Route path="alerts"     element={<Alerts />} />
                  <Route path="anomalies" element={<Anomalies />} />
                  <Route path="cameras"   element={<CameraHealth />} />
                  <Route path="registry"  element={<Registry />} />
                  <Route path="settings"  element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
