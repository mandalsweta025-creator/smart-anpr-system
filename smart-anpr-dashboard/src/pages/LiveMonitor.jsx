import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useWebSocket, getStreamURL, getSnapshotURL, API, apiFetch,
  playAlertBeep, playDetectionBeep,
} from "../store/dashboardStore";

// ── Char-by-char typing effect ────────────────────────────────
function useTyping(text, speed = 58) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setProgress(0);
    if (!text) return;
    let i = 0;
    const t = setInterval(() => {
      i++;
      setProgress(i);
      if (i >= text.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [text]);
  return text ? text.slice(0, progress) : "";
}

// ── Smooth count-up for confidence number ─────────────────────
function useCountUp(target, duration = 680) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!target) return;
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const pct = Math.min((ts - start) / duration, 1);
      setVal(Math.round(target * pct));
      if (pct < 1) requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target, duration]);
  return val;
}

// ── Live clock ────────────────────────────────────────────────
function useTick() {
  const [ts, setTs] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTs(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return ts;
}

// ── FPS hook with micro-jitter ────────────────────────────────
function useFps(base = 25) {
  const [fps, setFps] = useState(base);
  useEffect(() => {
    const t = setInterval(() => {
      setFps(base - 1 + Math.floor(Math.random() * 3));
    }, 820);
    return () => clearInterval(t);
  }, [base]);
  return fps;
}

// ── Signal strength bar cluster ───────────────────────────────
function SignalBars({ strength = 4 }) {
  const color = strength >= 4 ? "var(--green)" : strength >= 2 ? "var(--amber)" : "var(--red)";
  const glow  = strength >= 4 ? "rgba(0,255,136,0.55)" : strength >= 2 ? "rgba(255,184,0,0.55)" : "rgba(255,45,85,0.55)";
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:1.5, height:11 }}>
      {[1,2,3,4,5].map(i => (
        <div key={i} style={{
          width:2.5, height:`${i * 20}%`, minHeight:2,
          background: i <= strength ? color : "rgba(255,255,255,0.08)",
          borderRadius:0.5,
          boxShadow: i <= strength ? `0 0 4px ${glow}` : "none",
          transition:"all 0.4s",
        }} />
      ))}
    </div>
  );
}

// ── Tactical zone boundary overlay ───────────────────────────
function ZoneOverlay() {
  return (
    <div style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:2 }}>
      {/* Horizontal zone dividers */}
      <div style={{ position:"absolute", top:"28%", left:0, right:0, height:1,
        background:"repeating-linear-gradient(90deg,rgba(0,212,255,0.13) 0px,rgba(0,212,255,0.13) 5px,transparent 5px,transparent 12px)" }} />
      <div style={{ position:"absolute", top:"70%", left:0, right:0, height:1,
        background:"repeating-linear-gradient(90deg,rgba(0,212,255,0.08) 0px,rgba(0,212,255,0.08) 5px,transparent 5px,transparent 12px)" }} />
      {/* Vertical lane separators (detection zone only) */}
      <div style={{ position:"absolute", top:"28%", bottom:"30%", left:"31%", width:1,
        background:"repeating-linear-gradient(180deg,rgba(0,212,255,0.07) 0px,rgba(0,212,255,0.07) 4px,transparent 4px,transparent 9px)" }} />
      <div style={{ position:"absolute", top:"28%", bottom:"30%", right:"31%", width:1,
        background:"repeating-linear-gradient(180deg,rgba(0,212,255,0.07) 0px,rgba(0,212,255,0.07) 4px,transparent 4px,transparent 9px)" }} />
      {/* Zone labels */}
      <div style={{ position:"absolute", top:"3%", left:10, fontFamily:"var(--font-mono)", fontSize:6.5, color:"rgba(0,212,255,0.19)", letterSpacing:"0.13em" }}>▾ APPROACH ZONE ▾</div>
      <div style={{ position:"absolute", top:"30%", left:10, fontFamily:"var(--font-mono)", fontSize:6.5, color:"rgba(0,212,255,0.17)", letterSpacing:"0.13em" }}>DETECTION ZONE</div>
      <div style={{ position:"absolute", top:"72%", left:10, fontFamily:"var(--font-mono)", fontSize:6.5, color:"rgba(0,255,136,0.13)", letterSpacing:"0.13em" }}>▴ EXIT / CLEAR ZONE ▴</div>
      {/* Grid intersection crosshairs */}
      {[["31%","28%"],["69%","28%"],["31%","70%"],["69%","70%"]].map(([x,y],i) => (
        <div key={i} style={{ position:"absolute", left:x, top:y, transform:"translate(-50%,-50%)", width:7, height:7 }}>
          <div style={{ position:"absolute", top:"50%", left:0, right:0, height:1, background:"rgba(0,212,255,0.22)", marginTop:-0.5 }} />
          <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"rgba(0,212,255,0.22)", marginLeft:-0.5 }} />
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:2.5, height:2.5, borderRadius:"50%", background:"rgba(0,212,255,0.3)" }} />
        </div>
      ))}
      {/* Coordinate labels */}
      {[["31%","28%","A1"],["69%","28%","A2"],["31%","70%","B1"],["69%","70%","B2"]].map(([x,y,lbl]) => (
        <div key={lbl} style={{ position:"absolute", left:x, top:y, transform:"translate(5px,-14px)", fontFamily:"var(--font-mono)", fontSize:5.5, color:"rgba(0,212,255,0.2)" }}>{lbl}</div>
      ))}
    </div>
  );
}

// ── Animated vehicle trajectory paths ─────────────────────────
function TrajectoryLines() {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"
      style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:3 }}>
      {/* Entry paths: top → detection zone */}
      <path d="M34,0 C34,14 36,28 39,44" fill="none" stroke="rgba(0,212,255,0.2)" strokeWidth="0.28" strokeDasharray="2.2,3.2" className="lm-traj-entry" />
      <path d="M63,0 C63,14 61,28 60,44" fill="none" stroke="rgba(0,212,255,0.2)" strokeWidth="0.28" strokeDasharray="2.2,3.2" className="lm-traj-entry" style={{ animationDelay:"0.9s" }} />
      {/* Entry arrowheads */}
      <polygon points="39,46 36,40 42,40" fill="rgba(0,212,255,0.22)" />
      <polygon points="60,46 57,40 63,40" fill="rgba(0,212,255,0.22)" />
      {/* Exit paths: detection zone → bottom */}
      <path d="M40,54 C39,68 36,82 33,100" fill="none" stroke="rgba(0,255,136,0.14)" strokeWidth="0.28" strokeDasharray="2.2,3.2" className="lm-traj-exit" />
      <path d="M60,54 C61,68 64,82 67,100" fill="none" stroke="rgba(0,255,136,0.14)" strokeWidth="0.28" strokeDasharray="2.2,3.2" className="lm-traj-exit" style={{ animationDelay:"1.15s" }} />
      {/* Exit arrowheads */}
      <polygon points="33,97 30,91 36,91" fill="rgba(0,255,136,0.16)" />
      <polygon points="67,97 64,91 70,91" fill="rgba(0,255,136,0.16)" />
    </svg>
  );
}

