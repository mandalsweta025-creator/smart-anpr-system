import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

const data = [
  {
    name: "Blacklisted",
    value: 12,
  },
  {
    name: "Suspicious",
    value: 18,
  },
  {
    name: "Authorized",
    value: 70,
  },
];

const COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
];

export default function AlertChart() {
  return (
    <div className="chart-panel">
      <div className="chart-header">
        <div>
          <p className="chart-label">
            SECURITY ANALYTICS
          </p>

          <h2 className="chart-title">
            Vehicle Alert Distribution
          </h2>
        </div>

        <div className="live-indicator">
          <span className="pulse-dot"></span>
          LIVE
        </div>
      </div>

      <div className="chart-wrapper">
        <ResponsiveContainer
          width="100%"
          height={320}
        >
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={5}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>

            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="alert-stats">
        <div className="alert-card danger">
          <h3>12</h3>
          <p>Blacklisted</p>
        </div>

        <div className="alert-card warning">
          <h3>18</h3>
          <p>Suspicious</p>
        </div>

        <div className="alert-card success">
          <h3>70</h3>
          <p>Authorized</p>
        </div>
      </div>
    </div>
  );
}