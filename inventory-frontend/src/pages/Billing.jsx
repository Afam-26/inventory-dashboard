// src/pages/Billing.jsx
import { useEffect, useMemo, useState } from "react";
import {
  getPlans,
  getCurrentPlan,
  updateCurrentPlan,
  startStripeCheckout,
  openStripePortal,
} from "../services/api";

export default function Billing({ user }) {
  const role = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = role === "owner" || role === "admin";

  const [plans, setPlans] = useState([]);
  const [stripeEnabled, setStripeEnabled] = useState(false);

  const [current, setCurrent] = useState(null);

  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Optional mapping (ONLY needed for Stripe checkout)
  // If you don’t have Stripe prices yet, leave these as "" and it will auto-fallback to updateCurrentPlan.
  const PRICE_IDS = useMemo(
    () => ({
      pro: import.meta.env.VITE_STRIPE_PRICE_PRO || "",
      business: import.meta.env.VITE_STRIPE_PRICE_BUSINESS || "",
    }),
    []
  );

  async function loadAll() {
    setLoading(true);
    setErr("");
    setMsg("");
    try {
      const [p, c] = await Promise.all([getPlans(), getCurrentPlan()]);
      setPlans(Array.isArray(p?.plans) ? p.plans : []);
      setStripeEnabled(Boolean(p?.stripeEnabled));
      setCurrent(c || null);
    } catch (e) {
      setErr(e?.message || "Failed to load billing");
      setPlans([]);
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function limitLabel(v) {
    if (v == null) return "Unlimited";
    return String(v);
  }

  function usageLine(u) {
    // backend returns { used, limit, pct, label } typically (from makeUsageLine)
    if (!u) return null;
    const used = Number(u.used ?? 0);
    const limit = u.limit == null ? null : Number(u.limit);
    const pct =
      typeof u.pct === "number"
        ? Math.max(0, Math.min(100, u.pct))
        : limit == null
        ? 0
        : Math.max(0, Math.min(100, Math.round((used / Math.max(1, limit)) * 100)));

    return { used, limit, pct, label: u.label || "" };
  }

  async function choosePlan(planKey) {
    if (!isAdmin) {
      setErr("Owner/Admin only");
      return;
    }

    setChanging(true);
    setErr("");
    setMsg("");

    try {
      const key = String(planKey || "").toLowerCase();

      // ✅ If Stripe enabled AND we have priceId AND plan isn’t starter -> checkout flow
      const priceId = PRICE_IDS[key] || "";
      const shouldStripe =
        stripeEnabled && key !== "starter" && priceId && priceId.trim() !== "";

      if (shouldStripe) {
        const r = await startStripeCheckout({ priceId, planKey: key });
        if (r?.url) {
          window.location.href = r.url;
          return;
        }
        // fallback if Stripe didn’t return url
      }

      // ✅ No-payment mode fallback (your original goal)
      await updateCurrentPlan(key);
      setMsg(`Plan updated to "${key}".`);
      await loadAll();
    } catch (e) {
      setErr(e?.message || "Failed to change plan");
    } finally {
      setChanging(false);
    }
  }

  async function openPortal() {
    setChanging(true);
    setErr("");
    setMsg("");
    try {
      const r = await openStripePortal();
      if (r?.url) window.location.href = r.url;
      else setErr("Stripe portal not available");
    } catch (e) {
      setErr(e?.message || "Failed to open Stripe portal");
    } finally {
      setChanging(false);
    }
  }

  const currentKey = String(current?.planKey || "").toLowerCase();

  return (
    <div>
      <h1 style={{ marginBottom: 6 }}>Billing Plans</h1>
      <div style={{ color: "#6b7280", marginBottom: 16 }}>
        Choose a plan for this tenant. (No payment integration — just plan limits/enforcement.)
      </div>

      {err && <div style={{ color: "#b91c1c", marginBottom: 10 }}>{err}</div>}
      {msg && <div style={{ color: "#065f46", marginBottom: 10 }}>{msg}</div>}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <>
          {/* Current plan + usage */}
          {current && (
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                background: "#fff",
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>
                    Current plan:{" "}
                    <span style={{ textTransform: "capitalize" }}>{current.planKey}</span>{" "}
                    <span style={{ color: "#6b7280", fontWeight: 600 }}>
                      ({current.priceLabel || ""})
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    Tenant ID: {current.tenantId}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {stripeEnabled && current?.stripe?.customerId && (
                    <button className="btn" onClick={openPortal} disabled={!isAdmin || changing}>
                      Open Stripe Portal
                    </button>
                  )}
                </div>
              </div>

              {/* Usage meters */}
              {current?.usage && (
                <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  {[
                    ["Categories", usageLine(current.usage.categories)],
                    ["Products", usageLine(current.usage.products)],
                    ["Users", usageLine(current.usage.users)],
                  ].map(([label, u]) => (
                    <div key={label} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#f9fafb" }}>
                      <div style={{ fontWeight: 800 }}>{label}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                        {u?.limit == null ? `${u?.used ?? 0} / Unlimited` : `${u?.used ?? 0} / ${u?.limit ?? 0}`}
                      </div>
                      <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
                        <div style={{ height: "100%", width: `${u?.limit == null ? 0 : (u?.pct ?? 0)}%`, background: "#111827" }} />
                      </div>
                      {u?.label ? (
                        <div style={{ marginTop: 6, fontSize: 12, color: "#374151" }}>{u.label}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Plan cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
            {plans.map((p) => {
              const key = String(p.key || "").toLowerCase();
              const isCurrent = key === currentKey;

              return (
                <div
                  key={p.key}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 14,
                    background: "#fff",
                    boxShadow: "0 8px 22px rgba(0,0,0,.06)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{p.name}</div>
                    <div style={{ color: "#111827", fontWeight: 800 }}>{p.priceLabel}</div>
                  </div>

                  <div style={{ marginTop: 10, fontSize: 13, color: "#374151" }}>
                    <div>Categories limit: <b>{limitLabel(p?.limits?.categories)}</b></div>
                    <div>Products limit: <b>{limitLabel(p?.limits?.products)}</b></div>
                    <div>Users limit: <b>{limitLabel(p?.limits?.users)}</b></div>
                  </div>

                  <button
                    className="btn"
                    style={{ width: "100%", marginTop: 12 }}
                    onClick={() => choosePlan(key)}
                    disabled={!isAdmin || changing || isCurrent}
                    title={!isAdmin ? "Owner/Admin only" : isCurrent ? "Already on this plan" : ""}
                  >
                    {isCurrent ? "Current plan" : changing ? "Please wait..." : "Choose plan"}
                  </button>

                  {stripeEnabled && key !== "starter" && !PRICE_IDS[key] ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#b45309" }}>
                      Stripe is enabled, but no priceId configured for this plan — using no-payment fallback.
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