// ── Detection heat zone gradients ─────────────────────────────
function HeatZones() {
  return (
    <div style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:1 }}>
      {/* Primary hot zone: gate/barrier area */}
      <div className="lm-heat-pulse" style={{
        position:"absolute", left:"50%", top:"48%",
        width:160, height:90, marginLeft:-80, marginTop:-45,
        background:"radial-gradient(ellipse,rgba(255,184,0,0.07) 0%,rgba(255,184,0,0.02) 40%,transparent 72%)",
        borderRadius:"50%",
      }} />
      {/* Approach zone indicator */}
      <div style={{
        position:"absolute", left:"50%", top:"14%",
        width:120, height:60, marginLeft:-60, marginTop:-30,
        background:"radial-gradient(ellipse,rgba(0,212,255,0.04) 0%,transparent 70%)",
        borderRadius:"50%",
      }} />
    </div>
  );
}

// ── Right-edge threat level meter ─────────────────────────────
function ThreatMeter({ level = 1 }) {
  const segs = [
    "rgba(0,255,136,0.7)","rgba(0,255,136,0.6)",
    "rgba(0,212,255,0.65)","rgba(255,184,0,0.75)","rgba(255,45,85,0.85)",
  ];
  return (
    <div style={{ position:"absolute", right:7, top:"50%", transform:"translateY(-50%)", zIndex:7, pointerEvents:"none",
      display:"flex", flexDirection:"column", alignItems:"center", gap:2.5 }}>
      <span style={{ fontFamily:"var(--font-mono)", fontSize:5, color:"rgba(0,212,255,0.28)", letterSpacing:"0.06em",
        writingMode:"vertical-rl", transform:"rotate(180deg)", marginBottom:3 }}>THREAT</span>
      {[...segs].reverse().map((c, i) => {
        const active = (4 - i) < level;
        return (
          <div key={i} style={{ width:5, height:10, borderRadius:1,
            background: active ? c : "rgba(255,255,255,0.04)",
            boxShadow: active ? `0 0 5px ${c}` : "none",
            transition:"all 0.35s" }} />
        );
      })}
      <span style={{ fontFamily:"var(--font-mono)", fontSize:5, color:"rgba(0,212,255,0.22)", marginTop:3, writingMode:"vertical-rl" }}>LVL</span>
    </div>
  );
}

// ── Four corner brackets ──────────────────────────────────────
function Corners({ color, size = 18, thick = 2, inset = 0 }) {
  const h = { position: "absolute", height: thick, width: size, background: color };
  const v = { position: "absolute", width: thick, height: size, background: color };
  return (
    <>
      <div style={{ position: "absolute", top: inset, left: inset }}>
        <div style={{ ...h, top: 0, left: 0 }} /><div style={{ ...v, top: 0, left: 0 }} />
      </div>
      <div style={{ position: "absolute", top: inset, right: inset }}>
        <div style={{ ...h, top: 0, right: 0 }} /><div style={{ ...v, top: 0, right: 0 }} />
      </div>
      <div style={{ position: "absolute", bottom: inset, left: inset }}>
        <div style={{ ...h, bottom: 0, left: 0 }} /><div style={{ ...v, bottom: 0, left: 0 }} />
      </div>
      <div style={{ position: "absolute", bottom: inset, right: inset }}>
        <div style={{ ...h, bottom: 0, right: 0 }} /><div style={{ ...v, bottom: 0, right: 0 }} />
      </div>
    </>
  );
}

// ── Ambient scanning reticle (no active detection) ────────────
function ScanningReticle() {
  return (
    <div style={{
      position: "absolute", zIndex: 3, pointerEvents: "none",
      left: "16%", top: "24%", right: "16%", bottom: "16%",
    }}>
      <div className="lm-scan-box" />
      <Corners color="rgba(0,212,255,0.45)" size={14} thick={1.5} />
      <div style={{
        position: "absolute", top: -1, left: 0, transform: "translateY(-100%)",
        fontFamily: "var(--font-mono)", fontSize: 7.5, letterSpacing: "0.12em",
        color: "rgba(0,212,255,0.5)", borderLeft: "1.5px solid rgba(0,212,255,0.3)",
        paddingLeft: 5,
      }}>
        SCANNING<span className="lm-blink">_</span>
      </div>
      {/* Spinning targeting circle */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 32, height: 32 }}>
        <div className="lm-spin-cw"  style={{ position: "absolute", inset: 0, border: "1px solid rgba(0,212,255,0.2)", borderRadius: "50%" }} />
        <div className="lm-spin-ccw" style={{ position: "absolute", inset: 5,  border: "1px solid rgba(0,212,255,0.35)", borderRadius: "50%", borderTopColor: "transparent" }} />
        <div style={{ position: "absolute", top: "50%", left: "50%", width: 5, height: 5, borderRadius: "50%", background: "rgba(0,212,255,0.65)", transform: "translate(-50%,-50%)", boxShadow: "0 0 8px rgba(0,212,255,0.8)" }} />
      </div>
    </div>
  );
}

