import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const data = [
  {
    time: "06 AM",
    detections: 24,
  },
  {
    time: "08 AM",
    detections: 41,
  },
  {
    time: "10 AM",
    detections: 58,
  },
  {
    time: "12 PM",
    detections: 76,
  },
  {
    time: "02 PM",
    detections: 64,
  },
  {
    time: "04 PM",
    detections: 82,
  },
  {
    time: "06 PM",
    detections: 97,
  },
];

export default function DetectionChart() {
  return (
    <div className="chart-panel">
      <div className="chart-header">
        <div>
          <p className="chart-label">
            LIVE DETECTION ANALYTICS
          </p>

          <h2 className="chart-title">
            Vehicle Detection Activity
          </h2>
        </div>

        <div className="live-indicator">
          <span className="pulse-dot"></span>
          ACTIVE
        </div>
      </div>

      <div className="chart-wrapper">
        <ResponsiveContainer
          width="100%"
          height={340}
        >
          <AreaChart data={data}>
            <defs>
              <linearGradient
                id="detectionGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="#38bdf8"
                  stopOpacity={0.8}
                />

                <stop
                  offset="95%"
                  stopColor="#38bdf8"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.08)"
            />

            <XAxis
              dataKey="time"
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

            <Area
              type="monotone"
              dataKey="detections"
              stroke="#38bdf8"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#detectionGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="detection-summary">
        <div className="summary-card">
          <p>Total Vehicles</p>
          <h3>442</h3>
        </div>

        <div className="summary-card">
          <p>Peak Gate</p>
          <h3>Gate 3</h3>
        </div>

        <div className="summary-card">
          <p>Detection Accuracy</p>
          <h3>97.8%</h3>
        </div>
      </div>
    </div>
  );
}