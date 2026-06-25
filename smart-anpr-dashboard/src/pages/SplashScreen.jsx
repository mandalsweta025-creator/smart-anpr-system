import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const PLATE = "WB02W1169";
const SPOKES = [0, 60, 120, 180, 240, 300];

// ── Reusable wheel ────────────────────────────────────────────────────────────
function Wheel({ cx, cy, r }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="#030310" stroke="rgba(0,212,255,0.65)" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={r * 0.69} fill="#07091a" stroke="rgba(0,212,255,0.25)" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={r * 0.17} fill="rgba(0,212,255,0.18)" stroke="rgba(0,212,255,0.6)" strokeWidth="1" />
      {SPOKES.map(a => (
        <line key={a}
          x1={cx + r * 0.22 * Math.cos(a * Math.PI / 180)}
          y1={cy + r * 0.22 * Math.sin(a * Math.PI / 180)}
          x2={cx + r * 0.63 * Math.cos(a * Math.PI / 180)}
          y2={cy + r * 0.63 * Math.sin(a * Math.PI / 180)}
          stroke="rgba(0,212,255,0.32)" strokeWidth="1.5" strokeLinecap="round" />
      ))}
    </>
  );
}

// ── Car silhouette (sedan side-view, facing right, rear plate on left) ────────
function CarSVG() {
  return (
    <svg viewBox="0 0 800 265" xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="spl-body" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="rgba(0,212,255,0.04)" />
          <stop offset="40%"  stopColor="rgba(0,212,255,0.13)" />
          <stop offset="100%" stopColor="rgba(0,212,255,0.04)" />
        </linearGradient>
        <filter id="spl-glow">
          <feGaussianBlur stdDeviation="1.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* ── Body ── */}
      <path
        d="M 66,224 L 66,188 L 94,157 L 142,122 L 244,97 L 508,92 L 600,113 L 678,151 L 720,186 L 720,224 Z"
        fill="url(#spl-body)" stroke="rgba(0,212,255,0.7)" strokeWidth="1.5"
        strokeLinejoin="round" filter="url(#spl-glow)" />

      {/* ── Cabin / windows ── */}
      <path
        d="M 160,184 L 177,132 L 216,103 L 498,98 L 562,119 L 592,184 Z"
        fill="rgba(0,212,255,0.02)" stroke="rgba(0,212,255,0.38)" strokeWidth="1" />

      {/* A / B / C pillars */}
      <line x1="177" y1="132" x2="160" y2="184" stroke="rgba(0,212,255,0.42)" strokeWidth="2" />
      <line x1="358" y1="94"  x2="358" y2="184" stroke="rgba(0,212,255,0.28)" strokeWidth="1.5" />
      <line x1="500" y1="98"  x2="562" y2="119" stroke="rgba(0,212,255,0.42)" strokeWidth="2" />

      {/* Door seam */}
      <line x1="102" y1="184" x2="692" y2="184"
            stroke="rgba(0,212,255,0.16)" strokeWidth="0.8" strokeDasharray="5,5" />
      <line x1="358" y1="184" x2="358" y2="224"
            stroke="rgba(0,212,255,0.14)" strokeWidth="0.8" />

      {/* Side mirror */}
      <path d="M 582,127 L 602,125 L 605,135 L 582,136 Z"
            fill="rgba(0,212,255,0.05)" stroke="rgba(0,212,255,0.48)" strokeWidth="0.9" />

      {/* Headlight */}
      <path d="M 708,157 L 717,170 L 717,184 L 708,183 Z"
            fill="rgba(255,220,100,0.06)" stroke="rgba(255,220,100,0.7)" strokeWidth="1" />
      <line x1="695" y1="162" x2="715" y2="162"
            stroke="rgba(255,220,100,0.5)" strokeWidth="1.5" />

      {/* Tail light */}
      <rect x="66" y="158" width="12" height="24" rx="2"
            fill="rgba(255,45,85,0.06)" stroke="rgba(255,45,85,0.7)" strokeWidth="1" />

      {/* Front bumper plate slot */}
      <rect x="695" y="203" width="20" height="14" rx="1"
            fill="rgba(0,0,0,0.4)" stroke="rgba(0,212,255,0.25)" strokeWidth="0.6" />

      {/* ── REAR PLATE — scan target ── */}
      <rect x="67" y="199" width="54" height="18" rx="1.5"
            fill="#f2f0e2" stroke="#ffb800" strokeWidth="1.5" />
      <text x="94" y="211" textAnchor="middle"
            fill="#18120a" fontSize="7.5" fontWeight="bold" letterSpacing="0.8"
            fontFamily="'Courier New', 'Lucida Console', monospace">
        WB02W1169
      </text>

      {/* Wheels */}
      <Wheel cx={615} cy={232} r={36} />
      <Wheel cx={183} cy={232} r={36} />

      {/* Ground line + glow */}
      <line x1="58" y1="250" x2="742" y2="250"
            stroke="rgba(0,212,255,0.1)" strokeWidth="1" />
      <ellipse cx="390" cy="252" rx="292" ry="5"
               fill="rgba(0,212,255,0.025)" />
    </svg>
  );
}

