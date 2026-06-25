import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════
const API = import.meta.env.VITE_API_URL ?? "";
const WS_URL = import.meta.env.VITE_API_URL
  ? `ws://${new URL(import.meta.env.VITE_API_URL).host}/ws`
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

// ═══════════════════════════════════════════════════
//  JWT decode (no library needed — base64 payload)
// ═══════════════════════════════════════════════════
export function parseJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════
//  Auth helpers
// ═══════════════════════════════════════════════════
export const getToken        = ()  => localStorage.getItem("anpr_token");
export const isAuthenticated = ()  => Boolean(getToken());

export const getUserRole = () => {
  const token = getToken();
  if (!token) return null;
  const payload = parseJwt(token);
  return payload?.role ?? null;
};

export const isAdmin     = () => getUserRole() === "admin";
export const isOperator  = () => getUserRole() === "operator";
export const isAdminOrOp = () => ["admin", "operator"].includes(getUserRole());
export const isVehicleOwner = () => getUserRole() === "user";

export const getUsername = () => {
  const token = getToken();
  if (!token) return null;
  return parseJwt(token)?.sub ?? null;
};

export const logout = () => {
  localStorage.removeItem("anpr_token");
  window.location.replace("/login");
};

// ═══════════════════════════════════════════════════
//  authFetch — attaches Bearer token; redirects on 401
// ═══════════════════════════════════════════════════
export const authFetch = async (url, opts = {}) => {
  const token = getToken();
  const headers = { ...(opts.headers ?? {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) { logout(); }
  return res;
};

export const apiFetch = authFetch;   // backward compat alias

// ═══════════════════════════════════════════════════
//  Indian number-plate validator
// ═══════════════════════════════════════════════════
const INDIA_PLATE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$/;
export const isValidIndianPlate = (plate) =>
  Boolean(plate && INDIA_PLATE_RE.test(plate.trim().toUpperCase()));

// ═══════════════════════════════════════════════════
//  HOOK: useDetections
// ═══════════════════════════════════════════════════
export function useDetections(limit = 50) {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetections = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/detections?limit=${limit}`);
      const data = await res.json();
      setDetections(data.filter(d => isValidIndianPlate(d.plate_number)));
      setError(null);
    } catch {
      setError("Backend offline");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchDetections();
    const timer = setInterval(fetchDetections, 5000);
    return () => clearInterval(timer);
  }, [fetchDetections]);

  return { detections, loading, error, refetch: fetchDetections };
}

// ═══════════════════════════════════════════════════
//  HOOK: useWebSocket
// ═══════════════════════════════════════════════════
export function useWebSocket(onMessage) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let reconnectTimer;

    const connect = () => {
      try {
        const token = getToken();
        const wsUrlWithToken = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
        const ws = new WebSocket(wsUrlWithToken);
        wsRef.current = ws;

        ws.onopen = () => setConnected(true);

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "alert") {
              onMessageRef.current(msg);
            } else if (msg.type === "detection" && isValidIndianPlate(msg.plate_number ?? msg.plate)) {
              onMessageRef.current(msg);
            }
          } catch {}
        };

        ws.onclose = () => {
          setConnected(false);
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => ws.close();
      } catch {}
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return { connected };
}

// ═══════════════════════════════════════════════════
//  HOOK: useActiveSessions
// ═══════════════════════════════════════════════════
export function useActiveSessions() {
  const [data, setData] = useState({ active_count: 0, vehicles: [] });

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await authFetch(`${API}/sessions/active`);
        const d = await res.json();
        setData(d);
      } catch {}
    };
    fetch_();
    const t = setInterval(fetch_, 10000);
    return () => clearInterval(t);
  }, []);

  return data;
}

// ═══════════════════════════════════════════════════
//  HOOK: useVehicleSearch
// ═══════════════════════════════════════════════════
export function useVehicleSearch() {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const search = async (plate) => {
    if (!plate.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await authFetch(`${API}/detections/search?plate=${encodeURIComponent(plate)}`);
      setResults(await res.json());
    } catch {} finally {
      setSearching(false);
    }
  };

  return { results, searching, search };
}

// ═══════════════════════════════════════════════════
//  HOOK: useAnomalyBadge — open anomaly count for sidebar badge
// ═══════════════════════════════════════════════════
export function useAnomalyBadge() {
  const [counts, setCounts] = useState({ total_open: 0, critical: 0, high: 0 });

  useEffect(() => {
    if (!isAuthenticated()) return;
    const fetch_ = async () => {
      try {
        const r = await authFetch(`${API}/anomalies/count`);
        if (r.ok) setCounts(await r.json());
      } catch { /* backend offline — keep last value */ }
    };
    fetch_();
    const t = setInterval(fetch_, 30_000);
    return () => clearInterval(t);
  }, []);

  return counts;
}

// ═══════════════════════════════════════════════════
//  HOOK: usePortalFetch — generic fetch for /me/* routes
// ═══════════════════════════════════════════════════
export function usePortalFetch(path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, refetch };
}

// ═══════════════════════════════════════════════════
//  UTIL: URLs
// ═══════════════════════════════════════════════════
export const getStreamURL = (camId) => {
  const token = getToken();
  const base = `${API}/camera/${camId || "service"}/stream`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
};

export const getSnapshotURL = (imagePath) => {
  if (!imagePath) return null;
  const filename = imagePath.split(/[\\/]/).pop();
  if (!filename) return null;
  const token = getToken();
  const base = `${API}/static/detections/${filename}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
};

// ═══════════════════════════════════════════════════
//  UTIL: Audio alerts
// ═══════════════════════════════════════════════════
export function playAlertBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 660].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.18);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.16);
    });
  } catch {}
}

export function playDetectionBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[1047, 0], [1319, 0.13]].forEach(([freq, delay]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.16, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.28);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.28);
    });
  } catch {}
}

export { API };
