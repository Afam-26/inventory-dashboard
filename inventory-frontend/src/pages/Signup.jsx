// src/pages/Signup.jsx
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register, setToken, setStoredUser } from "../services/api";

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: "$0",
    tag: "Best to start",
    bullets: ["100 categories", "200 products", "3 users", "Audit logs"],
  },
  {
    key: "pro",
    name: "Pro",
    price: "$19/mo",
    tag: "Most popular",
    bullets: ["200 categories", "2,000 products", "10 users", "CSV import/export"],
  },
  {
    key: "business",
    name: "Business",
    price: "$49/mo",
    tag: "Scale up",
    bullets: ["Unlimited categories", "Unlimited products", "Unlimited users", "Priority support"],
  },
];

export default function Signup() {
  const nav = useNavigate();

  const [planKey, setPlanKey] = useState("starter");
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    tenantName: "",
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const selected = useMemo(() => PLANS.find((p) => p.key === planKey) || PLANS[0], [planKey]);

  function setField(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");

    const full_name = String(form.full_name || "").trim();
    const email = String(form.email || "").trim().toLowerCase();
    const password = String(form.password || "");
    const tenantName = String(form.tenantName || "").trim();

    if (!full_name) return setErr("Full name is required.");
    if (!email) return setErr("Email is required.");
    if (password.length < 8) return setErr("Password must be at least 8 characters.");
    if (!tenantName) return setErr("Workspace name is required.");

    setBusy(true);
    try {
      const data = await register({ full_name, email, password, tenantName, planKey });

      if (data?.token) setToken(data.token);
      if (data?.user) setStoredUser(data.user);

      nav("/select-tenant", { replace: true, state: { tenants: data?.tenants || [], from: "/" } });
    } catch (e2) {
      setErr(e2?.message || "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-enter signup-bg">
      <div className="signup-container">
        <div className="signup-head">
          <div className="signup-title">Create your workspace</div>
          <div className="signup-sub">
            Pick a plan, set up your tenant, and start managing inventory.
          </div>
        </div>

        <div className="signup-shell">
          {/* LEFT: Signup form */}
          <div className="signup-card">
            {err ? <div className="signup-error">{err}</div> : null}

            <form onSubmit={submit} className="signup-form">
              <div className="signup-row2">
                <div className="signup-field">
                  <div className="signup-label">Full name</div>
                  <input
                    className="signup-input"
                    value={form.full_name}
                    onChange={(e) => setField("full_name", e.target.value)}
                    placeholder="Admin User"
                    disabled={busy}
                    autoComplete="name"
                  />
                </div>

                <div className="signup-field">
                  <div className="signup-label">Workspace name</div>
                  <input
                    className="signup-input"
                    value={form.tenantName}
                    onChange={(e) => setField("tenantName", e.target.value)}
                    placeholder="e.g. Tyre Shop HQ"
                    disabled={busy}
                    autoComplete="organization"
                  />
                </div>
              </div>

              <div className="signup-field">
                <div className="signup-label">Email</div>
                <input
                  className="signup-input"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="you@company.com"
                  disabled={busy}
                  autoComplete="email"
                />
              </div>

              <div className="signup-field">
                <div className="signup-label">Password</div>
                <input
                  className="signup-input"
                  type="password"
                  value={form.password}
                  onChange={(e) => setField("password", e.target.value)}
                  placeholder="At least 8 characters"
                  disabled={busy}
                  autoComplete="new-password"
                />
              </div>

              <button className="signup-btn" type="submit" disabled={busy}>
                {busy ? "Creating..." : `Create workspace • ${selected.name}`}
              </button>

              <div className="signup-foot">
                <div>
                  Already have an account?{" "}
                  <Link className="signup-link" to="/login">
                    Sign in
                  </Link>
                  <span className="signup-dot"> • </span>
                  <Link className="signup-link" to="/">
                    Back to landing
                  </Link>
                </div>

                <div className="signup-note">Plan can be changed later</div>
              </div>
            </form>
          </div>

          {/* RIGHT: Plan chooser */}
          <div className="signup-card">
            <div className="signup-planHead">Choose a plan</div>

            <div className="signup-planGrid">
              {PLANS.map((p) => {
                const active = p.key === planKey;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPlanKey(p.key)}
                    disabled={busy}
                    className={`signup-planBtn ${active ? "active" : ""}`}
                  >
                    <div className="signup-planTop">
                      <div className="signup-planName">{p.name}</div>
                      <div className="signup-planPrice">{p.price}</div>
                    </div>

                    <div className="signup-planTag">{p.tag}</div>

                    <ul className="signup-planList">
                      {p.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>

            <div className="signup-planHint">
              For Stripe checkout, connect prices in your Billing page later (Pro/Business).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
