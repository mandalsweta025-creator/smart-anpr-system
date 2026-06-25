import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

// ── Fixed network topology (no Math.random → stable renders) ──
const NODES = [
  { id: 0, x: 50, y: 50 },  // Core AI
  { id: 1, x: 24, y: 22 },  // Cam-1
  { id: 2, x: 76, y: 22 },  // Cam-2
  { id: 3, x: 12, y: 56 },  // OCR
  { id: 4, x: 88, y: 56 },  // YOLO
  { id: 5, x: 28, y: 82 },  // DB
  { id: 6, x: 72, y: 82 },  // Auth
  { id: 7, x: 50, y: 12 },  // Net
  { id: 8, x: 50, y: 88 },  // Alert
];

const EDGES = [
  [0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],
  [1,3],[2,4],[3,5],[4,6],[5,8],[6,8],[7,1],[7,2],
];

// ── Boot log ──────────────────────────────────────────────────
const LOG = [
  { tag: "CORE", text: "Neural processing unit",     val: "READY",   green: false },
  { tag: "NET",  text: "Camera node mesh [3/3]",      val: "LINKED",  green: false },
  { tag: "AI",   text: "YOLO v8 detection engine",    val: "LOADED",  green: false },
  { tag: "OCR",  text: "License plate pipeline",      val: "ACTIVE",  green: false },
  { tag: "DB",   text: "Vehicle registry database",   val: "245 REC", green: false },
  { tag: "ENC",  text: "AES-256 encryption layer",    val: "ENABLED", green: true  },
  { tag: "AUTH", text: "Security credential check",   val: "✓ PASS",  green: true  },
  { tag: "LIVE", text: "SURVEILLANCE SYSTEM",         val: "ONLINE",  green: true  },
];

// ── Phase timeline ─────────────────────────────────────────────
// 0 ms  → black screen
// 100   → phase 1: header
// 500   → phase 2: neural network
// 1100  → phase 3: boot log (8 × 165 ms = 1 320 ms, done ≈ 2 420 ms)
// 2 450 → phase 4: SYSTEMS ONLINE line
// 2 750 → phase 5: progress bar fill
// 3 150 → exit fade starts (0.55 s)
// 3 700 → onDone()

