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
    if (!u) return null;
    const used = Number(u.used ?? 0);
    const limit = u.limit == null ? null : Number(u.limit);
    const pct =
      typeof u.pct === "number"
        ? Math.max(0, Math.min(100, u.pct))
        : limit == null
        ? 0
        : Math.max(0, Math.min(100, Math.round((used / Math.max(1, limit)) * 100)));

    return { used, limit, pct, label: u.label || "", ok: u.ok };
  }

  const currentKey = String(current?.planKey || "").toLowerCase();
  const tenantStatus = String(current?.tenantStatus || "active").toLowerCase();

  const overLimit = useMemo(() => {
    const u = current?.usage;
    if (!u) return false;

    const lines = [
      usageLine(u.categories),
      usageLine(u.products),
      usageLine(u.users),
    ].filter(Boolean);

    return lines.some((x) => x.limit != null && x.used > x.limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

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

      // ✅ Stripe upgrade path (backend maps planKey -> priceId)
      const shouldStripe = stripeEnabled && key !== "starter";

      if (shouldStripe) {
        const r = await startStripeCheckout({ planKey: key });
        if (r?.url) {
          window.location.href = r.url;
          return;
        }
        throw new Error("Stripe checkout not available");
      }

      // fallback (no Stripe)
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

  // ✅ Responsive grids (no CSS file changes required)
  const usageGridStyle = {
    marginTop: 12,
    display: "grid",
    gap: 10,
    gridTemplateColumns: "1fr",
  };

  const plansGridStyle = {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 14,
  };

  return (
    <div style={{ width: "100%", maxWidth: 1100 }}>
      <h1 style={{ marginBottom: 6 }}>Billing Plans</h1>
      <div style={{ color: "#6b7280", marginBottom: 16 }}>
        Choose a plan for this tenant. Upgrades use Stripe (if enabled). Downgrades are managed in Stripe Portal.
      </div>

      <style>{`
        @media (min-width: 640px) {
          .billing-usage-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .billing-plans-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (min-width: 980px) {
          .billing-usage-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .billing-plans-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
      `}</style>

      {err && <div style={{ color: "#b91c1c", marginBottom: 10 }}>{err}</div>}
      {msg && <div style={{ color: "#065f46", marginBottom: 10 }}>{msg}</div>}

      {/* ✅ BANNERS */}
      {!loading && current ? (
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          {tenantStatus === "past_due" ? (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 12, color: "#78350f" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>Payment issue: account is past due</div>
                  <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
                    Some actions may be restricted until payment is updated.
                  </div>
                </div>
                <button
                  className="btn"
                  onClick={openPortal}
                  disabled={!isAdmin || changing || !stripeEnabled || !current?.stripe?.customerId}
                >
                  Update payment
                </button>
              </div>
            </div>
          ) : null}

          {tenantStatus === "canceled" ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 12, color: "#7f1d1d" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>Subscription canceled</div>
                  <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
                    Choose a paid plan to reactivate.
                  </div>
                </div>
                <button
                  className="btn"
                  onClick={() => choosePlan("growth")}
                  disabled={!isAdmin || changing || !stripeEnabled}
                >
                  Reactivate
                </button>
              </div>
            </div>
          ) : null}

          {overLimit ? (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 12, color: "#78350f" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>You’re over your plan limits</div>
                  <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
                    Creating new items may be blocked until you’re under the limit or you upgrade.
                  </div>
                </div>
                <button
                  className="btn"
                  onClick={() => choosePlan("growth")}
                  disabled={!isAdmin || changing || !stripeEnabled}
                >
                  Upgrade
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <>
          {/* Current plan + usage */}
          {current && (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>
                    Current plan: <span style={{ textTransform: "capitalize" }}>{current.planKey}</span>{" "}
                    <span style={{ color: "#6b7280", fontWeight: 600 }}>({current.priceLabel || ""})</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    Tenant ID: {current.tenantId} • Status: {tenantStatus}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {stripeEnabled && current?.stripe?.customerId && (
                    <button className="btn" onClick={openPortal} disabled={!isAdmin || changing}>
                      Manage Billing
                    </button>
                  )}
                </div>
              </div>

              {current?.usage && (
                <div className="billing-usage-grid" style={usageGridStyle}>
                  {[
                    ["Categories", usageLine(current.usage.categories)],
                    ["Products", usageLine(current.usage.products)],
                    ["Users", usageLine(current.usage.users)],
                  ].map(([label, u]) => (
                    <div key={label} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#f9fafb", minWidth: 0 }}>
                      <div style={{ fontWeight: 800 }}>{label}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                        {u?.limit == null ? `${u?.used ?? 0} / Unlimited` : `${u?.used ?? 0} / ${u?.limit ?? 0}`}
                      </div>

                      <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${u?.limit == null ? 0 : u?.pct ?? 0}%`,
                            background: u?.limit != null && u?.used > u?.limit ? "#b45309" : "#111827",
                          }}
                        />
                      </div>

                      {u?.label ? <div style={{ marginTop: 6, fontSize: 12, color: "#374151" }}>{u.label}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Plan cards */}
          <div className="billing-plans-grid" style={plansGridStyle}>
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
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{p.name}</div>
                    <div style={{ color: "#111827", fontWeight: 800 }}>{p.priceLabel}</div>
                  </div>

                  <div style={{ marginTop: 10, fontSize: 13, color: "#374151" }}>
                    {"locations" in (p?.limits || {}) ? (
                      <div>
                        Locations limit: <b>{limitLabel(p?.limits?.locations)}</b>
                      </div>
                    ) : null}
                    <div>
                      Products limit: <b>{limitLabel(p?.limits?.products)}</b>
                    </div>
                    <div>
                      Users limit: <b>{limitLabel(p?.limits?.users)}</b>
                    </div>
                    {"auditDays" in (p?.limits || {}) ? (
                      <div>
                        Audit retention: <b>{limitLabel(p?.limits?.auditDays)} days</b>
                      </div>
                    ) : null}
                  </div>

                  <button
                    className="btn"
                    style={{ width: "100%", marginTop: 12 }}
                    onClick={() => choosePlan(key)}
                    disabled={!isAdmin || changing || isCurrent}
                    title={!isAdmin ? "Owner/Admin only" : isCurrent ? "Already on this plan" : ""}
                  >
                    {isCurrent ? "Current plan" : changing ? "Please wait..." : stripeEnabled && key !== "starter" ? "Upgrade (Stripe)" : "Choose plan"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
