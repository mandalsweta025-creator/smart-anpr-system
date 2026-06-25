import "../../styles/nexus.css";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const data = [
  {
    gate: "Gate 1",
    vehicles: 120,
  },
  {
    gate: "Gate 2",
    vehicles: 210,
  },
  {
    gate: "Gate 3",
    vehicles: 340,
  },
  {
    gate: "Gate 4",
    vehicles: 180,
  },
  {
    gate: "Gate 5",
    vehicles: 270,
  },
  {
    gate: "Gate 6",
    vehicles: 390,
  },
];

export default function VehicleTrendChart() {
  return (
    <div className="trend-chart-panel">
      <div className="trend-chart-header">
        <div>
          <p className="trend-chart-label">
            GATE SURVEILLANCE ANALYTICS
          </p>

          <h2 className="trend-chart-title">
            Vehicle Traffic Trend
          </h2>
        </div>

        <div className="trend-live-status">
          <span className="trend-pulse-dot"></span>
          MONITORING
        </div>
      </div>

      <div className="trend-chart-wrapper">
        <ResponsiveContainer
          width="100%"
          height={340}
        >
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.08)"
            />

            <XAxis
              dataKey="gate"
              stroke="#94a3b8"
            />

            <YAxis stroke="#94a3b8" />

            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "14px",
                color: "white",
              }}
            />

            <Line
              type="monotone"
              dataKey="vehicles"
              stroke="#00e5ff"
              strokeWidth={4}
              dot={{
                r: 6,
                fill: "#00e5ff",
              }}
              activeDot={{
                r: 10,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="trend-summary-grid">
        <div className="trend-summary-card">
          <p>Highest Traffic</p>
          <h3>Gate 6</h3>
        </div>

        <div className="trend-summary-card">
          <p>Vehicles Today</p>
          <h3>1510</h3>
        </div>

        <div className="trend-summary-card">
          <p>Peak Hour</p>
          <h3>06 PM</h3>
        </div>
      </div>
    </div>
  );
}