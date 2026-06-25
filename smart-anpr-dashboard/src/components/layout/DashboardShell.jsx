import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function DashboardShell({ children }) {
  return (
    <div className="shell">
      <Sidebar />

      <div className="content">
        <Topbar />

        <main className="dashboard-content">
          {children}
        </main>
      </div>
    </div>
  );
}