// ── Bounding box + plate OCR panel (inside camera feed) ───────
function DetectionOverlay({ detection, isAlert }) {
  const plate  = useTyping(detection?.plate, 58);
  const conf   = Math.round((detection?.confidence || 0) * 100);
  const color  = isAlert ? "var(--red)"           : "var(--green)";
  const glow   = isAlert ? "rgba(255,45,85,0.55)"  : "rgba(0,255,136,0.55)";
  const textC  = isAlert ? "var(--red)"            : "var(--cyan)";
  const textGl = isAlert ? "rgba(255,45,85,0.7)"   : "rgba(0,212,255,0.7)";

  return (
    <AnimatePresence>
      {detection && (
        <>
          {/* Bounding box */}
          <motion.div
            key={`bbox-${detection._id}`}
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{
              position: "absolute", zIndex: 5, pointerEvents: "none",
              left: "15%", top: "22%", right: "15%", bottom: "14%",
              border: `1.5px solid ${color}`,
              background: isAlert ? "rgba(255,45,85,0.04)" : "rgba(0,255,136,0.03)",
              boxShadow: `0 0 16px ${glow}, inset 0 0 30px rgba(0,0,0,0.1)`,
              borderRadius: 2,
            }}
          >
            <Corners color={color} size={22} thick={2.5} />
            {/* Top-left label */}
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 }}
              style={{
                position: "absolute", top: -1, left: -1, transform: "translateY(-100%)",
                fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.12em",
                background: color, color: isAlert ? "white" : "#000", padding: "1px 6px",
              }}
            >
              {isAlert ? "⚠ BLACKLISTED" : "◈ TARGET LOCKED"}
            </motion.div>
            {/* Top-right confidence */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              style={{
                position: "absolute", top: -1, right: -1, transform: "translateY(-100%)",
                fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
                color: conf >= 80 ? "var(--green)" : conf >= 60 ? "var(--amber)" : "var(--red)",
                textShadow: `0 0 8px ${conf >= 80 ? "rgba(0,255,136,0.9)" : "rgba(255,184,0,0.8)"}`,
                padding: "1px 4px",
              }}
            >
              {conf}%
            </motion.div>
            {/* Crosshair */}
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
              <div style={{ width: 24, height: 1.5, background: `${color}55`, position: "absolute", top: 0, left: "50%", transform: "translateX(-50%) translateY(-50%)" }} />
              <div style={{ height: 24, width: 1.5, background: `${color}55`, position: "absolute", left: 0, top: "50%", transform: "translateX(-50%) translateY(-50%)" }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, opacity: 0.85, boxShadow: `0 0 8px ${color}`, position: "relative", zIndex: 1 }} />
            </div>
            {/* AI tracking labels */}
            <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.3 }}
              style={{ position:"absolute", bottom:-1, left:-1, transform:"translateY(100%)",
                fontFamily:"var(--font-mono)", fontSize:7, letterSpacing:"0.08em",
                color:"rgba(0,212,255,0.55)", padding:"1px 5px",
                border:"1px solid rgba(0,212,255,0.16)", borderRadius:1,
                background:"rgba(0,0,0,0.78)" }}>
              TRK#{String(detection._id % 10000).padStart(4,"0")}
            </motion.div>
            <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.38 }}
              style={{ position:"absolute", bottom:-1, right:-1, transform:"translateY(100%)",
                fontFamily:"var(--font-mono)", fontSize:7, letterSpacing:"0.08em",
                color: isAlert ? "rgba(255,45,85,0.6)" : "rgba(0,255,136,0.55)", padding:"1px 5px",
                border:`1px solid ${isAlert ? "rgba(255,45,85,0.16)" : "rgba(0,255,136,0.16)"}`, borderRadius:1,
                background:"rgba(0,0,0,0.78)" }}>
              CLASS: LGT VEH
            </motion.div>
            <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.46 }}
              style={{ position:"absolute", top:-1, left:"50%", transform:"translate(-50%,-100%)",
                fontFamily:"var(--font-mono)", fontSize:7, color:"rgba(0,212,255,0.42)",
                letterSpacing:"0.08em", padding:"1px 5px",
                border:"1px solid rgba(0,212,255,0.14)", borderRadius:1,
                background:"rgba(0,0,0,0.78)" }}>
              ~12 KM/H ›
            </motion.div>
          </motion.div>

          {/* Pulse rings from center */}
          {[0, 1, 2].map(i => (
            <motion.div
              key={`ring-${detection._id}-${i}`}
              initial={{ opacity: 0.75, scale: 0.08 }}
              animate={{ opacity: 0, scale: 2.8 }}
              transition={{ duration: 0.85, delay: i * 0.18, ease: "easeOut" }}
              style={{
                position: "absolute", zIndex: 4, pointerEvents: "none",
                left: "50%", top: "50%",
                width: 90, height: 90, marginLeft: -45, marginTop: -45,
                borderRadius: "50%", border: `1.5px solid ${color}`,
              }}
            />
          ))}

          {/* OCR plate + confidence panel */}
          <motion.div
            key={`panel-${detection._id}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ delay: 0.22, duration: 0.22 }}
            style={{
              position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
              zIndex: 8, pointerEvents: "none",
              background: "rgba(2,4,9,0.92)",
              border: `1.5px solid ${color}`,
              borderRadius: 3, padding: "8px 18px 8px 14px",
              boxShadow: `0 0 24px ${glow}`,
              backdropFilter: "blur(6px)",
              minWidth: 200,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em" }}>PLATE</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, letterSpacing: "0.2em", color: textC, textShadow: `0 0 16px ${textGl}` }}>
                {plate}
                {plate.length < (detection?.plate?.length || 0) && (
                  <span className="lm-blink" style={{ fontSize: 18, color: textC }}>_</span>
                )}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "rgba(180,210,240,0.38)", letterSpacing: "0.1em", flexShrink: 0 }}>OCR CONF</span>
              <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden", minWidth: 80 }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${conf}%` }}
                  transition={{ delay: 0.48, duration: 0.5, ease: "easeOut" }}
                  style={{
                    height: "100%", borderRadius: 2,
                    background: conf >= 80 ? "var(--green)" : conf >= 60 ? "var(--amber)" : "var(--red)",
                    boxShadow: `0 0 5px ${conf >= 80 ? "rgba(0,255,136,0.9)" : "rgba(255,184,0,0.8)"}`,
                  }}
                />
              </div>
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.72 }}
                style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
                  color: conf >= 80 ? "var(--green)" : conf >= 60 ? "var(--amber)" : "var(--red)",
                  textShadow: `0 0 7px ${conf >= 80 ? "rgba(0,255,136,0.9)" : "rgba(255,184,0,0.8)"}`,
                  minWidth: 32, textAlign: "right",
                }}
              >
                {conf}%
              </motion.span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Camera HUD bars (top + bottom) ────────────────────────────
