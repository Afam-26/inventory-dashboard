import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getMyTenants, selectTenantApi, setTenantId, setToken, setStoredUser, getStoredUser } from "../services/api";

export default function SelectTenant({ onSuccess }) {
  const nav = useNavigate();
  const loc = useLocation();

  const from = loc.state?.from || "/";
  const [tenants, setTenants] = useState(Array.isArray(loc.state?.tenants) ? loc.state.tenants : []);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      setTenants((current) => {
        if (current.length) return current;
        return current;
      });

      try {
        const t = await getMyTenants();
        if (!mounted) return;
        setTenants(Array.isArray(t?.tenants) ? t.tenants : []);
      } catch (e) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load tenants");
      }
    }

    load();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(id) {
    setErr("");
    setLoading(true);
    try {
      const sel = await selectTenantApi(id);
      if (!sel?.token || !sel?.tenantId) throw new Error("Tenant selection failed.");

      setToken(sel.token);
      setTenantId(sel.tenantId);

      const base = getStoredUser() || {};
      const u = { ...base, tenantId: sel.tenantId, tenantRole: sel.role };
      setStoredUser(u);
      onSuccess?.(u);

      nav(from, { replace: true });
    } catch (e) {
      setErr(e?.message || "Failed to select tenant");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, padding: 18 }}>
      <h1>Select Tenant</h1>
      <p style={{ color: "#6b7280" }}>Choose which workspace to use.</p>

      {err ? (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 12, color: "#991b1b" }}>
          {err}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {tenants.map((t) => (
          <button
            key={t.id}
            className="btn"
            disabled={loading}
            onClick={() => pick(t.id)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span>
              <b>{t.name}</b> <span style={{ color: "#6b7280" }}>({t.slug})</span>
            </span>
            <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "#111827", color: "#fff" }}>
              {String(t.role || "").toUpperCase()}
            </span>
          </button>
        ))}

        {!tenants.length && !err ? <div>Loading tenants...</div> : null}
      </div>
    </div>
  );
}
