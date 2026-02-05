// src/components/SessionGuard.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  refresh,
  logoutApi,
  getTokenRemainingMs,
  isTokenExpired,
  onAuthExpired,
  handleAuthExpired,
} from "../services/api";

/**
 * SessionGuard
 * - Silent refresh near expiry
 * - Session warning modal (expiry + idle)
 * - Idle logout
 *
 * Mount inside private area (ex: inside AppLayout or inside RequireAuth wrapper).
 */
export default function SessionGuard({ enabled = true }) {
  // ===== Tunables =====
  const IDLE_TIMEOUT_MS = 20 * 60 * 1000;        // 20 minutes idle → logout
  const IDLE_WARN_BEFORE_MS = 60 * 1000;         // warn 1 minute before idle logout

  const TOKEN_WARN_BEFORE_MS = 2 * 60 * 1000;    // warn 2 minutes before JWT expiry
  const TOKEN_REFRESH_BEFORE_MS = 60 * 1000;     // auto refresh 60 seconds before expiry
  const TICK_MS = 1000;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // "token" | "idle"
  const [countdownMs, setCountdownMs] = useState(0);
  const [busy, setBusy] = useState(false);

  const lastActivityRef = useRef(Date.now());
  const refreshInFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const countdownLabel = useMemo(() => {
    const s = Math.max(0, Math.ceil(countdownMs / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }, [countdownMs]);

  function markActivity() {
    lastActivityRef.current = Date.now();
  }

  async function doLogout(reason = "USER_LOGOUT") {
    setBusy(true);
    try {
      await logoutApi();
    } catch {
      // ignore
    } finally {
      setBusy(false);
      handleAuthExpired(reason);
    }
  }

  async function staySignedIn() {
    if (refreshInFlightRef.current) return;
    setBusy(true);
    refreshInFlightRef.current = true;

    try {
      await refresh(); // refresh cookie -> new token
      // close modal if token was the issue
      setOpen(false);
      setMode(null);
    } catch {
      // refresh failed -> force login
      handleAuthExpired("TOKEN_EXPIRED");
    } finally {
      refreshInFlightRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!enabled) return;

    mountedRef.current = true;

    // Listen for API layer "auth expired" triggers
    const off = onAuthExpired(() => {
      // if api.js already redirected, this is just safety
      setOpen(false);
      setMode(null);
    });

    // Track user activity to prevent idle logout
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    for (const ev of events) window.addEventListener(ev, markActivity, { passive: true });

    return () => {
      off();
      for (const ev of events) window.removeEventListener(ev, markActivity);
      mountedRef.current = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const timer = window.setInterval(async () => {
      // If no token or already expired -> force login
      if (isTokenExpired(0)) {
        // only force if user is actually in private app (you mounted guard there)
        handleAuthExpired("TOKEN_EXPIRED");
        return;
      }

      // ===== Idle logic =====
      const idleFor = Date.now() - lastActivityRef.current;
      const idleRemaining = IDLE_TIMEOUT_MS - idleFor;

      if (idleRemaining <= 0) {
        // idle logout
        await doLogout("IDLE_LOGOUT");
        return;
      }

      // show idle warning
      if (idleRemaining <= IDLE_WARN_BEFORE_MS) {
        setMode("idle");
        setCountdownMs(idleRemaining);
        setOpen(true);
      } else {
        // if modal is idle-mode and user became active again, close it
        if (mode === "idle" && idleRemaining > IDLE_WARN_BEFORE_MS + 2000) {
          setOpen(false);
          setMode(null);
        }
      }

      // ===== Token logic =====
      const tokenRemaining = getTokenRemainingMs();

      // auto refresh shortly before expiry (silent)
      if (
        tokenRemaining > 0 &&
        tokenRemaining <= TOKEN_REFRESH_BEFORE_MS &&
        !refreshInFlightRef.current
      ) {
        refreshInFlightRef.current = true;
        try {
          await refresh();
          // if token refreshed, no need to warn
          if (mountedRef.current) {
            if (mode === "token") {
              setOpen(false);
              setMode(null);
            }
          }
        } catch {
          handleAuthExpired("TOKEN_EXPIRED");
        } finally {
          refreshInFlightRef.current = false;
        }
        return;
      }

      // show token expiry warning if near expiry
      if (tokenRemaining > 0 && tokenRemaining <= TOKEN_WARN_BEFORE_MS) {
        setMode("token");
        setCountdownMs(tokenRemaining);
        setOpen(true);
      } else {
        // close token modal if we’re no longer near expiry
        if (mode === "token" && tokenRemaining > TOKEN_WARN_BEFORE_MS + 2000) {
          setOpen(false);
          setMode(null);
        }
      }
    }, TICK_MS);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode]);

  if (!enabled) return null;
  if (!open) return null;

  const title = mode === "idle" ? "You’re about to be signed out" : "Session expiring soon";
  const body =
    mode === "idle"
      ? "You’ve been inactive. For security, we’ll sign you out unless you continue."
      : "Your login session is about to expire. Stay signed in to continue.";

  const primaryLabel = mode === "idle" ? "Continue session" : "Stay signed in";
  const secondaryLabel = "Logout";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: "min(520px, 100%)",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          boxShadow: "0 30px 80px rgba(0,0,0,.35)",
          padding: 16,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{title}</div>
        <div style={{ color: "#374151", fontSize: 14, lineHeight: 1.5 }}>{body}</div>

        <div style={{ marginTop: 10, fontSize: 13, color: "#111827", fontWeight: 800 }}>
          Time remaining: {countdownLabel}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={staySignedIn} disabled={busy}>
            {busy ? "Working..." : primaryLabel}
          </button>

          <button
            className="btn"
            type="button"
            onClick={() => doLogout("USER_LOGOUT")}
            disabled={busy}
            style={{ background: "#6b7280" }}
          >
            {secondaryLabel}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Tip: activity like scrolling or tapping will keep you signed in.
        </div>
      </div>
    </div>
  );
}