// ── HUD corners + leader-line overlay (shares viewBox with CarSVG) ────────────
function HUDOverlay({ showHUD, scanning, plateLocked }) {
  const s = { stroke: "rgba(0,212,255,0.92)", strokeWidth: "1.5", fill: "none" };
  // Bounding box around rear plate (67-121, 199-217) + generous margin
  const [x1, y1, x2, y2] = [50, 188, 136, 230];
  const mx = (x1 + x2) / 2;   // ≈ 93
  const my = (y1 + y2) / 2;   // ≈ 209
  const L  = 14;

  return (
    <svg viewBox="0 0 800 265"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <AnimatePresence>
        {showHUD && (
          <motion.g
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}>

            {/* Corner brackets */}
            <path d={`M ${x1+L},${y1} L ${x1},${y1} L ${x1},${y1+L}`} {...s} />
            <path d={`M ${x2-L},${y1} L ${x2},${y1} L ${x2},${y1+L}`} {...s} />
            <path d={`M ${x1},${y2-L} L ${x1},${y2} L ${x1+L},${y2}`} {...s} />
            <path d={`M ${x2-L},${y2} L ${x2},${y2} L ${x2},${y2-L}`} {...s} />

            {/* Centre crosshair */}
            <circle cx={mx} cy={my} r="2" fill="rgba(0,212,255,0.6)" />
            <line x1={mx-7} y1={my} x2={mx+7} y2={my} stroke="rgba(0,212,255,0.45)" strokeWidth="0.8" />
            <line x1={mx} y1={my-7} x2={mx} y2={my+7} stroke="rgba(0,212,255,0.45)" strokeWidth="0.8" />

            {/* SCANNING label (pulses) */}
            {scanning && !plateLocked && (
              <motion.text x={mx} y={y1 - 5} textAnchor="middle"
                fill="rgba(0,212,255,0.8)" fontSize="6" fontFamily="monospace"
                animate={{ opacity: [1, 0.25, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}>
                SCANNING
              </motion.text>
            )}

            {/* PLATE LOCKED label */}
            {plateLocked && (
              <motion.text x={mx} y={y1 - 5} textAnchor="middle"
                fill="rgba(255,184,0,0.95)" fontSize="6" fontFamily="monospace"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                PLATE LOCKED
              </motion.text>
            )}

            {/* Leader line pointing toward display area */}
            {plateLocked && (
              <motion.polyline
                points={`${x2},${my} 220,${my} 220,70`}
                stroke="rgba(0,212,255,0.28)" strokeWidth="0.8" fill="none" strokeDasharray="3,3"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: 0.5 }} />
            )}
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  );
}

// ── Single stat panel ─────────────────────────────────────────────────────────
function Panel({ label, value, accent, delay }) {
  const colors = {
    cyan:  { border: "rgba(0,212,255,0.22)",  bg: "rgba(0,212,255,0.05)",  text: "#00d4ff" },
    amber: { border: "rgba(255,184,0,0.38)",  bg: "rgba(255,184,0,0.06)",  text: "#ffb800" },
    green: { border: "rgba(0,255,136,0.3)",   bg: "rgba(0,255,136,0.05)",  text: "#00ff88" },
    red:   { border: "rgba(255,45,85,0.38)",  bg: "rgba(255,45,85,0.06)",  text: "#ff2d55" },
  };
  const c = colors[accent] || colors.cyan;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: "easeOut" }}
      style={{
        flex: 1, border: `1px solid ${c.border}`, background: c.bg,
        borderRadius: "4px", padding: "10px 14px", textAlign: "center", minWidth: 0,
      }}>
      <div style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: "8px",
                    color: "rgba(120,160,200,0.45)", letterSpacing: "0.1em", marginBottom: "6px" }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: "15px",
                    color: c.text, letterSpacing: "0.08em" }}>
        {value}
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SplashScreen({ onComplete }) {
  const [showCar,      setShowCar]      = useState(false);
  const [showScan,     setShowScan]     = useState(false);
  const [showHUD,      setShowHUD]      = useState(false);
  const [scanning,     setScanning]     = useState(false);
  const [plateChars,   setPlateChars]   = useState("");
  const [plateLocked,  setPlateLocked]  = useState(false);
  const [showData,     setShowData]     = useState(false);
  const [status,       setStatus]       = useState("OFFLINE");
  const [statusAccent, setStatusAccent] = useState("red");
  const [exiting,      setExiting]      = useState(false);

  useEffect(() => {
    const timers = [];
    const t = (ms, fn) => { timers.push(setTimeout(fn, ms)); };

    t(150,  () => setShowCar(true));
    t(900,  () => setShowScan(true));
    t(1350, () => { setShowHUD(true); setScanning(true); });

    // Type plate character by character
    PLATE.split("").forEach((ch, i) => {
      t(1850 + i * 90, () => setPlateChars(p => p + ch));
    });

    const plateEnd = 1850 + PLATE.length * 90;
    t(plateEnd + 80,  () => { setScanning(false); setPlateLocked(true); });
    t(plateEnd + 300, () => setShowData(true));

    // Status flicker: OFFLINE → ACTIVE
    t(plateEnd + 700, () => setStatus("···"));
    t(plateEnd + 850, () => setStatus("OFFLINE"));
    t(plateEnd + 950, () => setStatus("···"));
    t(plateEnd + 1100,() => { setStatus("ACTIVE"); setStatusAccent("green"); });

    t(plateEnd + 1800, () => setExiting(true));
    t(plateEnd + 2400, () => onComplete());

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55 }}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "#020409",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "24px 20px", overflow: "hidden",
          }}>

          {/* Background layers (reuse app classes) */}
          <div className="bg-grid"  style={{ opacity: 0.25 }} />
          <div className="bg-radial" style={{ opacity: 0.5 }} />

          {/* ── Top bar ─────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", maxWidth: "820px", marginBottom: "18px",
            }}>
            <span style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: "9px",
                           color: "rgba(0,212,255,0.45)", letterSpacing: "0.14em" }}>
              CIL — COAL INDIA LIMITED
            </span>
            <span style={{ fontFamily: "'Orbitron',monospace", fontSize: "12px",
                           color: "rgba(0,212,255,0.9)", letterSpacing: "0.18em" }}>
              SMART ANPR SYSTEM
            </span>
            {/* Status badge */}
            <div style={{ display: "flex", alignItems: "center", gap: "7px",
                          fontFamily: "'Share Tech Mono',monospace", fontSize: "9px",
                          letterSpacing: "0.12em",
                          color: statusAccent === "green" ? "#00ff88" : "#ff2d55" }}>
              <motion.div
                animate={statusAccent === "green"
                  ? { opacity: [1, 0.25, 1], scale: [1, 1.3, 1] }
                  : {}}
                transition={{ duration: 1.2, repeat: Infinity }}
                style={{
                  width: "7px", height: "7px", borderRadius: "50%",
                  background: statusAccent === "green" ? "#00ff88" : "#ff2d55",
                  boxShadow: statusAccent === "green"
                    ? "0 0 8px rgba(0,255,136,0.8)"
                    : "0 0 6px rgba(255,45,85,0.6)",
                }} />
              {status}
            </div>
          </motion.div>

          {/* ── Car scene ────────────────────────────────── */}
          <div style={{ width: "100%", maxWidth: "820px", position: "relative" }}>
            <AnimatePresence>
              {showCar && (
                <motion.div
                  initial={{ x: "55%", opacity: 0 }}
                  animate={{ x: 0,     opacity: 1 }}
                  transition={{ duration: 0.85, ease: [0.18, 0.85, 0.28, 1] }}
                  style={{ position: "relative" }}>

                  <CarSVG />

                  {/* Scan beam (absolutely positioned over the car) */}
                  <AnimatePresence>
                    {showScan && (
                      <motion.div
                        style={{
                          position: "absolute", left: "8%", right: "9%",
                          top: "34%", height: "2px", pointerEvents: "none",
                          background: "linear-gradient(90deg, transparent 0%, rgba(0,212,255,0.95) 25%, rgba(0,212,255,0.95) 75%, transparent 100%)",
                          boxShadow: "0 0 12px rgba(0,212,255,0.75), 0 0 28px rgba(0,212,255,0.4)",
                        }}
                        initial={{ y: 0, opacity: 0 }}
                        animate={{ y: 145, opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 0.7, ease: "linear", times: [0, 0.07, 0.93, 1] }} />
                    )}
                  </AnimatePresence>

                  {/* HUD overlay */}
                  <HUDOverlay showHUD={showHUD} scanning={scanning} plateLocked={plateLocked} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Plate display ─────────────────────────────── */}
          <div style={{ width: "100%", maxWidth: "820px", minHeight: "42px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        marginTop: "6px" }}>
            <AnimatePresence>
              {plateChars && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ display: "flex", alignItems: "center", gap: "14px" }}>

                  <span style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: "9px",
                                 color: "rgba(0,212,255,0.5)", letterSpacing: "0.12em" }}>
                    DETECTED PLATE
                  </span>

                  {/* Plate visual */}
                  <div style={{
                    background: "#f2f0e2",
                    border: "2.5px solid #ffb800",
                    borderRadius: "5px",
                    padding: "4px 18px",
                    fontFamily: "'Courier New','Lucida Console',monospace",
                    fontSize: "24px", fontWeight: "bold",
                    color: "#18120a", letterSpacing: "3.5px",
                    boxShadow: "0 0 18px rgba(255,184,0,0.35), 0 0 36px rgba(255,184,0,0.15)",
                    minWidth: "210px", textAlign: "center",
                    position: "relative",
                  }}>
                    {plateChars}
                    {/* Blinking cursor while typing */}
                    {plateChars.length < PLATE.length && (
                      <motion.span
                        animate={{ opacity: [1, 0] }}
                        transition={{ duration: 0.35, repeat: Infinity }}
                        style={{
                          display: "inline-block", width: "13px", height: "20px",
                          background: "#18120a", verticalAlign: "middle", marginLeft: "2px",
                        }} />
                    )}
                  </div>

                  {plateLocked && (
                    <motion.div
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      style={{ display: "flex", alignItems: "center", gap: "5px",
                               fontFamily: "'Share Tech Mono',monospace", fontSize: "9px",
                               color: "rgba(255,184,0,0.9)", letterSpacing: "0.12em" }}>
                      <motion.div
                        animate={{ scale: [1, 1.4, 1] }}
                        transition={{ duration: 0.3, times: [0, 0.5, 1] }}
                        style={{ width: "5px", height: "5px", borderRadius: "50%",
                                 background: "#ffb800", boxShadow: "0 0 8px rgba(255,184,0,0.8)" }} />
                      LOCKED
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Data panels ───────────────────────────────── */}
          <AnimatePresence>
            {showData && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ display: "flex", gap: "10px", width: "100%",
                         maxWidth: "820px", marginTop: "14px" }}>
                <Panel label="PLATE NUMBER"   value={PLATE}    accent="amber" delay={0}   />
                <Panel label="CONFIDENCE"     value="94.7%"    accent="cyan"  delay={0.1} />
                <Panel label="CAMERA ID"      value="CAM-01"   accent="cyan"  delay={0.2} />
                <Panel label="SYSTEM STATUS"  value={status}   accent={statusAccent} delay={0.3} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Footer ────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 0.3 }}
            transition={{ delay: 0.6 }}
            style={{ marginTop: "20px", fontFamily: "'Share Tech Mono',monospace",
                     fontSize: "7.5px", color: "rgba(0,212,255,0.4)",
                     letterSpacing: "0.12em", textAlign: "center" }}>
            AUTOMATIC NUMBER PLATE RECOGNITION · AI-POWERED SURVEILLANCE · COAL INDIA LIMITED
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
