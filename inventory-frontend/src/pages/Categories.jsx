// inventory-frontend/src/pages/Categories.jsx
import { useEffect, useMemo, useState } from "react";
import {
  getCategories,
  addCategory,
  deleteCategory,
  getDeletedCategories,
  restoreCategory,
  getCurrentPlan,
} from "../services/api";
import PlanBanner from "../components/billing/PlanBanner";
import {
  getPlanBannerFromApiError,
  getPlanBannerFromCurrent,
  disabledReason,
} from "../utils/planUi";

export default function Categories({ user }) {
  const role = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = role === "owner" || role === "admin";

  const [tab, setTab] = useState("active"); // "active" | "deleted"

  const [rows, setRows] = useState([]);
  const [deletedRows, setDeletedRows] = useState([]);

  const [name, setName] = useState("");

  const [current, setCurrent] = useState(null);
  const [banner, setBanner] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const tenantStatus = String(current?.tenantStatus || "active").toLowerCase();

  const canMutate = useMemo(() => {
    // You can decide to allow writes on past_due; this is stricter
    if (!isAdmin) return false;
    if (tenantStatus === "canceled") return false;
    if (tenantStatus === "past_due") return false;
    return true;
  }, [isAdmin, tenantStatus]);

  const whyDisabled = useMemo(() => {
    return disabledReason({ isAdmin, tenantStatus, label: "Categories" });
  }, [isAdmin, tenantStatus]);

  async function loadAll({ keepMsgs = false } = {}) {
    setLoading(true);
    if (!keepMsgs) {
      setErr("");
      setMsg("");
    }

    try {
      const [cur, active, del] = await Promise.all([
        getCurrentPlan(),
        getCategories(),
        getDeletedCategories().catch(() => []), // if backend forbids for staff, don’t crash
      ]);

      setCurrent(cur || null);
      setBanner(getPlanBannerFromCurrent(cur));

      setRows(Array.isArray(active) ? active : Array.isArray(active?.categories) ? active.categories : []);
      setDeletedRows(Array.isArray(del) ? del : Array.isArray(del?.categories) ? del.categories : []);
    } catch (e) {
      const b = getPlanBannerFromApiError(e);
      if (b) setBanner(b);

      setErr(e?.message || "Failed to load categories");
      setRows([]);
      setDeletedRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e) {
    e?.preventDefault?.();
    setErr("");
    setMsg("");

    const trimmed = String(name || "").trim();
    if (!trimmed) {
      setErr("Category name is required");
      return;
    }

    if (!canMutate) {
      setErr(whyDisabled || "Owner/Admin only");
      return;
    }

    setBusy(true);
    try {
      await addCategory(trimmed);
      setName("");
      setMsg("Category created.");
      await loadAll({ keepMsgs: true });
    } catch (e2) {
      const b = getPlanBannerFromApiError(e2);
      if (b) setBanner(b);
      setErr(e2?.message || "Failed to create category");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id) {
    setErr("");
    setMsg("");

    if (!canMutate) {
      setErr(whyDisabled || "Owner/Admin only");
      return;
    }

    const ok = window.confirm("Delete this category? (It can be restored later)");
    if (!ok) return;

    setBusy(true);
    try {
      await deleteCategory(id);
      setMsg("Category deleted.");
      await loadAll({ keepMsgs: true });
    } catch (e2) {
      const b = getPlanBannerFromApiError(e2);
      if (b) setBanner(b);
      setErr(e2?.message || "Failed to delete category");
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(id) {
    setErr("");
    setMsg("");

    if (!canMutate) {
      setErr(whyDisabled || "Owner/Admin only");
      return;
    }

    setBusy(true);
    try {
      await restoreCategory(id);
      setMsg("Category restored.");
      await loadAll({ keepMsgs: true });
    } catch (e2) {
      const b = getPlanBannerFromApiError(e2);
      if (b) setBanner(b);
      setErr(e2?.message || "Failed to restore category");
    } finally {
      setBusy(false);
    }
  }

  const activeList = rows;
  const deletedList = deletedRows;

  const cardStyle = {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
    boxShadow: "0 8px 22px rgba(0,0,0,.06)",
  };

  const pillStyle = (active) => ({
    border: "1px solid #e5e7eb",
    background: active ? "#111827" : "#fff",
    color: active ? "#fff" : "#111827",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  });

  return (
    <div style={{ width: "100%", maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Categories</h1>
          <div style={{ color: "#6b7280" }}>
            Manage categories for this tenant. (Soft delete + restore supported.)
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            onClick={() => setTab("active")}
            style={pillStyle(tab === "active")}
          >
            Active ({activeList.length})
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => setTab("deleted")}
            style={pillStyle(tab === "deleted")}
            disabled={!isAdmin}
            title={!isAdmin ? "Owner/Admin only" : ""}
          >
            Deleted ({deletedList.length})
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <PlanBanner banner={banner} />
      </div>

      {err ? (
        <div
          style={{
            marginTop: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 12,
            padding: 12,
            color: "#991b1b",
          }}
        >
          {err}
        </div>
      ) : null}

      {msg ? (
        <div
          style={{
            marginTop: 10,
            background: "#ecfdf5",
            border: "1px solid #bbf7d0",
            borderRadius: 12,
            padding: 12,
            color: "#065f46",
          }}
        >
          {msg}
        </div>
      ) : null}

      {/* Create */}
      <div style={{ marginTop: 14, ...cardStyle }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Add category</div>

        <form onSubmit={onCreate} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name"
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              minWidth: 260,
              flex: "1 1 260px",
            }}
            disabled={!canMutate || busy}
            title={!canMutate ? whyDisabled : ""}
          />

          <button
            className="btn"
            type="submit"
            disabled={!canMutate || busy}
            title={!canMutate ? whyDisabled : ""}
          >
            {busy ? "Working..." : "Add"}
          </button>

          {!canMutate ? (
            <div style={{ fontSize: 12, color: "#6b7280", alignSelf: "center" }}>
              Tip: Hover disabled buttons to see why.
            </div>
          ) : null}
        </form>
      </div>

      {/* List */}
      <div style={{ marginTop: 14, ...cardStyle }}>
        {loading ? (
          <div>Loading…</div>
        ) : tab === "active" ? (
          <>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Active categories</div>

            {!activeList.length ? (
              <div style={{ color: "#6b7280" }}>No categories yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {activeList.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                      background: "#f9fafb",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{c.name}</div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        onClick={() => onDelete(c.id)}
                        disabled={!canMutate || busy}
                        title={!canMutate ? whyDisabled : "Soft delete"}
                        style={{ background: "#6b7280" }}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Deleted categories</div>

            {!isAdmin ? (
              <div style={{ color: "#6b7280" }}>
                Owner/Admin only.
              </div>
            ) : !deletedList.length ? (
              <div style={{ color: "#6b7280" }}>No deleted categories.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {deletedList.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                      background: "#fff",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                        Deleted at: {c.deleted_at ? String(c.deleted_at) : "—"}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        onClick={() => onRestore(c.id)}
                        disabled={!canMutate || busy}
                        title={!canMutate ? whyDisabled : "Restore (counts toward plan limit)"}
                        type="button"
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Tiny footer hint */}
      <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
        Note: Category restore counts toward your plan limit. If you hit a limit, upgrade in Billing.
      </div>
    </div>
  );
}
