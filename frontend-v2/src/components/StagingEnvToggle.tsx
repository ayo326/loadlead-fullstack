// Floating "Start / Pause staging env" control, top-right of the staging
// homepage. Calls the standalone toggle Lambda (Function URL) - which lives
// OUTSIDE the backend EB env so it works even while the backend is paused.
//
// Renders only when VITE_STAGING_TOGGLE_URL is baked into the build (the staging
// bundle), so it never appears in production. Auth is a shared secret the
// engineer pastes once; it's kept in localStorage and sent as x-toggle-secret.
import { useCallback, useEffect, useRef, useState } from "react";

const TOGGLE_URL = import.meta.env.VITE_STAGING_TOGGLE_URL as string | undefined;
const SECRET_KEY = "ll_staging_toggle_secret";

type EnvState = "running" | "paused" | "transitioning" | "absent" | "unknown" | "locked";

const META: Record<EnvState, { dot: string; label: string }> = {
  running: { dot: "#22c55e", label: "Staging env - running" },
  paused: { dot: "#9ca3af", label: "Staging env - paused ($0)" },
  transitioning: { dot: "#f59e0b", label: "Staging env - working…" },
  absent: { dot: "#ef4444", label: "Staging env - not provisioned" },
  unknown: { dot: "#ef4444", label: "Staging env - unreachable" },
  locked: { dot: "#6366f1", label: "Staging env - enter key" },
};

export function StagingEnvToggle() {
  const [state, setState] = useState<EnvState>("locked");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const getSecret = () => localStorage.getItem(SECRET_KEY) || "";

  const call = useCallback(async (method: "GET" | "POST", action?: "start" | "stop") => {
    const secret = getSecret();
    if (!secret) return { status: 401 } as Response;
    return fetch(TOGGLE_URL!, {
      method,
      headers: { "content-type": "application/json", "x-toggle-secret": secret },
      ...(action ? { body: JSON.stringify({ action }) } : {}),
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!getSecret()) { setState("locked"); return; }
    try {
      const res = await call("GET");
      if (res.status === 401) { localStorage.removeItem(SECRET_KEY); setState("locked"); setMsg("Key rejected"); return; }
      const body = await res.json();
      setState((body.state as EnvState) ?? "unknown");
      setMsg(null);
    } catch {
      setState("unknown");
    }
  }, [call]);

  // Poll: every 5s while transitioning, else every 12s.
  useEffect(() => {
    if (!TOGGLE_URL) return;
    refresh();
    const tick = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        await refresh();
        tick();
      }, state === "transitioning" ? 5000 : 12000);
    };
    tick();
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [refresh, state]);

  if (!TOGGLE_URL) return null;

  const unlock = () => {
    const s = window.prompt("Paste the staging toggle secret:");
    if (s && s.trim()) { localStorage.setItem(SECRET_KEY, s.trim()); setMsg(null); refresh(); }
  };

  const toggle = async () => {
    if (!getSecret()) return unlock();
    const action = state === "running" ? "stop" : "start";
    if (action === "stop" && !window.confirm("Pause the staging env? The API goes offline until you start it again.")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await call("POST", action);
      if (res.status === 401) { localStorage.removeItem(SECRET_KEY); setState("locked"); setMsg("Key rejected"); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(body.message || `Error ${res.status}`); return; }
      setState("transitioning");
      setMsg(action === "start" ? "Starting… ~2-3 min" : "Pausing… ~1-2 min");
    } catch {
      setMsg("Request failed");
    } finally {
      setBusy(false);
    }
  };

  const meta = META[state];
  const actionable = state === "running" || state === "paused";
  const btnLabel =
    state === "locked" ? "Unlock" :
    state === "running" ? "Pause staging env" :
    state === "paused" ? "Start staging env" :
    state === "transitioning" ? "Working…" : "Retry";

  return (
    <div
      style={{
        position: "fixed", top: 12, right: 12, zIndex: 60,
        display: "flex", alignItems: "center", gap: 10,
        background: "rgba(17,24,39,0.92)", color: "#f9fafb",
        border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10,
        padding: "8px 10px", fontSize: 12, fontFamily: "ui-sans-serif, system-ui",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)", backdropFilter: "blur(6px)",
      }}
      title="Engineering control - staging only"
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", background: meta.dot,
          boxShadow: state === "transitioning" ? "0 0 0 0 " + meta.dot : "none",
          animation: state === "transitioning" ? "llpulse 1.2s infinite" : "none",
        }} />
        {msg ?? meta.label}
      </span>
      <button
        onClick={state === "locked" ? unlock : toggle}
        disabled={busy || (!actionable && state !== "locked" && state !== "unknown")}
        style={{
          cursor: busy ? "default" : "pointer",
          background: state === "running" ? "#ef4444" : "#22c55e",
          color: "#0b1220", fontWeight: 600, border: "none", borderRadius: 7,
          padding: "5px 10px", opacity: busy || (!actionable && state !== "locked" && state !== "unknown") ? 0.6 : 1,
        }}
      >
        {btnLabel}
      </button>
      <style>{`@keyframes llpulse{0%{box-shadow:0 0 0 0 rgba(245,158,11,.6)}70%{box-shadow:0 0 0 6px rgba(245,158,11,0)}100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}}`}</style>
    </div>
  );
}
