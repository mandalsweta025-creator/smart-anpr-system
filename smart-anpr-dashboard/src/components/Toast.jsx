import { createContext, useContext, useState, useCallback, useRef } from "react";

const ToastContext = createContext(null);

let _toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message, type = "info", duration = 3500) => {
    const id = ++_toastId;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const toastSuccess = useCallback((msg, dur) => toast(msg, "success", dur), [toast]);
  const toastError   = useCallback((msg, dur) => toast(msg, "error",   dur), [toast]);
  const toastWarn    = useCallback((msg, dur) => toast(msg, "warn",    dur), [toast]);

  return (
    <ToastContext.Provider value={{ toast, toastSuccess, toastError, toastWarn }}>
      {children}
      <div style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        pointerEvents: "none",
      }}>
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TYPE_STYLES = {
  success: { borderColor: "var(--green)",  iconColor: "var(--green)",  icon: "✓" },
  error:   { borderColor: "var(--red)",    iconColor: "var(--red)",    icon: "✕" },
  warn:    { borderColor: "var(--amber)",  iconColor: "var(--amber)",  icon: "⚠" },
  info:    { borderColor: "var(--cyan)",   iconColor: "var(--cyan)",   icon: "ℹ" },
};

function ToastItem({ toast, onDismiss }) {
  const s = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
  return (
    <div
      onClick={() => onDismiss(toast.id)}
      style={{
        pointerEvents: "all",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 16px",
        background: "var(--bg-card)",
        border: `1px solid ${s.borderColor}`,
        borderRadius: "6px",
        boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 8px ${s.borderColor}40`,
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        color: "var(--text-primary)",
        maxWidth: "360px",
        animation: "toast-in 0.2s ease",
        backdropFilter: "blur(8px)",
      }}
    >
      <span style={{ color: s.iconColor, fontWeight: 900, fontSize: "14px", flexShrink: 0 }}>
        {s.icon}
      </span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.message}</span>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