function CamHUD({ connected, frameCount, detectionCount, audioEnabled, onToggleAudio }) {
  const ts  = useTick();
  const fps = useFps(25);
  const timeStr = ts.toLocaleTimeString("en-IN", { hour12: false });
  const dateStr = ts.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"2-digit" });

  return (
    <>
      {/* ── Top bar ── */}
      <div style={{
        position:"absolute", top:0, left:0, right:0, zIndex:7, pointerEvents:"none",
        padding:"7px 10px",
        background:"linear-gradient(180deg,rgba(0,0,0,0.88) 0%,transparent 100%)",
        display:"flex", alignItems:"center", gap:7,
      }}>
        {/* Camera ID */}
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <div style={{ width:4, height:4, borderRadius:"50%", background:"var(--cyan)", boxShadow:"0 0 6px var(--cyan)", animation:"pulse 2s infinite" }} />
          <span style={{ fontFamily:"var(--font-mono)", fontSize:9, color:"var(--cyan)", letterSpacing:"0.12em", fontWeight:700 }}>CAM-01</span>
        </div>
        <div style={{ width:1, height:10, background:"rgba(0,212,255,0.22)" }} />
        <span style={{ fontFamily:"var(--font-mono)", fontSize:8, color:"rgba(180,210,240,0.5)", letterSpacing:"0.08em" }}>MAIN GATE</span>
        {/* Resolution badge */}
        <div style={{ padding:"1px 5px", border:"1px solid rgba(0,212,255,0.25)", borderRadius:2,
          fontFamily:"var(--font-mono)", fontSize:7, color:"rgba(0,212,255,0.55)", letterSpacing:"0.07em" }}>
          HD 1080p
        </div>
        {/* Neural tracking status */}
        <div style={{ display:"flex", alignItems:"center", gap:4, padding:"1px 7px",
          background:"rgba(0,255,136,0.05)", border:"1px solid rgba(0,255,136,0.14)", borderRadius:2 }}>
          <div style={{ width:4, height:4, borderRadius:"50%", background:"var(--green)", animation:"pulse 1.2s infinite", boxShadow:"0 0 5px var(--green)" }} />
          <span style={{ fontFamily:"var(--font-mono)", fontSize:7.5, color:"rgba(0,255,136,0.7)", letterSpacing:"0.1em" }}>NEURAL TRACK</span>
        </div>

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          {detectionCount > 0 && (
            <span style={{ fontFamily:"var(--font-mono)", fontSize:8, color:"var(--amber)", letterSpacing:"0.06em" }}>
              ◉ {detectionCount} EVT
            </span>
          )}
          {/* Signal bars */}
          <SignalBars strength={connected ? 4 : 1} />
          {/* FPS counter */}
          <span style={{ fontFamily:"var(--font-mono)", fontSize:7.5, color:"rgba(0,212,255,0.38)", letterSpacing:"0.04em" }}>
            <span style={{ color:"rgba(0,212,255,0.65)", fontWeight:700 }}>{fps}</span>fps
          </span>
          {/* Timestamp + date */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end" }}>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:9, color:"rgba(180,210,240,0.6)", letterSpacing:"0.08em" }}>{timeStr}</span>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:6, color:"rgba(180,210,240,0.25)", letterSpacing:"0.05em" }}>{dateStr}</span>
          </div>
          {/* Audio toggle */}
          <button onClick={onToggleAudio} title={audioEnabled ? "Mute alerts" : "Unmute alerts"}
            style={{ pointerEvents:"auto",
              background: audioEnabled ? "rgba(0,212,255,0.12)" : "rgba(0,0,0,0.35)",
              border:`1px solid ${audioEnabled ? "rgba(0,212,255,0.35)" : "rgba(180,210,240,0.12)"}`,
              borderRadius:2, padding:"2px 7px", fontFamily:"var(--font-mono)", fontSize:9, cursor:"pointer",
              color: audioEnabled ? "var(--cyan)" : "rgba(180,210,240,0.3)",
              letterSpacing:"0.06em", transition:"all 0.2s" }}>
            {audioEnabled ? "♪ ON" : "♪ OFF"}
          </button>
          {/* LIVE badge */}
          <div style={{ display:"flex", alignItems:"center", gap:3, padding:"2px 6px",
            background:"rgba(255,45,85,0.88)", borderRadius:1,
            fontFamily:"var(--font-mono)", fontSize:8, color:"white", fontWeight:700, letterSpacing:"0.06em" }}>
            <div className="live-dot" />LIVE
          </div>
        </div>
      </div>

      {/* ── Bottom-left: AI + GPS + orientation ── */}
      <div style={{ position:"absolute", bottom:0, left:0, zIndex:7, pointerEvents:"none",
        padding:"8px 10px",
        background:"linear-gradient(0deg,rgba(0,0,0,0.82) 0%,transparent 100%)" }}>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:7.5, color:"rgba(0,255,136,0.72)", letterSpacing:"0.1em" }}>● AI ENGINE ACTIVE</div>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:7, color:"rgba(0,212,255,0.3)", marginTop:1 }}>YOLO v8 · ANPR-OCR · LICENSE DB</div>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:6.5, color:"rgba(0,212,255,0.2)", marginTop:3, letterSpacing:"0.07em" }}>GPS 23.7541°N 86.1540°E</div>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:6.5, color:"rgba(0,212,255,0.16)", marginTop:1, letterSpacing:"0.07em" }}>AZM 270° · ELEV −5° · FOV 92°</div>
      </div>

      {/* ── Bottom-right: WS + stream quality ── */}
      <div style={{ position:"absolute", bottom:0, right:0, zIndex:7, pointerEvents:"none",
        padding:"8px 10px", textAlign:"right",
        background:"linear-gradient(0deg,rgba(0,0,0,0.82) 0%,transparent 100%)" }}>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:7.5, letterSpacing:"0.1em",
          color: connected ? "rgba(0,255,136,0.7)" : "rgba(255,45,85,0.7)" }}>
          {connected ? "● WS CONNECTED" : "○ WS OFFLINE"}
        </div>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:7, color:"rgba(0,212,255,0.28)", marginTop:1 }}>/camera/service/stream</div>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:6.5, color:"rgba(0,212,255,0.2)", marginTop:3, letterSpacing:"0.06em" }}>RES 1920×1080 · 4.2 Mbps</div>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:6.5, color:"rgba(0,212,255,0.15)", marginTop:1, letterSpacing:"0.06em" }}>ENC H.264 · BUF 0.3s</div>
      </div>
    </>
  );
}

// ── ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ──
// ── SLIDE-IN DETECTION TOAST NOTIFICATION ────────────────────
// ── ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ──
function DetectionToast({ notification, onDismiss, audioEnabled, onToggleAudio }) {
  const plate   = useTyping(notification?.plate, 50);
  const conf    = Math.round((notification?.confidence || 0) * 100);
  const confVal = useCountUp(conf, 720);
  const isAlert = notification?.type === "alert";
  const imgUrl  = getSnapshotURL(notification?.image_path);

  const timeStr = notification?.timestamp
    ? new Date(notification.timestamp).toLocaleTimeString("en-IN", { hour12: false })
    : new Date().toLocaleTimeString("en-IN", { hour12: false });

  const color  = isAlert ? "var(--red)"           : "var(--green)";
  const glow   = isAlert ? "rgba(255,45,85,0.55)" : "rgba(0,255,136,0.45)";
  const border = isAlert ? "rgba(255,45,85,0.5)"  : "rgba(0,255,136,0.3)";
  const bg     = isAlert ? "rgba(16,2,5,0.97)"    : "rgba(2,12,8,0.97)";
  const confColor = conf >= 80 ? "var(--green)" : conf >= 60 ? "var(--amber)" : "var(--red)";
  const confGlow  = conf >= 80 ? "rgba(0,255,136,0.9)" : conf >= 60 ? "rgba(255,184,0,0.9)" : "rgba(255,45,85,0.9)";

  return (
    <motion.div
      initial={{ x: 110, opacity: 0 }}
      animate={
        isAlert
          /* alert: slide in then shake */
          ? { x: [110, 0, -8, 5, -3, 0], opacity: 1 }
          /* normal: spring slide */
          : { x: 0, opacity: 1 }
      }
      exit={{ x: 110, opacity: 0, transition: { duration: 0.28, ease: "easeIn" } }}
      transition={
        isAlert
          ? { duration: 0.5, times: [0, 0.45, 0.6, 0.75, 0.88, 1], ease: "easeOut" }
          : { type: "spring", stiffness: 360, damping: 30 }
      }
      style={{
        position: "fixed",
        bottom: 24, right: 24,
        zIndex: 9000,
        width: "clamp(272px, 26vw, 340px)",
        fontFamily: "var(--font-mono)",
        background: bg,
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 5,
        boxShadow: isAlert
          ? `0 0 0 1px rgba(255,45,85,0.18), 0 0 48px rgba(255,45,85,0.55), 0 16px 56px rgba(0,0,0,0.95)`
          : `0 0 36px ${glow}, 0 10px 40px rgba(0,0,0,0.85)`,
        backdropFilter: "blur(16px)",
        overflow: "hidden",
      }}
    >
      {/* ── Entry shimmer sweep ── */}
      <div
        className="lm-toast-shimmer"
        style={{
          background: isAlert
            ? "linear-gradient(90deg, transparent, rgba(255,45,85,0.14), transparent)"
            : "linear-gradient(90deg, transparent, rgba(0,212,255,0.1), transparent)",
        }}
      />

      {/* ── Header bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "8px 10px 7px",
        borderBottom: `1px solid ${isAlert ? "rgba(255,45,85,0.15)" : "rgba(0,255,136,0.1)"}`,
        background: isAlert ? "rgba(255,45,85,0.07)" : "rgba(0,255,136,0.04)",
      }}>
        {/* Title — blinks on alert */}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.06 }}
          style={{
            fontSize: 8, letterSpacing: "0.15em", fontWeight: 700,
            color,
            textShadow: isAlert
              ? "0 0 14px rgba(255,45,85,1), 0 0 30px rgba(255,45,85,0.5)"
              : "0 0 14px rgba(0,255,136,0.9)",
            animation: isAlert ? "lm-blink-kf 0.55s step-end infinite" : "none",
          }}
        >
          {isAlert ? "⚠  BLACKLISTED VEHICLE" : "◈  PLATE RECOGNIZED"}
        </motion.span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center" }}>
          {/* Audio toggle */}
          <button
            onClick={onToggleAudio}
            title={audioEnabled ? "Mute" : "Unmute"}
            style={{
              background: "none",
              border: `1px solid ${audioEnabled ? "rgba(0,212,255,0.22)" : "rgba(180,210,240,0.1)"}`,
              borderRadius: 2, padding: "2px 6px",
              fontSize: 9, cursor: "pointer",
              color: audioEnabled ? "rgba(0,212,255,0.75)" : "rgba(180,210,240,0.22)",
              fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
              transition: "all 0.2s",
            }}
          >
            {audioEnabled ? "♪" : "♪̶"}
          </button>
          {/* Dismiss */}
          <button
            onClick={onDismiss}
            style={{
              background: "none",
              border: "1px solid rgba(180,210,240,0.1)",
              borderRadius: 2, cursor: "pointer",
              color: "rgba(180,210,240,0.35)", fontSize: 10,
              padding: "2px 5px", lineHeight: 1,
              transition: "color 0.15s",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Body: image + plate + confidence ── */}
      <div style={{ padding: "11px 12px 9px", display: "flex", gap: 11, alignItems: "flex-start" }}>

        {/* Vehicle image / placeholder */}
        <div style={{
          width: 74, height: 50, flexShrink: 0,
          borderRadius: 3,
          border: `1px solid ${border}`,
          background: "#000",
          overflow: "hidden", position: "relative",
          boxShadow: `0 0 14px ${glow}`,
        }}>
          {imgUrl ? (
            <motion.img
              src={imgUrl}
              alt="vehicle capture"
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.32 }}
              style={{
                width: "100%", height: "100%", objectFit: "cover",
                filter: isAlert ? "saturate(0.5) brightness(0.72)" : "none",
              }}
            />
          ) : (
            /* Stylised placeholder */
            <div style={{
              width: "100%", height: "100%", position: "relative", overflow: "hidden",
              background: isAlert
                ? "linear-gradient(135deg,rgba(32,4,8,0.96),rgba(16,2,5,0.96))"
                : "linear-gradient(135deg,rgba(0,16,10,0.96),rgba(0,8,6,0.96))",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {/* mini grid */}
              <div style={{
                position: "absolute", inset: 0,
                backgroundImage: `linear-gradient(${isAlert ? "rgba(255,45,85,0.07)" : "rgba(0,212,255,0.07)"} 1px,transparent 1px),linear-gradient(90deg,${isAlert ? "rgba(255,45,85,0.07)" : "rgba(0,212,255,0.07)"} 1px,transparent 1px)`,
                backgroundSize: "8px 8px",
              }} />
              <span style={{ fontSize: 22, position: "relative", zIndex: 1 }}>🚗</span>
              {/* scan line across image */}
              <div
                className="lm-img-scan"
                style={{
                  background: `linear-gradient(90deg,transparent,${isAlert ? "rgba(255,45,85,0.7)" : "rgba(0,212,255,0.65)"},transparent)`,
                }}
              />
            </div>
          )}
          <Corners color={color} size={7} thick={1.2} />
        </div>

        {/* Plate text + confidence */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Plate */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 7.5, color: "rgba(180,210,240,0.32)", letterSpacing: "0.14em", marginBottom: 2 }}>
              LICENSE PLATE
            </div>
            <div style={{
              fontSize: 20, fontWeight: 700, letterSpacing: "0.22em",
              color: isAlert ? "var(--red)" : "var(--cyan)",
              textShadow: isAlert
                ? "0 0 20px rgba(255,45,85,1), 0 0 44px rgba(255,45,85,0.4)"
                : "0 0 20px rgba(0,212,255,1), 0 0 40px rgba(0,212,255,0.35)",
            }}>
              {plate}
              {plate.length < (notification?.plate?.length || 0) && (
                <span className="lm-blink" style={{ color: isAlert ? "var(--red)" : "var(--cyan)", fontSize: 15 }}>_</span>
              )}
            </div>
          </div>

          {/* AI Confidence with count-up pulse */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "baseline" }}>
              <span style={{ fontSize: 7, color: "rgba(180,210,240,0.28)", letterSpacing: "0.1em" }}>AI CONFIDENCE</span>
              {/* Number pulses in */}
              <motion.span
                initial={{ opacity: 0, scale: 2.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.42, duration: 0.32, type: "spring", stiffness: 280 }}
                style={{
                  fontSize: 13, fontWeight: 700,
                  color: confColor,
                  textShadow: `0 0 12px ${confGlow}`,
                }}
              >
                {confVal}%
              </motion.span>
            </div>
            {/* Confidence bar fill */}
            <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${conf}%` }}
                transition={{ delay: 0.3, duration: 0.62, ease: "easeOut" }}
                style={{
                  height: "100%", borderRadius: 2,
                  background: `linear-gradient(90deg, ${conf >= 80 ? "rgba(0,200,100,0.7),var(--green)" : conf >= 60 ? "rgba(200,140,0,0.7),var(--amber)" : "rgba(200,30,50,0.7),var(--red)"})`,
                  boxShadow: `0 0 7px ${confGlow}`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer: timestamp + status ── */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.52, duration: 0.28 }}
        style={{
          padding: "5px 12px 9px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderTop: `1px solid ${isAlert ? "rgba(255,45,85,0.1)" : "rgba(0,255,136,0.07)"}`,
        }}
      >
        {/* Timestamp reveal */}
        <motion.span
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.62, duration: 0.22 }}
          style={{ fontSize: 8, color: "rgba(180,210,240,0.3)", letterSpacing: "0.1em" }}
        >
          ⏱ {timeStr}
        </motion.span>

        {/* Status label */}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.72 }}
          style={{
            fontSize: 8, fontWeight: 700, letterSpacing: "0.12em",
            color,
            textShadow: `0 0 10px ${glow}`,
            animation: isAlert ? "lm-blink-kf 0.7s step-end infinite" : "none",
          }}
        >
          {isAlert ? "⚠ IMMEDIATE ACTION" : "✓ AUTHORIZED ACCESS"}
        </motion.span>
      </motion.div>

      {/* ── Alert: animated warning stripe ── */}
      {isAlert && <div className="lm-alert-stripe" />}

      {/* ── Auto-dismiss countdown bar ── */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: isAlert ? 10 : 7, ease: "linear", delay: 0.1 }}
        style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: 2,
          background: isAlert ? "rgba(255,45,85,0.45)" : "rgba(0,212,255,0.35)",
          transformOrigin: "left center",
        }}
      />
    </motion.div>
  );
}

// ── Full-screen red flash on blacklist detection ───────────────
function AlertFlash({ active }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="alert-flash"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.38, 0, 0.22, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.95, ease: "easeInOut" }}
          style={{
            position: "fixed", inset: 0,
            background: "rgb(255, 10, 30)",
            pointerEvents: "none", zIndex: 8998,
          }}
        />
      )}
    </AnimatePresence>
  );
}

// ── Radial emergency pulse rings on blacklist detection ───────
function EmergencyPulse({ active }) {
  if (!active) return null;
  return (
    <div style={{
      position: "fixed", top: "50%", left: "50%",
      pointerEvents: "none", zIndex: 8997,
    }}>
      {[0, 1, 2, 3, 4].map(i => (
        <motion.div
          key={i}
          initial={{ scale: 0.06, opacity: 0.9 }}
          animate={{ scale: 7,    opacity: 0 }}
          transition={{ duration: 1.55, delay: i * 0.22, ease: "easeOut" }}
          style={{
            position: "absolute",
            width: 90, height: 90,
            marginLeft: -45, marginTop: -45,
            borderRadius: "50%",
            border: "2px solid rgba(255, 45, 85, 0.88)",
            boxShadow: "0 0 12px rgba(255,45,85,0.35)",
          }}
        />
      ))}
    </div>
  );
}

// ── Sidebar detection card ────────────────────────────────────
function EventCard({ d, flash }) {
  const conf    = Math.round((d.confidence || 0) * 100);
  const isAlert = d.type === "alert";
  const imgUrl  = getSnapshotURL(d.image_path);
  const confColor = conf >= 80 ? "var(--green)" : conf >= 60 ? "var(--amber)" : "var(--red)";

  return (
    <div className={`det-card${flash ? " new" : ""}${isAlert ? " blacklist" : ""}`}>
      {flash && <div className="det-shimmer" />}

      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
        {/* Thumbnail */}
        <div style={{
          width: 42, height: 28, flexShrink: 0,
          borderRadius: 2,
          border: `1px solid ${isAlert ? "rgba(255,45,85,0.3)" : "rgba(0,212,255,0.18)"}`,
          background: "#000", overflow: "hidden", position: "relative",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {imgUrl
            ? <img src={imgUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: isAlert ? "saturate(0.4) brightness(0.68)" : "none" }} />
            : <span style={{ fontSize: 13, opacity: 0.4 }}>🚗</span>
          }
          {flash && (
            <div
              className="lm-img-scan"
              style={{
                background: `linear-gradient(90deg,transparent,${isAlert ? "rgba(255,45,85,0.55)" : "rgba(0,212,255,0.55)"},transparent)`,
              }}
            />
          )}
        </div>

        <div className={`det-plate${isAlert ? " alert" : ""}`} style={{ fontSize: 13 }}>
          {d.plate}
        </div>

        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: confColor }}>{conf}%</div>
          <div style={{ width: 38, height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 1, marginTop: 2 }}>
            <div style={{ height: "100%", width: `${conf}%`, borderRadius: 1, transition: "width 0.4s", background: confColor }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)" }}>
        <span>{new Date(d.timestamp || Date.now()).toLocaleTimeString()}</span>
        <span style={{ color: isAlert ? "var(--red)" : "rgba(0,212,255,0.45)" }}>
          {isAlert ? "⚠ ALERT" : "✓ OCR OK"}
        </span>
      </div>
    </div>
  );
}

// ── Sidebar system status tile ────────────────────────────────
function SysTile({ label, value, color, pulse }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border-cyan)",
      borderRadius: 3, padding: "7px 9px",
    }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 3 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {pulse && <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, animation: "pulse 1.4s ease-in-out infinite", flexShrink: 0, boxShadow: `0 0 5px ${color}` }} />}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color, letterSpacing: "0.04em" }}>{value}</span>
      </div>
    </div>
  );
}

// ── ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ──
// ── MAIN PAGE ─────────────────────────────────────────────────
// ── ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ──
export default function LiveMonitor() {
  const [liveDetections, setLiveDetections] = useState([]);
  const [activeDetection, setActiveDetection] = useState(null);
  const [notification, setNotification]     = useState(null);
  const [alertPulse, setAlertPulse]         = useState(false);
  const [camError, setCamError]             = useState(true);   // show offline until camera confirmed started
  const [starting, setStarting]             = useState(false);
  const [frameCount, setFrameCount]         = useState(0);
  const [detectionCount, setDetectionCount] = useState(0);
  const [audioEnabled, setAudioEnabled]     = useState(true);
  const [cameras, setCameras]               = useState({});   // { camId: sourceStr }
  const [activeCam, setActiveCam]           = useState("1");

  const clearRef      = useRef(null);
  const notifClearRef = useRef(null);
  const alertPulseRef = useRef(null);
  const retryRef      = useRef(null);
  const audioRef      = useRef(true);

  const toggleAudio = () => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    audioRef.current = next;
  };

  // Start error detail (shown in the error panel)
  const [camStartError, setCamStartError] = useState("");

  // Track whether the user has explicitly started the camera this session.
  const [camStarted, setCamStarted] = useState(false);

  // Fetch configured camera sources on mount.
  // Camera is NOT auto-started — user must press "START CAMERA" explicitly.
  useEffect(() => {
    apiFetch(`${API}/cameras`)
      .then(r => r.json())
      .then(d => {
        const sources = d.registered_sources || {};
        setCameras(sources);
        const camIds = Object.keys(sources);
        const preferred = camIds.includes("1") ? "1"
          : camIds.length > 0 ? camIds[0]
          : "service";
        setActiveCam(preferred);
        // Check if camera is already running (started from another tab / page reload).
        const running = d.active || [];
        if (running.includes(preferred)) {
          setCamError(false);
          setCamStarted(true);
        }
      })
      .catch(() => {});
  }, []);

  // Stop the camera when the user navigates away from this page.
  useEffect(() => {
    return () => {
      if (camStarted) {
        apiFetch(`${API}/camera/${activeCam}/stop`, { method: "POST" }).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camStarted, activeCam]);

  // Simulated frame counter (25 fps)
  useEffect(() => {
    const t = setInterval(() => setFrameCount(p => p + 25), 1000);
    return () => clearInterval(t);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(clearRef.current);
      clearTimeout(notifClearRef.current);
      clearTimeout(alertPulseRef.current);
      clearTimeout(retryRef.current);
    };
  }, []);

  const handleMessage = useCallback((msg) => {
    const d = { ...msg, _id: Date.now() };

    if (msg.type === "alert") {
      if (audioRef.current) playAlertBeep();
      setAlertPulse(true);
      clearTimeout(alertPulseRef.current);
      alertPulseRef.current = setTimeout(() => setAlertPulse(false), 2800);
    } else {
      if (audioRef.current) playDetectionBeep();
    }

    setNotification(d);
    setActiveDetection(d);
    setDetectionCount(p => p + 1);
    setLiveDetections(prev => [d, ...prev].slice(0, 30));

    clearTimeout(notifClearRef.current);
    notifClearRef.current = setTimeout(
      () => setNotification(null),
      msg.type === "alert" ? 10000 : 7000
    );

    clearTimeout(clearRef.current);
    clearRef.current = setTimeout(() => setActiveDetection(null), 8000);
  }, []);

  const { connected } = useWebSocket(handleMessage);
  const streamUrl     = getStreamURL(activeCam);
  const isAlert       = activeDetection?.type === "alert";

  const startCamera = async (camId) => {
    const id = camId || activeCam;
    setStarting(true);
    try {
      const r = await apiFetch(`${API}/camera/${id}/start`, { method: "POST" });
      const d = await r.json();
      if (d.success) {
        setCamError(false);
        setCamStartError("");
        setCamStarted(true);
      } else {
        setCamError(true);
        setCamStartError(d.error || "Camera failed to start");
      }
    } catch (e) {
      setCamError(true);
      setCamStartError(e.message);
    }
    setStarting(false);
  };

  // Stop current camera, then start the newly selected one
  const handleCamSwitch = async (camId) => {
    if (camStarted && camId !== activeCam) {
      apiFetch(`${API}/camera/${activeCam}/stop`, { method: "POST" }).catch(() => {});
      setCamStarted(false);
    }
    setActiveCam(camId);
    setCamError(false);
    await startCamera(camId);
  };

  // Stream error — retry after 4 s instead of showing permanent offline
  const handleStreamError = () => {
    setCamError(true);
    clearTimeout(retryRef.current);
    retryRef.current = setTimeout(() => {
      setCamError(false);   // triggers img re-mount → retry
    }, 4000);
  };

  return (
    <>
      {/* ── Global overlay effects (fixed, above everything) ── */}
      <AlertFlash    active={alertPulse} />
      <EmergencyPulse active={alertPulse} />

      {/* ── Slide-in toast notification ── */}
      <AnimatePresence>
        {notification && (
          <DetectionToast
            key={notification._id}
            notification={notification}
            onDismiss={() => setNotification(null)}
            audioEnabled={audioEnabled}
            onToggleAudio={toggleAudio}
          />
        )}
      </AnimatePresence>

      {/* ── Main two-column layout ── */}
      <div className="lm-layout">

        {/* ════════════════════════════════════
            CAMERA VIEWPORT
        ════════════════════════════════════ */}
        <div style={{
          background: "#000",
          border: `1px solid ${isAlert && activeDetection ? "var(--red)" : "var(--border-cyan)"}`,
          borderRadius: 4, overflow: "hidden",
          position: "relative", display: "flex", flexDirection: "column",
          transition: "border-color 0.3s, box-shadow 0.3s",
          boxShadow: isAlert && activeDetection
            ? "0 0 36px rgba(255,45,85,0.28), inset 0 0 40px rgba(255,45,85,0.04)"
            : "none",
        }}>
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>

            {/* Camera selector bar */}
            {Object.keys(cameras).length > 0 && (
              <div style={{
                position: "absolute", top: 42, left: 10, zIndex: 10,
                display: "flex", gap: 5, flexWrap: "wrap",
              }}>
                {Object.entries(cameras).map(([id, src]) => (
                  <button
                    key={id}
                    onClick={() => handleCamSwitch(id)}
                    style={{
                      fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.08em",
                      padding: "2px 8px", borderRadius: 2, cursor: "pointer",
                      background: activeCam === id ? "rgba(0,212,255,0.18)" : "rgba(0,0,0,0.6)",
                      border: `1px solid ${activeCam === id ? "rgba(0,212,255,0.6)" : "rgba(0,212,255,0.2)"}`,
                      color: activeCam === id ? "var(--cyan)" : "rgba(180,210,240,0.45)",
                      transition: "all 0.2s",
                    }}
                  >
                    CAM-{id} {src === "0" ? "(webcam)" : src.length > 18 ? src.slice(-14) + "…" : src}
                  </button>
                ))}
              </div>
            )}

            {camError ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, background: "#000", position: "relative", padding: "0 24px" }}>
                <div className="lm-grid" style={{ position: "absolute", inset: 0, opacity: 0.35 }} />
                <Corners color="rgba(0,212,255,0.25)" size={20} thick={1.5} inset={16} />
                <span style={{ fontFamily: "var(--font-mono)", color: camStarted ? "var(--amber)" : "rgba(0,212,255,0.7)", fontSize: 10, zIndex: 10, letterSpacing: "0.12em" }}>
                  {camStarted ? `CAM-${activeCam} OFFLINE` : `CAM-${activeCam} — READY TO START`}
                </span>
                {!camStarted && (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "rgba(0,212,255,0.4)", zIndex: 10, letterSpacing: "0.06em" }}>
                    Camera is not active. Press Start to initialize.
                  </div>
                )}
                {camStartError && (
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 9, zIndex: 10,
                    color: "rgba(255,184,0,0.7)", textAlign: "center", maxWidth: 380,
                    lineHeight: 1.6, padding: "6px 12px",
                    border: "1px solid rgba(255,184,0,0.2)", borderRadius: 3,
                    background: "rgba(255,184,0,0.04)",
                  }}>
                    {camStartError}
                  </div>
                )}
                <button
                  onClick={() => startCamera(activeCam)} disabled={starting}
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: 11, zIndex: 10,
                    background: "var(--green-dim)", border: "1px solid var(--border-green)",
                    color: "var(--green)", padding: "8px 24px",
                    cursor: starting ? "not-allowed" : "pointer", borderRadius: 2,
                    opacity: starting ? 0.6 : 1, letterSpacing: "0.08em",
                  }}
                >
                  {starting ? "STARTING…" : camStarted ? "▶ RETRY" : "▶ START CAMERA"}
                </button>
              </div>
            ) : (
              <img
                key={activeCam}
                src={streamUrl} alt="live camera feed"
                onError={handleStreamError}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              />
            )}

            {/* 1 · Heat zone background */}
            <HeatZones />
            {/* 2 · Moving grid */}
            <div className="lm-grid" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }} />
            {/* 3 · Vertical scan line */}
            <div className="lm-scanline" style={{ position: "absolute", left: 0, right: 0, height: 1.5, pointerEvents: "none", zIndex: 2 }} />
            {/* 4 · Vignette */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2, background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)" }} />
            {/* 5 · Tactical zone overlay */}
            <ZoneOverlay />
            {/* 6 · Vehicle trajectory paths */}
            <TrajectoryLines />
            {/* 7 · Corner brackets */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }}>
              <Corners color="rgba(0,212,255,0.48)" size={22} thick={1.5} inset={8} />
            </div>
            {/* 8 · Threat level meter */}
            <ThreatMeter level={isAlert && activeDetection ? 5 : activeDetection ? 3 : 1} />
            {/* 9 · Scanning reticle (idle) */}
            {!activeDetection && <ScanningReticle />}
            {/* 10 · Detection overlay (bbox + plate panel) */}
            <DetectionOverlay detection={activeDetection} isAlert={isAlert} />
            {/* 11 · HUD bars */}
            <CamHUD
              connected={connected}
              frameCount={frameCount}
              detectionCount={detectionCount}
              audioEnabled={audioEnabled}
              onToggleAudio={toggleAudio}
            />
          </div>
        </div>

        {/* ════════════════════════════════════
            SIDEBAR
        ════════════════════════════════════ */}
        <div className="lm-sidebar">

          {/* Connection status header */}
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border-cyan)",
            borderRadius: 3, padding: "8px 10px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--cyan)", letterSpacing: "0.1em", fontWeight: 700 }}>LIVE STREAM</span>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: connected ? "var(--green)" : "var(--red)", animation: connected ? "pulse 1.4s infinite" : "none", boxShadow: connected ? "0 0 6px var(--green)" : "none" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: connected ? "var(--green)" : "var(--red)" }}>
                {connected ? "CONNECTED" : "OFFLINE"}
              </span>
            </div>
          </div>

          {/* System metric tiles */}
          <div className="lm-sys-tiles">
            <SysTile label="AI ENGINE" value="ACTIVE"                    color="var(--green)"                       pulse />
            <SysTile label="OCR PROC"  value="READY"                     color="var(--cyan)"                        pulse={false} />
            <SysTile label="PLATE DB"  value={`${detectionCount} EVT`}   color="var(--amber)"                       pulse={false} />
            <SysTile label="WS STREAM" value={connected ? "OK" : "DOWN"} color={connected ? "var(--green)" : "var(--red)"} pulse={connected} />
          </div>

          {/* Detection event log */}
          <div className="lm-det-log">
            <div className="panel-header" style={{ padding: "7px 10px", borderBottom: "1px solid var(--border-cyan)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="panel-title">DETECTION LOG</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--amber)" }}>
                {liveDetections.length} events
              </span>
            </div>
            <div className="det-list" style={{ flex: 1, overflowY: "auto" }}>
              {liveDetections.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, marginTop: 24, textAlign: "center", letterSpacing: "0.08em" }}>
                  Waiting for plates...
                  <div className="lm-blink" style={{ marginTop: 8, color: "rgba(0,212,255,0.3)", fontSize: 16 }}>_</div>
                </div>
              ) : (
                liveDetections.map((d, i) => (
                  <EventCard key={d._id} d={d} flash={i === 0} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
