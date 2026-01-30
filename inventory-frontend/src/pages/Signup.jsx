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

      // store (api.js already does, but safe to keep)
      if (data?.token) setToken(data.token);
      if (data?.user) setStoredUser(data.user);

      // go to tenant selection
      nav("/select-tenant", { replace: true, state: { tenants: data?.tenants || [], from: "/" } });
    } catch (e2) {
      setErr(e2?.message || "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  const bg = {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 18,
    background:
      "radial-gradient(1200px 600px at 20% 20%, rgba(99,102,241,.35), transparent 60%)," +
      "radial-gradient(900px 500px at 90% 30%, rgba(16,185,129,.25), transparent 55%)," +
      "radial-gradient(1000px 600px at 60% 90%, rgba(244,63,94,.18), transparent 60%)," +
      "#0b1020",
  };

  const shell = {
    width: 1040,
    maxWidth: "100%",
    display: "grid",
    gridTemplateColumns: "1.15fr .85fr",
    gap: 16,
  };

  const card = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.08)",
    backdropFilter: "blur(14px)",
    boxShadow: "0 30px 80px rgba(0,0,0,.35)",
    color: "#fff",
    overflow: "hidden",
  };

  const left = { ...card, padding: 18 };
  const right = { ...card, padding: 18 };

  const input = {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(0,0,0,.18)",
    color: "#fff",
    outline: "none",
  };

  const btn = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.18)",
    background: "linear-gradient(135deg, rgba(99,102,241,.95), rgba(16,185,129,.75))",
    color: "#fff",
    fontWeight: 800,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.75 : 1,
  };

  return (
    <div style={bg}>
      <div style={{ width: 1040, maxWidth: "100%" }}>
        <div style={{ color: "#fff", marginBottom: 10 }}>
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.4 }}>Create your workspace</div>
          <div style={{ color: "rgba(255,255,255,.72)" }}>
            Pick a plan, set up your tenant, and start managing inventory.
          </div>
        </div>

        <div style={shell}>
          {/* LEFT: Signup form */}
          <div style={left}>
            {err ? (
              <div
                style={{
                  background: "rgba(239,68,68,.18)",
                  border: "1px solid rgba(239,68,68,.35)",
                  padding: 12,
                  borderRadius: 12,
                  marginBottom: 12,
                  color: "#fecaca",
                }}
              >
                {err}
              </div>
            ) : null}

            <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Full name</div>
                  <input
                    style={input}
                    value={form.full_name}
                    onChange={(e) => setField("full_name", e.target.value)}
                    placeholder="Admin User"
                    disabled={busy}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Workspace name</div>
                  <input
                    style={input}
                    value={form.tenantName}
                    onChange={(e) => setField("tenantName", e.target.value)}
                    placeholder="e.g. Tyre Shop HQ"
                    disabled={busy}
                  />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Email</div>
                <input
                  style={input}
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="you@company.com"
                  disabled={busy}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Password</div>
                <input
                  style={input}
                  type="password"
                  value={form.password}
                  onChange={(e) => setField("password", e.target.value)}
                  placeholder="At least 8 characters"
                  disabled={busy}
                />
              </div>

              <button type="submit" style={btn} disabled={busy}>
                {busy ? "Creating..." : `Create workspace • ${selected.name}`}
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.85 }}>
                <div>
                  Already have an account?{" "}
                  <Link to="/login" style={{ color: "#a5b4fc", textDecoration: "none" }}>
                    Sign in
                  </Link>
                </div>
                <div style={{ opacity: 0.75 }}>Plan can be changed later</div>
              </div>
            </form>
          </div>

          {/* RIGHT: Plan chooser */}
          <div style={right}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Choose a plan</div>

            <div style={{ display: "grid", gap: 10 }}>
              {PLANS.map((p) => {
                const active = p.key === planKey;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPlanKey(p.key)}
                    disabled={busy}
                    style={{
                      textAlign: "left",
                      width: "100%",
                      padding: 12,
                      borderRadius: 14,
                      border: active ? "1px solid rgba(255,255,255,.55)" : "1px solid rgba(255,255,255,.14)",
                      background: active ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.14)",
                      color: "#fff",
                      cursor: busy ? "not-allowed" : "pointer",
                      boxShadow: active ? "0 18px 40px rgba(0,0,0,.25)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 900 }}>{p.name}</div>
                      <div style={{ fontWeight: 900 }}>{p.price}</div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{p.tag}</div>
                    <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12, opacity: 0.9 }}>
                      {p.bullets.map((b) => (
                        <li key={b} style={{ marginBottom: 4 }}>
                          {b}
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
              For Stripe checkout, connect prices in your Billing page later (Pro/Business).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
