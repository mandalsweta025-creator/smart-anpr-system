import { useState, useCallback, useEffect } from "react";
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { authFetch, API } from "../../store/dashboardStore";

async function downloadMonthlyReport() {
  const res = await authFetch(`${API}/me/report/monthly`);
  if (!res.ok) { alert("Failed to generate report"); return; }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `my_monthly_report_${new Date().toISOString().slice(0, 7)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CHART_STYLE = {
  background: "transparent",
  fontFamily: "'Rajdhani', sans-serif",
};

function ChartCard({ title, sub, children, actions }) {
  return (
    <div className="portal-chart-card">
      <div className="portal-chart-header">
        <div>
          <div className="portal-chart-title">{title}</div>
          {sub && <div className="portal-chart-sub">{sub}</div>}
        </div>
        {actions && <div className="portal-chart-actions">{actions}</div>}
      </div>
      <div className="portal-chart-body">{children}</div>
    </div>
  );
}

function CustomTooltip({ active, payload, label, unit = "visits" }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="portal-tooltip">
      <div className="portal-tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="portal-tooltip-row" style={{ color: p.color }}>
          {p.name}: <strong>{p.value}</strong> {unit}
        </div>
      ))}
    </div>
  );
}

function StatRow({ label, value, pct }) {
  return (
    <div className="portal-stat-row">
      <span className="portal-stat-row-label">{label}</span>
      <span className="portal-stat-row-value">{value}</span>
      {pct != null && (
        <div className="portal-stat-row-bar-wrap">
          <div className="portal-stat-row-bar" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function MyAnalytics() {
  const [daily,   setDaily]   = useState([]);
  const [weekly,  setWeekly]  = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading]  = useState(true);
  const [dailyDays,   setDailyDays]   = useState(30);
  const [weeklyWeeks, setWeeklyWeeks] = useState(12);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, w, m, t] = await Promise.all([
        authFetch(`${API}/me/analytics/daily?days=${dailyDays}`).then(r => r.json()),
        authFetch(`${API}/me/analytics/weekly?weeks=${weeklyWeeks}`).then(r => r.json()),
        authFetch(`${API}/me/analytics/monthly?months=12`).then(r => r.json()),
        authFetch(`${API}/me/analytics/timeline?days=14`).then(r => r.json()),
      ]);
      setDaily(d);
      setWeekly(w);
      setMonthly(m);
      setTimeline(t);
    } finally {
      setLoading(false);
    }
  }, [dailyDays, weeklyWeeks]);

  useEffect(() => { load(); }, [load]);

  const totalMonthly  = monthly.reduce((s, r) => s + r.count, 0);
  const maxMonthly    = Math.max(...monthly.map(r => r.count), 1);
  const totalDuration = monthly.reduce((s, r) => s + (r.duration_min || 0), 0);
  const avgDuration   = totalMonthly > 0 ? totalDuration / totalMonthly : 0;

  const peakDay = [...daily].sort((a, b) => b.count - a.count)[0];

  if (loading) return (
    <div className="portal-loading"><div className="portal-spinner"/><div>Loading analytics…</div></div>
  );

  return (
    <div className="portal-page">
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">My Analytics</h1>
          <p className="portal-page-sub">Detailed statistics and trends for your vehicles</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="portal-btn-outline" onClick={downloadMonthlyReport}>
            📄 Download Monthly Report
          </button>
          <button className="portal-btn-outline" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="portal-stats-row">
        <div className="portal-stat-card">
          <div className="portal-stat-value color-cyan">{totalMonthly}</div>
          <div className="portal-stat-label">Visits (12 months)</div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-value color-green">
            {monthly.filter(m => m.count > 0).length}
          </div>
          <div className="portal-stat-label">Active Months</div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-value color-amber">
            {avgDuration > 0 ? `${Math.round(avgDuration)}m` : "—"}
          </div>
          <div className="portal-stat-label">Avg. Duration / Visit</div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-value color-purple">
            {peakDay?.count > 0 ? peakDay.count : 0}
          </div>
          <div className="portal-stat-label">Peak Day Visits</div>
          <div className="portal-stat-sub">{peakDay?.count > 0 ? peakDay.label : "—"}</div>
        </div>
      </div>

      {/* ── Charts row 1 ── */}
      <div className="portal-charts-grid">
        {/* Daily bar chart */}
        <ChartCard
          title="Daily Visits"
          sub={`Last ${dailyDays} days`}
          actions={
            <select className="portal-filter-select" style={{ width: 130 }}
              value={dailyDays} onChange={e => setDailyDays(Number(e.target.value))}>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          }>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily} style={CHART_STYLE} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,212,255,0.1)" vertical={false}/>
              <XAxis dataKey="label" tick={{ fill: "#8ab4d4", fontSize: 10 }}
                tickLine={false} axisLine={false}
                interval={Math.floor(daily.length / 8)} />
              <YAxis tick={{ fill: "#8ab4d4", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false}/>
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Visits" fill="#00d4ff" fillOpacity={0.8} radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Entry/Exit Timeline */}
        <ChartCard title="Entry / Exit Timeline" sub="Last 14 days">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timeline} style={CHART_STYLE} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="entryGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#00ff88" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="exitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#00d4ff" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,212,255,0.1)" vertical={false}/>
              <XAxis dataKey="label" tick={{ fill: "#8ab4d4", fontSize: 10 }} tickLine={false} axisLine={false}/>
              <YAxis tick={{ fill: "#8ab4d4", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false}/>
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#8ab4d4" }} />
              <Area type="monotone" dataKey="entries" name="Entries" stroke="#00ff88" strokeWidth={2}
                fill="url(#entryGrad)" dot={false}/>
              <Area type="monotone" dataKey="exits" name="Exits" stroke="#00d4ff" strokeWidth={2}
                fill="url(#exitGrad)" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="portal-charts-grid">
        {/* Weekly bar */}
        <ChartCard
          title="Weekly Visits"
          sub={`Last ${weeklyWeeks} weeks`}
          actions={
            <select className="portal-filter-select" style={{ width: 130 }}
              value={weeklyWeeks} onChange={e => setWeeklyWeeks(Number(e.target.value))}>
              <option value={8}>Last 8 weeks</option>
              <option value={12}>Last 12 weeks</option>
              <option value={26}>Last 26 weeks</option>
              <option value={52}>Last 52 weeks</option>
            </select>
          }>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekly} style={CHART_STYLE} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,212,255,0.1)" vertical={false}/>
              <XAxis dataKey="label" tick={{ fill: "#8ab4d4", fontSize: 10 }} tickLine={false} axisLine={false}/>
              <YAxis tick={{ fill: "#8ab4d4", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false}/>
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Visits" fill="#b347ff" fillOpacity={0.8} radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Monthly line */}
        <ChartCard title="Monthly Trend" sub="Last 12 months">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthly} style={CHART_STYLE} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,212,255,0.1)" vertical={false}/>
              <XAxis dataKey="label" tick={{ fill: "#8ab4d4", fontSize: 10 }} tickLine={false} axisLine={false}/>
              <YAxis tick={{ fill: "#8ab4d4", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false}/>
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="count" name="Visits" stroke="#ffb800" strokeWidth={2}
                dot={{ fill: "#ffb800", r: 3 }} activeDot={{ r: 5 }}/>
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── Monthly breakdown table ── */}
      <ChartCard title="Monthly Breakdown" sub="Visits and parking duration per month">
        <div style={{ maxHeight: 280, overflowY: "auto" }}>
          {monthly.map(m => (
            <StatRow key={m.month} label={m.label}
              value={`${m.count} visit${m.count !== 1 ? "s" : ""}`}
              pct={maxMonthly > 0 ? (m.count / maxMonthly) * 100 : 0}
            />
          ))}
        </div>
      </ChartCard>
    </div>
  );
}
