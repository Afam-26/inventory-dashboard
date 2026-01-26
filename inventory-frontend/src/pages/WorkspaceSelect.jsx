import React, { useEffect, useState } from "react";
import { apiFetch } from "../api";

export default function WorkspaceSelect({ onSelected }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch("/tenants");
        setTenants(data.tenants || []);
      } catch (e) {
        setErr(e.message || "Failed to load workspaces");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function selectTenant(tenantId) {
    setErr("");
    try {
      const data = await apiFetch("/tenants/select", {
        method: "POST",
        body: JSON.stringify({ tenantId }),
      });

      localStorage.setItem("token", data.token);
      localStorage.setItem("tenantId", String(data.tenantId));
      localStorage.setItem("role", data.role);

      onSelected?.();
    } catch (e) {
      setErr(e.message || "Failed to select workspace");
    }
  }

  if (loading) return <div>Loading workspaces...</div>;
  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  return (
    <div style={{ maxWidth: 520, margin: "24px auto" }}>
      <h2>Select a workspace</h2>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {tenants.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTenant(t.id)}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ddd",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700 }}>{t.name}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Role: {t.role} • Plan: {t.plan_key} • Status: {t.status}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
