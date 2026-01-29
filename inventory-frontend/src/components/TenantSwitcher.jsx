import { useEffect, useState, useCallback } from "react";
import { getMyTenants, selectTenantApi } from "../services/api";

export default function TenantSwitcher({ onChanged }) {
  const [tenants, setTenants] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMyTenants();
      setTenants(Array.isArray(data?.tenants) ? data.tenants : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  async function selectTenant(id) {
    await selectTenantApi(id);
    setOpen(false);
    onChanged?.();
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        style={{ padding: "6px 10px", borderRadius: 8 }}
      >
        Tenant ▾
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "110%",
          right: 0,
          width: 220,
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          background: "#fff",
          zIndex: 20
        }}>
          {tenants.length === 0 ? (
            <div style={{ padding: 12 }}>No tenants</div>
          ) : (
            tenants.map(t => (
              <button
                key={t.id}
                onClick={() => selectTenant(t.id)}
                style={{
                  width: "100%",
                  padding: 10,
                  textAlign: "left",
                  border: "none",
                  background: "white",
                  cursor: "pointer"
                }}
              >
                <strong>{t.name}</strong>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  role: {t.role}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
