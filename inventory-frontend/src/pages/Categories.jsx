// src/pages/Categories.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  getCategories,
  createCategory,
  deleteCategory,
  getDeletedCategories,
  restoreCategory,
} from "../services/api";

export default function Categories({ user }) {
  const uiRole = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = uiRole === "admin" || uiRole === "owner";

  const [tab, setTab] = useState("active"); // active | deleted
  const [activeRows, setActiveRows] = useState([]);
  const [deletedRows, setDeletedRows] = useState([]);

  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState(null);

  const filteredActive = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeRows;
    return activeRows.filter((c) => String(c.name || "").toLowerCase().includes(q));
  }, [activeRows, query]);

  const filteredDeleted = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deletedRows;
    return deletedRows.filter((c) => String(c.name || "").toLowerCase().includes(q));
  }, [deletedRows, query]);

  async function loadActive() {
    const rows = await getCategories();
    setActiveRows(Array.isArray(rows) ? rows : []);
  }

  async function loadDeleted() {
    const rows = await getDeletedCategories();
    // backend returns array rows
    setDeletedRows(Array.isArray(rows) ? rows : []);
  }

  async function load() {
    setLoading(true);
    setPageErr("");
    try {
      await loadActive();
      if (isAdmin) await loadDeleted(); // only admins can access deleted endpoint
    } catch (e) {
      setPageErr(e?.message || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setPageErr("");

    const trimmed = String(name || "").trim();
    if (!trimmed) return;

    setCreating(true);
    try {
      await createCategory(trimmed);
      setName("");
      await loadActive();
    } catch (e2) {
      setPageErr(e2?.message || "Failed to create category");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id) {
    if (!isAdmin) return;
    setPageErr("");
    setBusyId(id);
    try {
      await deleteCategory(id);
      await loadActive();
      await loadDeleted(); // refresh deleted list
    } catch (e) {
      setPageErr(e?.message || "Failed to delete category");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(id) {
    if (!isAdmin) return;
    setPageErr("");
    setBusyId(id);
    try {
      await restoreCategory(id);
      await loadActive();
      await loadDeleted();
      setTab("active"); // nice UX: go back to active after restoring
    } catch (e) {
      setPageErr(e?.message || "Failed to restore category");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end" }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Categories</h1>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            Categories are tenant-scoped. Deleted categories can be restored.
          </p>
        </div>

        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 12 }}>
        <button
          className="btn"
          onClick={() => setTab("active")}
          style={{
            background: tab === "active" ? "#111827" : "transparent",
            color: tab === "active" ? "#fff" : "inherit",
            border: "1px solid rgba(0,0,0,0.14)",
          }}
        >
          Active categories ({activeRows.length})
        </button>

        <button
          className="btn"
          onClick={() => setTab("deleted")}
          disabled={!isAdmin}
          title={!isAdmin ? "Admin/Owner only" : ""}
          style={{
            background: tab === "deleted" ? "#111827" : "transparent",
            color: tab === "deleted" ? "#fff" : "inherit",
            border: "1px solid rgba(0,0,0,0.14)",
            opacity: !isAdmin ? 0.6 : 1,
          }}
        >
          Deleted categories ({deletedRows.length})
        </button>
      </div>

      {pageErr && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            color: "#991b1b",
          }}
        >
          {pageErr}
        </div>
      )}

      {/* Create (admin/owner only) */}
      {isAdmin && tab === "active" && (
        <div
          style={{
            padding: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            background: "#fff",
            marginBottom: 12,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Create category</h3>
          <form onSubmit={handleCreate} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              className="input"
              placeholder="e.g. Tyres"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ maxWidth: 420 }}
            />
            <button className="btn" type="submit" disabled={creating}>
              {creating ? "Creating..." : "Add"}
            </button>
          </form>
          <div style={{ marginTop: 8, color: "#6b7280", fontSize: 12 }}>
            Uniqueness is case-insensitive per tenant. Deleted items can be recreated.
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "10px 0" }}>
        <input
          className="input"
          placeholder="Search categories..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 420 }}
        />
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Showing{" "}
          <b>{tab === "active" ? filteredActive.length : filteredDeleted.length}</b> of{" "}
          <b>{tab === "active" ? activeRows.length : deletedRows.length}</b>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th align="left">ID</th>
              <th align="left">Name</th>
              {tab === "deleted" ? <th align="left">Deleted At</th> : null}
              <th align="left">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={tab === "deleted" ? 4 : 3} style={{ textAlign: "center" }}>
                  Loading...
                </td>
              </tr>
            )}

            {!loading &&
              tab === "active" &&
              filteredActive.map((c) => {
                const isBusy = busyId === c.id;
                return (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    <td style={{ minWidth: 220 }}>
                      {isAdmin ? (
                        <button className="btn" disabled={isBusy} onClick={() => handleDelete(c.id)}>
                          {isBusy ? "Deleting..." : "Delete"}
                        </button>
                      ) : (
                        <span style={{ color: "#6b7280", fontSize: 12 }}>No actions</span>
                      )}
                    </td>
                  </tr>
                );
              })}

            {!loading &&
              tab === "deleted" &&
              filteredDeleted.map((c) => {
                const isBusy = busyId === c.id;
                return (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    <td>{c.deleted_at ? new Date(c.deleted_at).toLocaleString() : "-"}</td>
                    <td style={{ minWidth: 220 }}>
                      {isAdmin ? (
                        <button className="btn" disabled={isBusy} onClick={() => handleRestore(c.id)}>
                          {isBusy ? "Restoring..." : "Restore"}
                        </button>
                      ) : (
                        <span style={{ color: "#6b7280", fontSize: 12 }}>Admin/Owner only</span>
                      )}
                    </td>
                  </tr>
                );
              })}

            {!loading && tab === "active" && filteredActive.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center" }}>
                  No active categories found
                </td>
              </tr>
            )}

            {!loading && tab === "deleted" && filteredDeleted.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center" }}>
                  No deleted categories found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Permission hint */}
      {!isAdmin && (
        <div style={{ marginTop: 10, color: "#6b7280", fontSize: 12 }}>
          You can view active categories. Only Admin/Owner can create/delete/restore.
        </div>
      )}
    </div>
  );
}
