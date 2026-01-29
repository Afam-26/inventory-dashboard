import React, { useEffect, useState } from "react";
import { fetchTenants, selectTenant, createTenant } from "../api";

export default function TenantSelect({ navigate }) {
  const [tenants, setTenants] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const t = await fetchTenants();
    const list = t.tenants || [];
    setTenants(list);

    // auto select if exactly one tenant
    if (list.length === 1) {
      await selectTenant(list[0].id);
      navigate("/dashboard");
    }
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message || "Failed"));
  }, []);

  async function pick(id) {
    setBusy(true);
    setErr("");
    try {
      await selectTenant(id);
      navigate("/dashboard");
    } catch (e) {
      setErr(e.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    setBusy(true);
    setErr("");
    try {
      const r = await createTenant({ name });
      await load();
      // optionally auto-select newly created tenant
      await pick(r.tenantId);
    } catch (e) {
      setErr(e.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "40px auto", padding: 16 }}>
      <h2 style={{ marginBottom: 8 }}>Select a tenant</h2>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        You must choose a tenant before accessing Products, Categories, Users, etc.
      </p>

      {err && (
        <div style={{ padding: 12, border: "1px solid #fecaca", background: "#fff1f2", borderRadius: 12 }}>
          {err}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 16 }}>
        {tenants.map((t) => (
          <button
            key={t.id}
            disabled={busy}
            onClick={() => pick(t.id)}
            style={{
              padding: 14,
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              background: "white",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700 }}>{t.name}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Role: {t.role}</div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #eee" }}>
        <h3 style={{ marginBottom: 8 }}>Create tenant</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tenant name"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 260 }}
          />
          <button
            disabled={busy || !name.trim()}
            onClick={handleCreate}
            style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "#111827", color: "white", cursor: "pointer" }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
