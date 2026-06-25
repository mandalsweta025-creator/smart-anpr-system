import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Deterministic particles — no Math.random so renders are stable
const PARTICLES = Array.from({ length: 35 }, (_, i) => ({
  id: i,
  x: (i * 37 + 11) % 100,
  y: (i * 53 + 7) % 100,
  size: 1.5 + (i % 4) * 0.6,
  delay: (i * 0.17) % 4,
  dur: 2.8 + (i % 5) * 0.45,
}));

const ORG_CHARS   = "COAL INDIA LIMITED".split("");
const TITLE_CHARS = "SMART ANPR SYSTEM".split("");
const PLATE_CHARS = "CIL-ANPR".split("");

function CarSVG({ moving }) {
  return (
    <svg viewBox="0 0 600 230" fill="none" xmlns="http://www.w3.org/2000/svg"
         style={{ width: "100%", maxWidth: 660, display: "block" }}>
      <defs>
        <filter id="s-hl">
          <feGaussianBlur stdDeviation="4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="s-tl">
          <feGaussianBlur stdDeviation="3" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="s-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a3a5c"/>
          <stop offset="100%" stopColor="#091520"/>
        </linearGradient>
        <linearGradient id="s-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,212,255,0.22)"/>
          <stop offset="100%" stopColor="rgba(0,212,255,0.05)"/>
        </linearGradient>
        <radialGradient id="s-ground" cx="50%" cy="50%">
          <stop offset="0%" stopColor="rgba(0,212,255,0.14)"/>
          <stop offset="100%" stopColor="transparent"/>
        </radialGradient>
      </defs>

      {/* Ground shadow + glow */}
      <ellipse cx="303" cy="218" rx="240" ry="11" fill="rgba(0,0,0,0.5)"/>
      <ellipse cx="303" cy="218" rx="205" ry="6"  fill="url(#s-ground)"/>

      {/* Headlight beam cones */}
      <path d="M 538 142 L 600 95 L 600 210 L 538 172" fill="rgba(255,240,180,0.07)"/>
      <path d="M 538 148 L 600 132 L 600 182 L 538 162" fill="rgba(255,240,180,0.04)"/>

      {/* ── CHASSIS / LOWER BODY ── */}
      <path d="M 90 195
               L 90 155 Q 91 150 96 150
               L 120 150 Q 120 172 155 172 Q 192 172 192 150
               L 415 150 Q 415 172 452 172 Q 487 172 487 150
               L 510 150 Q 515 150 515 155 L 515 195 Z"
            fill="url(#s-body)" stroke="rgba(0,212,255,0.55)" strokeWidth="1.8"/>

      {/* ── CABIN / ROOF ── */}
      <path d="M 192 150
               L 215 106 Q 232 84 258 80
               L 385 80 Q 412 84 432 106
               L 452 150 Z"
            fill="url(#s-body)" stroke="rgba(0,212,255,0.48)" strokeWidth="1.8"/>

      {/* Windshield — front */}
      <path d="M 432 106 Q 448 120 452 150 L 396 150 Z"
            fill="url(#s-glass)" stroke="rgba(0,212,255,0.42)" strokeWidth="1"/>

      {/* Side windows */}
      <path d="M 220 106 Q 236 86 258 82 L 385 82 Q 410 85 428 104 L 393 145 L 226 145 Z"
            fill="url(#s-glass)" stroke="rgba(0,212,255,0.30)" strokeWidth="1"/>

      {/* Rear windshield */}
      <path d="M 195 150 L 215 106 Q 226 88 240 83 L 226 145 Z"
            fill="url(#s-glass)" stroke="rgba(0,212,255,0.22)" strokeWidth="1"/>

      {/* B-pillar */}
      <line x1="308" y1="82" x2="308" y2="144" stroke="rgba(0,212,255,0.18)" strokeWidth="2.5"/>

      {/* Lower trim line */}
      <line x1="97" y1="175" x2="508" y2="175" stroke="rgba(0,212,255,0.18)" strokeWidth="1"/>

      {/* Front bumper */}
      <path d="M 510 155 Q 540 158 544 170 Q 540 184 517 187 L 515 195 L 510 195 Z"
            fill="#091520" stroke="rgba(0,212,255,0.42)" strokeWidth="1.5"/>

      {/* Rear bumper */}
      <path d="M 90 155 Q 60 158 56 170 Q 60 184 83 187 L 85 195 L 90 195 Z"
            fill="#091520" stroke="rgba(0,212,255,0.42)" strokeWidth="1.5"/>

      {/* ── HEADLIGHTS ── */}
      <rect x="514" y="151" width="28" height="20" rx="2.5"
            fill="rgba(255,248,215,0.9)" filter="url(#s-hl)"/>
      <line x1="517" y1="156" x2="539" y2="156" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M 517 162 L 539 164 L 539 167 L 517 165 Z" fill="rgba(255,235,150,0.7)"/>

      {/* ── TAILLIGHTS ── */}
      <rect x="58" y="151" width="26" height="20" rx="2.5"
            fill="rgba(255,25,45,0.85)" filter="url(#s-tl)"/>
      <line x1="61" y1="157" x2="81" y2="157" stroke="rgba(255,110,130,0.95)" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="61" y1="162" x2="81" y2="162" stroke="rgba(255,80,100,0.75)" strokeWidth="2"/>
      <line x1="61" y1="167" x2="79" y2="167" stroke="rgba(255,60,80,0.5)"  strokeWidth="1.5"/>

      {/* ANPR camera on roof */}
      <rect x="297" y="76" width="22" height="9" rx="2"
            fill="#060e20" stroke="rgba(0,212,255,0.65)" strokeWidth="1"/>
      <circle cx="308" cy="80.5" r="2.8" fill="rgba(0,212,255,0.9)" filter="url(#s-hl)"/>

      {/* License plate */}
      <rect x="266" y="182" width="50" height="15" rx="1.5"
            fill="#f5f5e8" stroke="#ccc" strokeWidth="0.5"/>
      <text x="291" y="193" textAnchor="middle" fontSize="7.5"
            fontFamily="monospace" fill="#222" fontWeight="bold">CIL-ANPR</text>

      {/* ── REAR WHEEL ── */}
      <circle cx="155" cy="200" r="38" fill="#040c18" stroke="rgba(0,212,255,0.52)" strokeWidth="2.5"/>
      <circle cx="155" cy="200" r="38" fill="none" stroke="rgba(0,212,255,0.12)" strokeWidth="9"/>
      <circle cx="155" cy="200" r="27" fill="none" stroke="rgba(0,212,255,0.22)" strokeWidth="1.5"/>
      <circle cx="155" cy="200" r="10" fill="#0d1f35" stroke="rgba(0,212,255,0.72)" strokeWidth="2"/>
      <circle cx="155" cy="200" r="3.8" fill="rgba(0,212,255,0.95)"/>
      <g style={{ transformOrigin:"155px 200px", transformBox:"view-box",
                  animation: moving ? "splash-spin 0.45s linear infinite" : "none" }}>
        <line x1="155" y1="172" x2="155" y2="186" stroke="rgba(0,212,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="155" y1="214" x2="155" y2="228" stroke="rgba(0,212,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="127" y1="200" x2="141" y2="200" stroke="rgba(0,212,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="169" y1="200" x2="183" y2="200" stroke="rgba(0,212,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="135" y1="180" x2="146" y2="191" stroke="rgba(0,212,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="164" y1="209" x2="175" y2="220" stroke="rgba(0,212,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="175" y1="180" x2="164" y2="191" stroke="rgba(0,212,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="135" y1="220" x2="146" y2="209" stroke="rgba(0,212,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
      </g>

      {/* ── FRONT WHEEL ── */}
      <circle cx="450" cy="200" r="38" fill="#040c18" stroke="rgba(0,212,255,0.52)" strokeWidth="2.5"/>
      <circle cx="450" cy="200" r="38" fill="none" stroke="rgba(0,212,255,0.12)" strokeWidth="9"/>
      <circle cx="450" cy="200" r="27" fill="none" stroke="rgba(0,212,255,0.22)" strokeWidth="1.5"/>
      <circle cx="450" cy="200" r="10" fill="#0d1f35" stroke="rgba(0,212,255,0.72)" strokeWidth="2"/>
      <circle cx="450" cy="200" r="3.8" fill="rgba(0,212,255,0.95)"/>
      <g style={{ transformOrigin:"450px 200px", transformBox:"view-box",
                  animation: moving ? "splash-spin 0.45s linear infinite" : "none" }}>
        <line x1="450" y1="172" x2="450" y2="186" stroke="rgba(0,212,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="450" y1="214" x2="450" y2="228" stroke="rgba(0,212,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="422" y1="200" x2="436" y2="200" stroke="rgba(0,212,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="464" y1="200" x2="478" y2="200" stroke="rgba(0,212,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="430" y1="180" x2="441" y2="191" stroke="rgba(0,212,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="459" y1="209" x2="470" y2="220" stroke="rgba(0,212,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="470" y1="180" x2="459" y2="191" stroke="rgba(0,212,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="430" y1="220" x2="441" y2="209" stroke="rgba(0,212,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
      </g>
    </svg>
  );
}

export default function Splash({ onDone }) {
  const [phase, setPhase] = useState(0);
  // 0→car drives in  1→org text  2→title  3→subtitle+bar
  // 4→scan beam      5→plate recognized  6→fade out

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 1400),
      setTimeout(() => setPhase(2), 2200),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 4200),
      setTimeout(() => setPhase(5), 4900),
      setTimeout(() => setPhase(6), 6000),
      setTimeout(() => onDone(),    6700),
    ];
    return () => t.forEach(clearTimeout);
  }, [onDone]);

  const moving = phase === 0;

  return (
    <div className={`splash${phase >= 6 ? " splash-exit" : ""}`}>

      {/* ── BACKGROUND ── */}
      <div className="splash-grid"/>
      <div className="splash-radial"/>

      {/* Floating particles */}
      {PARTICLES.map(p => (
        <div key={p.id} className="splash-particle" style={{
          left: `${p.x}%`, top: `${p.y}%`,
          width: `${p.size}px`, height: `${p.size}px`,
          animationDelay: `${p.delay}s`,
          animationDuration: `${p.dur}s`,
        }}/>
      ))}

      {/* Scan sweep */}
      <div className="splash-scan"/>

      {/* ── HEADER BADGE ── */}
      <div className={`splash-badge${phase >= 1 ? " badge-in" : ""}`}>
        <div className="cil-emblem">
          <svg viewBox="0 0 48 48" width="48" height="48">
            <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,184,0,0.8)" strokeWidth="1.5"/>
            <circle cx="24" cy="24" r="16" fill="none" stroke="rgba(255,184,0,0.4)" strokeWidth="1"/>
            {[0,45,90,135,180,225,270,315].map(deg => (
              <line key={deg}
                x1={24 + 16*Math.cos(deg*Math.PI/180)}
                y1={24 + 16*Math.sin(deg*Math.PI/180)}
                x2={24 + 22*Math.cos(deg*Math.PI/180)}
                y2={24 + 22*Math.sin(deg*Math.PI/180)}
                stroke="rgba(255,184,0,0.6)" strokeWidth="1.5"/>
            ))}
            <text x="24" y="28" textAnchor="middle" fontFamily="Orbitron,monospace"
                  fontSize="9" fontWeight="900" fill="rgba(255,184,0,0.95)">CIL</text>
          </svg>
        </div>
        <div className="cil-text">
          <div className="cil-name">Coal India Limited</div>
          <div className="cil-dept">Ministry of Coal · Government of India</div>
        </div>
      </div>

      {/* ── ORG NAME — letter by letter ── */}
      <div className="splash-org-line">
        {ORG_CHARS.map((ch, i) => (
          <span key={i} className={`splash-char org-char${phase >= 1 ? " char-in" : ""}`}
                style={{ animationDelay: `${phase >= 1 ? i * 0.055 : 0}s` }}>
            {ch === " " ? " " : ch}
          </span>
        ))}
      </div>

      {/* Divider line */}
      <div className={`splash-divider${phase >= 2 ? " divider-in" : ""}`}/>

      {/* ── MAIN TITLE — typewriter ── */}
      <div className="splash-title-line">
        {TITLE_CHARS.map((ch, i) => (
          <span key={i} className={`splash-char title-char${phase >= 2 ? " char-in" : ""}`}
                style={{ animationDelay: `${phase >= 2 ? i * 0.065 : 0}s` }}>
            {ch === " " ? " " : ch}
          </span>
        ))}
        {phase >= 2 && <span className="splash-cursor">_</span>}
      </div>

      {/* ── SUBTITLE ── */}
      <div className={`splash-sub${phase >= 3 ? " sub-in" : ""}`}>
        Vehicle Detection &amp; Monitoring Platform
      </div>

      {/* ── CAR ── */}
      <div className={`splash-car-wrap${phase >= 1 ? " car-parked" : " car-moving"}`}>
        <div className="car-motion-trail"/>
        <CarSVG moving={moving}/>

        {/* SCAN BEAM — sweeps left→right across the car in phase 4 */}
        <AnimatePresence>
          {phase === 4 && (
            <motion.div
              key="scan-beam"
              initial={{ left: "-0.5%", opacity: 1 }}
              animate={{ left: "101%" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: "linear" }}
              style={{
                position: "absolute", top: "8%", bottom: "12%", width: 3,
                background: "linear-gradient(to bottom, transparent, rgba(0,212,255,0.85) 30%, #00d4ff 50%, rgba(0,212,255,0.85) 70%, transparent)",
                boxShadow: "0 0 16px 6px rgba(0,212,255,0.3)",
                pointerEvents: "none", zIndex: 10,
              }}
            />
          )}
        </AnimatePresence>

        {/* HUD OVERLAY SVG — same viewBox as CarSVG for pixel-perfect alignment */}
        <AnimatePresence>
          {phase >= 4 && (
            <motion.svg
              key="hud"
              viewBox="0 0 600 230"
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                pointerEvents: "none", zIndex: 11,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {/* Phase 4: cyan dashed detection box */}
              {phase === 4 && (
                <motion.rect
                  x="250" y="168" width="84" height="36" rx="2"
                  fill="rgba(0,212,255,0.06)"
                  stroke="rgba(0,212,255,0.7)" strokeWidth="1.2"
                  strokeDasharray="5 3"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: 0.28 }}
                />
              )}

              {/* Phase 5+: green recognized state */}
              {phase >= 5 && (
                <>
                  {/* Solid recognized box */}
                  <motion.rect
                    x="250" y="168" width="84" height="36" rx="2"
                    fill="rgba(0,255,136,0.07)"
                    stroke="rgba(0,255,136,0.7)" strokeWidth="1.5"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ duration: 0.18 }}
                  />

                  {/* Corner brackets */}
                  <motion.path d="M250 178 L250 168 L262 168"
                    stroke="#00ff88" strokeWidth="2.5" fill="none"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.2 }}/>
                  <motion.path d="M334 178 L334 168 L322 168"
                    stroke="#00ff88" strokeWidth="2.5" fill="none"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.2, delay: 0.05 }}/>
                  <motion.path d="M250 194 L250 204 L262 204"
                    stroke="#00ff88" strokeWidth="2.5" fill="none"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.2, delay: 0.1 }}/>
                  <motion.path d="M334 194 L334 204 L322 204"
                    stroke="#00ff88" strokeWidth="2.5" fill="none"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.2, delay: 0.15 }}/>

                  {/* "PLATE DETECTED" label above box */}
                  <motion.text x="292" y="162" textAnchor="middle"
                    fontFamily="monospace" fontSize="8" fill="rgba(0,255,136,0.9)"
                    letterSpacing="1.2"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ duration: 0.2, delay: 0.2 }}>
                    PLATE DETECTED
                  </motion.text>

                  {/* "✓ AUTHORIZED" label below box */}
                  <motion.text x="292" y="217" textAnchor="middle"
                    fontFamily="monospace" fontSize="7.5" fill="rgba(0,255,136,0.75)"
                    letterSpacing="1"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ duration: 0.2, delay: 0.25 }}>
                    ✓  AUTHORIZED
                  </motion.text>

                  {/* Side targeting lines extending left and right from box */}
                  <motion.line
                    x2="250" y1="186" y2="186"
                    stroke="rgba(0,255,136,0.5)" strokeWidth="1"
                    initial={{ x1: 250 }} animate={{ x1: 226 }}
                    transition={{ duration: 0.22, delay: 0.3 }}
                  />
                  <motion.line
                    x1="334" y1="186" y2="186"
                    stroke="rgba(0,255,136,0.5)" strokeWidth="1"
                    initial={{ x2: 334 }} animate={{ x2: 358 }}
                    transition={{ duration: 0.22, delay: 0.3 }}
                  />
                </>
              )}
            </motion.svg>
          )}
        </AnimatePresence>
      </div>

      {/* ── PLATE READOUT — appears in phase 5 ── */}
      <div style={{ minHeight: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <AnimatePresence>
          {phase >= 5 && (
            <motion.div
              key="plate-readout"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <span style={{
                fontFamily: "monospace", fontSize: 10,
                color: "rgba(0,255,136,0.55)", letterSpacing: "0.15em",
              }}>
                OCR ›
              </span>
              <div style={{ display: "flex", gap: 2 }}>
                {PLATE_CHARS.map((ch, i) => (
                  <motion.span key={i}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07, duration: 0.12 }}
                    style={{
                      fontFamily: "monospace", fontSize: 13, fontWeight: 700,
                      color: "#00ff88",
                      background: "rgba(0,255,136,0.1)",
                      border: "1px solid rgba(0,255,136,0.3)",
                      borderRadius: 3, padding: "1px 5px",
                      textShadow: "0 0 7px rgba(0,255,136,0.55)",
                    }}>
                    {ch}
                  </motion.span>
                ))}
              </div>
              <span style={{
                fontFamily: "monospace", fontSize: 9,
                color: "rgba(0,255,136,0.45)", letterSpacing: "0.12em",
              }}>
                · AUTHORIZED
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Road strip */}
      <div className="splash-road">
        <div className={`road-lines${moving ? " road-scroll" : ""}`}/>
      </div>

      {/* ── LOADING BAR ── */}
      <div className={`splash-loader${phase >= 3 ? " loader-in" : ""}`}>
        <div className="loader-track">
          <div className="loader-fill"/>
        </div>
        <div className="loader-label">INITIALIZING SYSTEM &nbsp;·&nbsp; AI ENGINE READY</div>
      </div>

      {/* Version tag */}
      <div className="splash-version">v2.0 · ANPR INTELLIGENCE PLATFORM</div>
    </div>
  );
}
