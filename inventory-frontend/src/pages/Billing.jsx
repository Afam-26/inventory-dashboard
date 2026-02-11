// inventory-frontend/src/pages/Billing.jsx
import { useEffect, useMemo, useState } from "react";
import {
  fetchBillingPlans,
  fetchBillingCurrent,
  beginCheckout,
  openBillingPortal,
  setPlanManually,
} from "../services/billing";
import PlanBanner from "../components/billing/PlanBanner";
import { getPlanBannerFromCurrent, getPlanBannerFromApiError } from "../utils/planUi";

/**
 * Local helpers so this page can fetch Stripe prices
 * without relying on other service modules.
 */
const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:5000") + "/api";

function authHeaders() {
  const t = localStorage.getItem("token") || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function Billing({ user }) {
  const role = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = role === "owner" || role === "admin";

  const [plans, setPlans] = useState([]);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [current, setCurrent] = useState(null);

  const [interval, setInterval] = useState("month"); // "month" | "year"
  const intervalKey = interval === "year" ? "yearly" : "monthly";

  const [banner, setBanner] = useState(null);

  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [stripePrices, setStripePrices] = useState(null);

  const currentKey = String(current?.planKey || "").toLowerCase();
  const tenantStatus = String(current?.tenantStatus || "active").toLowerCase();
  const stripeStatus = String(current?.stripe?.status || "").toLowerCase();
  const trialUsedAt = current?.trial?.usedAt || null;
  const isTrialActive = stripeStatus === "trialing";

  function limitLabel(v) {
    if (v == null) return "Unlimited";
    return String(v);
  }

  function fmtMoneyFromStripePrice(p) {
    if (!p || typeof p.unit_amount !== "number") return "";
    const dollars = p.unit_amount / 100;
    const currency = String(p.currency || "usd").toUpperCase();
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(dollars);
  }

  function priceTextFor(planKey, whichIntervalKey) {
    const k = String(planKey || "").toLowerCase();
    const p = stripePrices?.[k]?.[whichIntervalKey];
    const money = fmtMoneyFromStripePrice(p);
    if (!money) return "";
    return `${money}${whichIntervalKey === "yearly" ? "/yr" : "/mo"}`;
  }

  const currentPriceText = useMemo(() => {
    // Prefer backend-provided label if present, otherwise compute from Stripe price map
    const label = String(current?.priceLabel || "").trim();
    if (label) return label;

    const t = priceTextFor(currentKey, intervalKey);
    return t || "";
  }, [current?.priceLabel, currentKey, intervalKey, stripePrices]);

  async function loadAll() {
    setLoading(true);
    setErr("");
    setMsg("");

    try {
      const [p, c] = await Promise.all([fetchBillingPlans(), fetchBillingCurrent()]);
      setPlans(Array.isArray(p?.plans) ? p.plans : []);
      setStripeEnabled(Boolean(p?.stripeEnabled));
      setCurrent(c || null);
      setBanner(getPlanBannerFromCurrent(c));
    } catch (e) {
      const b = getPlanBannerFromApiError(e);
      if (b) setBanner(b);
      setErr(e?.message || "Failed to load billing");
      setPlans([]);
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadStripePrices() {
    try {
      // Route you added on backend: GET /api/billing/stripe/prices
      const res = await fetch(`${API_BASE}/billing/stripe/prices`, {
        method: "GET",
        headers: { ...authHeaders() },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // non-fatal: page still works without price display
        return;
      }
      setStripePrices(data || null);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    loadAll();
    loadStripePrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      // If Stripe disabled, allow manual switching
      if (!stripeEnabled) {
        await setPlanManually(key);
        setMsg(`Plan updated to "${key}".`);
        await loadAll();
        return;
      }

      // Stripe checkout for ALL plans (Starter includes trial; Growth/Pro no trial)
      const r = await beginCheckout({ planKey: key, interval });
      if (r?.url) {
        window.location.href = r.url;
        return;
      }

      setErr("Stripe checkout not available");
    } catch (e) {
      const b = getPlanBannerFromApiError(e);
      if (b) setBanner(b);
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
      const r = await openBillingPortal();
      if (r?.url) window.location.href = r.url;
      else setErr("Stripe portal not available");
    } catch (e) {
      const b = getPlanBannerFromApiError(e);
      if (b) setBanner(b);
      setErr(e?.message || "Failed to open Stripe portal");
    } finally {
      setChanging(false);
    }
  }

  const usageGridStyle = { marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "1fr" };
  const plansGridStyle = { display: "grid", gridTemplateColumns: "1fr", gap: 14 };

  return (
    <div style={{ width: "100%", maxWidth: 1100 }}>
      <h1 style={{ marginBottom: 6 }}>Billing Plans</h1>
      <div style={{ color: "#6b7280", marginBottom: 14 }}>
        Starter includes a 7-day free trial (first time only). Growth/Pro have no trial.
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

      <PlanBanner banner={banner} />

      {err && <div style={{ color: "#b91c1c", marginBottom: 10 }}>{err}</div>}
      {msg && <div style={{ color: "#065f46", marginBottom: 10 }}>{msg}</div>}

      {/* Interval toggle */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontWeight: 900 }}>Billing interval:</div>

        <button
          className="btn"
          type="button"
          onClick={() => setInterval("month")}
          disabled={changing}
          style={{
            background: interval === "month" ? "#111827" : "#fff",
            color: interval === "month" ? "#fff" : "#111827",
            border: "1px solid #e5e7eb",
          }}
        >
          Monthly
        </button>

        <button
          className="btn"
          type="button"
          onClick={() => setInterval("year")}
          disabled={changing}
          style={{
            background: interval === "year" ? "#111827" : "#fff",
            color: interval === "year" ? "#fff" : "#111827",
            border: "1px solid #e5e7eb",
          }}
        >
          Yearly
        </button>

        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Starter trial: {trialUsedAt ? "already used" : "available (7 days)"} {isTrialActive ? "• currently in trial" : ""}
        </div>
      </div>

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
                    <span style={{ color: "#6b7280", fontWeight: 600 }}>
                      ({currentPriceText || (stripeEnabled ? "Price unavailable" : "Manual")})
                    </span>
                    {isTrialActive ? (
                      <span style={{ marginLeft: 8, fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "#111827", color: "#fff" }}>
                        TRIAL
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    Tenant ID: {current.tenantId} • Status: {tenantStatus}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {stripeEnabled && current?.stripe?.customerId ? (
                    <button className="btn" onClick={openPortal} disabled={!isAdmin || changing}>
                      Manage Billing
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Usage meters */}
              {current?.usage && (
                <div className="billing-usage-grid" style={usageGridStyle}>
                  {[
                    ["Categories", current.usage.categories],
                    ["Products", current.usage.products],
                    ["Users", current.usage.users],
                  ].map(([label, u]) => {
                    const used = Number(u?.used ?? 0);
                    const limit = u?.limit == null ? null : Number(u.limit);
                    const pct =
                      typeof u?.pct === "number"
                        ? Math.max(0, Math.min(100, u.pct))
                        : limit == null
                        ? 0
                        : Math.max(0, Math.min(100, Math.round((used / Math.max(1, limit)) * 100)));

                    return (
                      <div key={label} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#f9fafb", minWidth: 0 }}>
                        <div style={{ fontWeight: 800 }}>{label}</div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                          {limit == null ? `${used} / Unlimited` : `${used} / ${limit}`}
                        </div>

                        <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
                          <div style={{ height: "100%", width: `${limit == null ? 0 : pct}%`, background: "#111827" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Plan cards */}
          <div className="billing-plans-grid" style={plansGridStyle}>
            {plans.map((p) => {
              const key = String(p.key || "").toLowerCase();
              const isCurrent = key === currentKey;

              const disabledBecause =
                !isAdmin
                  ? "Owner/Admin only"
                  : tenantStatus === "canceled"
                  ? "Subscription canceled (upgrade to restore)"
                  : tenantStatus === "past_due"
                  ? "Past due (update payment)"
                  : isCurrent
                  ? "Already on this plan"
                  : "";

              const disabled = !isAdmin || tenantStatus === "canceled" || tenantStatus === "past_due" || isCurrent || changing;

              const cardPrice = priceTextFor(key, intervalKey);
              const intervalLabel = interval === "year" ? "Yearly" : "Monthly";

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
                    <div style={{ color: "#111827", fontWeight: 800 }}>{intervalLabel}</div>
                  </div>

                  {/* ✅ Price row */}
                  <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 22, fontWeight: 950, color: "#111827" }}>
                      {cardPrice ? cardPrice : stripeEnabled ? "—" : "Manual"}
                    </div>
                    {stripeEnabled ? (
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {stripePrices ? "" : "Loading prices…"}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 10, fontSize: 13, color: "#374151" }}>
                    <div>
                      Categories limit: <b>{limitLabel(p?.limits?.categories)}</b>
                    </div>
                    <div>
                      Products limit: <b>{limitLabel(p?.limits?.products)}</b>
                    </div>
                    <div>
                      Users limit: <b>{limitLabel(p?.limits?.users)}</b>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                      Audit days: <b>{limitLabel(p?.limits?.auditDays)}</b>
                    </div>
                  </div>

                  <button
                    className="btn"
                    style={{ width: "100%", marginTop: 12 }}
                    onClick={() => choosePlan(key)}
                    disabled={disabled}
                    title={disabled ? disabledBecause : ""}
                  >
                    {isCurrent ? "Current plan" : changing ? "Please wait..." : "Upgrade"}
                  </button>

                  {/* Trial note only for starter */}
                  {stripeEnabled && key === "starter" && !trialUsedAt ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#065f46" }}>
                      Includes a 7-day free trial (first time only).
                    </div>
                  ) : null}

                  {stripeEnabled && key !== "starter" ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                      No trial on this plan.
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