export default function StartupSequence({ onDone }) {
  const [phase,    setPhase]    = useState(0);
  const [logCount, setLogCount] = useState(0);
  const [exiting,  setExiting]  = useState(false);
  const logStarted = useRef(false);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1),                        100),
      setTimeout(() => setPhase(2),                        500),
      setTimeout(() => setPhase(3),                       1100),
      setTimeout(() => setPhase(4),                       2450),
      setTimeout(() => setPhase(5),                       2750),
      setTimeout(() => { setPhase(6); setExiting(true); },3150),
      setTimeout(() => onDone(),                          3700),
    ];
    return () => t.forEach(clearTimeout);
  }, [onDone]);

  // Boot-log counter — starts once when phase reaches 3, never resets
  useEffect(() => {
    if (phase < 3 || logStarted.current) return;
    logStarted.current = true;
    let n = 0;
    const iv = setInterval(() => {
      n++;
      setLogCount(n);
      if (n >= LOG.length) clearInterval(iv);
    }, 165);
    return () => clearInterval(iv);
  }, [phase]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#000",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-mono)",
      overflow: "hidden",
      opacity: exiting ? 0 : 1,
      transition: exiting ? "opacity 0.55s ease" : "none",
    }}>

      {/* CRT scanline texture */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px)",
      }} />

      {/* Subtle cyan radial glow at center */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(0,40,80,0.25) 0%, transparent 70%)",
      }} />

      {/* ── CONTENT ── */}
      <div style={{ position: "relative", zIndex: 2, width: "min(580px, 92vw)", padding: "0 12px" }}>

        {/* Phase 1 — Header */}
        {phase >= 1 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
            style={{ textAlign: "center", marginBottom: "clamp(18px, 3vh, 28px)" }}
          >
            <div style={{
              fontSize: "clamp(7px, 1.4vw, 9px)",
              color: "rgba(0,212,255,0.32)",
              letterSpacing: "0.32em",
              marginBottom: 10,
            }}>
              COAL INDIA LIMITED · CLASSIFIED SYSTEM
            </div>

            <div style={{
              fontSize: "clamp(14px, 2.6vw, 22px)",
              fontWeight: 700,
              color: "rgba(0,212,255,0.92)",
              letterSpacing: "0.22em",
              lineHeight: 1.2,
            }}>
              ANPR INTELLIGENCE PLATFORM
            </div>

            <div style={{
              fontSize: "clamp(6px, 1.1vw, 8px)",
              color: "rgba(0,212,255,0.22)",
              letterSpacing: "0.2em",
              marginTop: 6,
            }}>
              v2.0.0 · AUTHORIZED PERSONNEL ONLY · AES-256 SECURED
            </div>
          </motion.div>
        )}

        {/* Phase 2 — Neural-network graph */}
        {phase >= 2 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            style={{
              width: "min(220px, 52vw)",
              height: "min(132px, 31vw)",
              margin: "0 auto clamp(18px,3vh,28px)",
            }}
          >
            <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", overflow: "visible" }}>

              {/* Edges draw in */}
              {EDGES.map(([a, b], i) => (
                <motion.path
                  key={`e${a}-${b}`}
                  d={`M${NODES[a].x} ${NODES[a].y} L${NODES[b].x} ${NODES[b].y}`}
                  stroke="rgba(0,212,255,0.18)"
                  strokeWidth="0.4"
                  fill="none"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, delay: i * 0.042, ease: "easeOut" }}
                />
              ))}

              {/* Core pulse rings */}
              {[0, 1, 2].map(i => (
                <motion.circle key={`pr${i}`}
                  cx={50} cy={50} r={3}
                  fill="none"
                  stroke="rgba(0,212,255,0.22)"
                  strokeWidth="0.35"
                  initial={{ scale: 1, opacity: 0.55 }}
                  animate={{ scale: 7, opacity: 0 }}
                  transition={{ duration: 2, delay: i * 0.65, repeat: Infinity, ease: "easeOut" }}
                  style={{ transformOrigin: "50px 50px", transformBox: "view-box" }}
                />
              ))}

              {/* Nodes */}
              {NODES.map((n, i) => {
                const isCore = n.id === 0;
                return (
                  <motion.g key={n.id}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.22, delay: 0.08 + i * 0.055, ease: "backOut" }}
                    style={{ transformOrigin: `${n.x}px ${n.y}px`, transformBox: "view-box" }}
                  >
                    {/* Outer ring */}
                    <circle
                      cx={n.x} cy={n.y}
                      r={isCore ? 4.2 : 2.4}
                      fill={isCore ? "rgba(0,212,255,0.12)" : "none"}
                      stroke={isCore ? "rgba(0,212,255,0.85)" : "rgba(0,212,255,0.5)"}
                      strokeWidth={isCore ? "0.65" : "0.5"}
                    />
                    {/* Center dot */}
                    <circle
                      cx={n.x} cy={n.y}
                      r={isCore ? 1.6 : 0.9}
                      fill={isCore ? "rgba(0,212,255,1)" : "rgba(0,212,255,0.75)"}
                    />
                  </motion.g>
                );
              })}
            </svg>
          </motion.div>
        )}

        {/* Phase 3 — Boot log */}
        <div style={{ minHeight: "clamp(108px,22vh,148px)" }}>
          {LOG.slice(0, logCount).map((line, i) => {
            const isLast = i === LOG.length - 1;
            return (
              <motion.div key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.1 }}
                style={{
                  display: "flex", alignItems: "center", gap: "clamp(5px,1.2vw,10px)",
                  marginBottom: isLast ? 0 : 3,
                  background: isLast ? "rgba(0,255,136,0.04)" : "transparent",
                  borderRadius: isLast ? 2 : 0,
                  padding: isLast ? "2px 0" : 0,
                }}
              >
                {/* Tag badge */}
                <span style={{
                  fontSize: "clamp(6px,1.2vw,8px)", letterSpacing: "0.1em",
                  color: line.green ? "rgba(0,255,136,0.85)" : "rgba(0,212,255,0.65)",
                  background: line.green ? "rgba(0,255,136,0.09)" : "rgba(0,212,255,0.08)",
                  border: `1px solid ${line.green ? "rgba(0,255,136,0.22)" : "rgba(0,212,255,0.2)"}`,
                  padding: "1px 5px", borderRadius: 1,
                  minWidth: "clamp(30px,5vw,40px)", textAlign: "center", flexShrink: 0,
                }}>
                  {line.tag}
                </span>

                {/* Label */}
                <span style={{
                  flex: 1,
                  fontSize: "clamp(8px,1.5vw,10px)",
                  color: isLast ? "rgba(0,255,136,0.8)" : "rgba(160,205,230,0.65)",
                  letterSpacing: "0.05em",
                  fontWeight: isLast ? 600 : 400,
                  overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                }}>
                  {line.text}
                </span>

                {/* Dots spacer */}
                <span style={{
                  fontSize: "clamp(7px,1.1vw,8px)",
                  color: "rgba(0,212,255,0.12)", flexShrink: 0,
                  letterSpacing: "0.08em",
                }}>··········</span>

                {/* Status value */}
                <span style={{
                  fontSize: "clamp(8px,1.5vw,10px)", fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: line.green ? "var(--green)" : "var(--cyan)",
                  textShadow: line.green ? "0 0 10px rgba(0,255,136,0.55)" : "none",
                  minWidth: "clamp(42px,7vw,56px)", textAlign: "right", flexShrink: 0,
                }}>
                  {line.val}
                </span>
              </motion.div>
            );
          })}
        </div>

        {/* Phase 4 — ALL SYSTEMS ONLINE */}
        {phase >= 4 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            style={{
              borderTop: "1px solid rgba(0,255,136,0.2)",
              paddingTop: 9, marginTop: 6,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}
          >
            <span style={{
              fontSize: "clamp(9px,1.8vw,12px)", fontWeight: 700,
              color: "var(--green)", letterSpacing: "0.2em",
              textShadow: "0 0 14px rgba(0,255,136,0.5)",
            }}>
              ● ALL SYSTEMS ONLINE
            </span>
            <span style={{
              fontSize: "clamp(6px,1.1vw,8px)",
              color: "rgba(0,255,136,0.38)", letterSpacing: "0.14em",
            }}>
              SURVEILLANCE ACTIVE
            </span>
          </motion.div>
        )}

        {/* Phase 5 — Progress bar to 100% */}
        {phase >= 5 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            style={{ marginTop: 10 }}
          >
            <div style={{
              height: 2, background: "rgba(0,212,255,0.08)",
              borderRadius: 1, overflow: "hidden",
            }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 0.33, ease: "easeOut" }}
                style={{
                  height: "100%", borderRadius: 1,
                  background: "linear-gradient(90deg, var(--cyan), var(--green))",
                  boxShadow: "0 0 8px rgba(0,212,255,0.45)",
                }}
              />
            </div>
            <div style={{
              textAlign: "right", marginTop: 3,
              fontSize: "clamp(6px,1vw,7px)",
              color: "rgba(0,212,255,0.22)", letterSpacing: "0.14em",
            }}>
              LOADING DASHBOARD...
            </div>
          </motion.div>
        )}

      </div>
    </div>
  );
}
