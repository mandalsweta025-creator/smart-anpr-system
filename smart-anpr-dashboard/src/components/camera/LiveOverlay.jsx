import "./../../styles/nexus.css";

function LiveOverlay({
  plate = "WB06A4321",
  confidence = "98%",
  gate = "Gate 3",
  status = "LIVE",
  alert = false,
}) {
  return (
    <div className="live-overlay">
      <div className="overlay-top">
        <span className="live-badge">{status}</span>

        <span className="gate-name">
          Coal India • {gate}
        </span>
      </div>

      <div className="scan-box"></div>

      <div className="overlay-bottom">
        <div>
          <p className="overlay-label">
            DETECTED PLATE
          </p>

          <h2 className="plate-text">
            {plate}
          </h2>
        </div>

        <div className="confidence-box">
          <p>OCR Confidence</p>
          <h3>{confidence}</h3>
        </div>
      </div>

      {alert && (
        <div className="alert-banner">
          ⚠ Blacklisted Vehicle Detected
        </div>
      )}
    </div>
  );
}

export default LiveOverlay;