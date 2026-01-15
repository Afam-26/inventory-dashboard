// src/pages/UsersAdmin.jsx
import { useEffect, useMemo, useState } from "react";
import { getUsers, updateUserRoleById } from "../services/api";

/**
 * Admin Users page
 * - Lists users
 * - Change roles with confirm modal
 * - Per-row inline error
 * - Disable dropdown while saving
 * - Undo button (revert to previous role after a successful change)
 * - Toasts for global success/error
 *
 * Props:
 *  - user: currently logged-in user { id, email, role }
 */
export default function UsersAdmin({ user }) {
  const isAdmin = user?.role === "admin";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState(null);

  // per-row inline errors: { [userId]: "message" }
  const [rowErrors, setRowErrors] = useState({});

  // undo map (only after success): { [userId]: { prevRole, newRole, at } }
  const [undoMap, setUndoMap] = useState({});

  // Confirm modal state
  const [confirm, setConfirm] = useState(null);
  // confirm = {
  //   target: {id,email,role,full_name},
  //   nextRole: "admin"|"staff",
  //   prevRole: "admin"|"staff"
  // }

  // Toasts
  const [toasts, setToasts] = useState([]);
  function toast(type, message) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((t) => [...t, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3500);
  }

  async function load() {
    setLoading(true);
    setPageErr("");
    try {
      const data = await getUsers();
      setRows(Array.isArray(data) ? data : []);
      setRowErrors({});
    } catch (e) {
      setPageErr(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((u) => {
      const email = String(u.email || "").toLowerCase();
      const name = String(u.full_name || "").toLowerCase();
      const role = String(u.role || "").toLowerCase();
      return (
        email.includes(q) ||
        name.includes(q) ||
        role.includes(q) ||
        String(u.id).includes(q)
      );
    });
  }, [rows, query]);

  function canChangeRole(targetUser, nextRole) {
    // Self-demotion protection
    if (targetUser.id === user?.id && String(nextRole).toLowerCase() !== "admin") {
      return { ok: false, reason: "You cannot remove your own admin role." };
    }
    return { ok: true };
  }

  function requestChangeRole(targetUser, nextRole) {
    setPageErr("");
    setRowErrors((prev) => ({ ...prev, [targetUser.id]: "" }));

    const prevRole = targetUser.role;
    if (String(prevRole) === String(nextRole)) return;

    const check = canChangeRole(targetUser, nextRole);
    if (!check.ok) {
      // reset UI back to prevRole (since dropdown already changed)
      setRows((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, role: prevRole } : u))
      );
      toast("error", check.reason);
      setRowErrors((prev) => ({ ...prev, [targetUser.id]: check.reason }));
      return;
    }

    // Open confirm modal
    setConfirm({
      target: targetUser,
      nextRole,
      prevRole,
    });
  }

  async function confirmChangeRole() {
    if (!confirm?.target) return;

    const target = confirm.target;
    const nextRole = confirm.nextRole;
    const prevRole = confirm.prevRole;

    setConfirm(null);

    // Disable while saving
    setSavingId(target.id);

    // Clear per-row error
    setRowErrors((prev) => ({ ...prev, [target.id]: "" }));

    try {
      const res = await updateUserRoleById(target.id, nextRole);

      // Update UI to nextRole
      setRows((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, role: nextRole } : u))
      );

      // Store undo info
      setUndoMap((prev) => ({
        ...prev,
        [target.id]: { prevRole, newRole: nextRole, at: Date.now() },
      }));

      toast("success", res?.message || `Updated ${target.email} to ${nextRole}`);
    } catch (e) {
      // Revert UI
      setRows((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, role: prevRole } : u))
      );

      const msg = e?.message || "Failed to update role";
      setRowErrors((prev) => ({ ...prev, [target.id]: msg }));
      toast("error", msg);
    } finally {
      setSavingId(null);
    }
  }

  function cancelConfirm() {
    // revert dropdown back to prevRole if user cancels
    if (confirm?.target?.id) {
      const { target, prevRole } = confirm;
      setRows((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, role: prevRole } : u))
      );
    }
    setConfirm(null);
  }

  async function undoRole(userId) {
    const info = undoMap[userId];
    if (!info) return;

    const target = rows.find((u) => u.id === userId);
    if (!target) return;

    // prevent self-demotion via undo as well
    const check = canChangeRole(target, info.prevRole);
    if (!check.ok) {
      toast("error", check.reason);
      setRowErrors((prev) => ({ ...prev, [userId]: check.reason }));
      return;
    }

    setSavingId(userId);
    setRowErrors((prev) => ({ ...prev, [userId]: "" }));

    const currentRole = target.role;

    try {
      const res = await updateUserRoleById(userId, info.prevRole);

      // update UI
      setRows((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: info.prevRole } : u))
      );

      // clear undo since we reverted
      setUndoMap((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });

      toast("success", res?.message || `Reverted role to ${info.prevRole}`);
    } catch (e) {
      // revert UI back to what it was
      setRows((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: currentRole } : u))
      );

      const msg = e?.message || "Undo failed";
      setRowErrors((prev) => ({ ...prev, [userId]: msg }));
      toast("error", msg);
    } finally {
      setSavingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 900 }}>
        <h1>Users</h1>
        <p>You do not have access to this page.</p>
      </div>
    );
  }

  const overlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.45)",
    zIndex: 10000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  const modalStyle = {
    width: 520,
    maxWidth: "100%",
    background: "#fff",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 20px 60px rgba(0,0,0,.25)",
    border: "1px solid rgba(17,24,39,.08)",
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Toasts */}
      <div
        style={{
          position: "fixed",
          right: 16,
          top: 16,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          width: 360,
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              borderRadius: 12,
              padding: "10px 12px",
              background: "#111827",
              color: "#fff",
              boxShadow: "0 8px 24px rgba(0,0,0,.18)",
              border: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              {t.type === "success" ? "✅ Success" : "⚠️ Error"}
            </div>
            <div style={{ opacity: 0.95 }}>{t.message}</div>
          </div>
        ))}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div style={overlayStyle} onMouseDown={cancelConfirm}>
          <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px" }}>Confirm role change</h2>
            <p style={{ margin: "0 0 12px", color: "#374151" }}>
              You’re about to change role for:
            </p>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                background: "#f9fafb",
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {confirm.target.full_name || "—"}{" "}
                <span style={{ fontWeight: 400, color: "#6b7280" }}>
                  (ID: {confirm.target.id})
                </span>
              </div>
              <div style={{ color: "#374151" }}>{confirm.target.email}</div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
                Current: <b>{confirm.prevRole}</b> → New: <b>{confirm.nextRole}</b>
              </div>
            </div>

            {confirm.target.id === user?.id && confirm.nextRole !== "admin" && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 12,
                  padding: 10,
                  color: "#991b1b",
                  marginBottom: 12,
                }}
              >
                You cannot remove your own admin role.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={cancelConfirm}>
                Cancel
              </button>
              <button
                className="btn"
                onClick={confirmChangeRole}
                disabled={
                  confirm.target.id === user?.id && String(confirm.nextRole) !== "admin"
                }
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end" }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Users</h1>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            Manage roles (admin-only). Changes are audited.
          </p>
        </div>

        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "14px 0" }}>
        <input
          className="input"
          placeholder="Search by name, email, role, id..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 420 }}
        />

        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Showing <b>{filtered.length}</b> of <b>{rows.length}</b>
        </div>
      </div>

      <div
        style={{
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
        }}
      >
        <b>Note:</b> You can promote/demote other users, but you{" "}
        <b>cannot remove your own admin role</b>.
      </div>

      {pageErr && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
            color: "#991b1b",
          }}
        >
          {pageErr}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th style={{ textAlign: "left" }}>ID</th>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Email</th>
              <th style={{ textAlign: "left" }}>Role</th>
              <th style={{ textAlign: "left" }}>Created</th>
              <th style={{ textAlign: "left" }}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan="6" style={{ textAlign: "center" }}>
                  Loading...
                </td>
              </tr>
            )}

            {!loading &&
              filtered.map((u) => {
                const isMe = u.id === user?.id;
                const isSaving = savingId === u.id;
                const inlineErr = rowErrors[u.id];
                const canUndo = !!undoMap[u.id];

                return (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.full_name || "-"}</td>
                    <td>{u.email}</td>

                    <td style={{ minWidth: 260 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <select
                          className="input"
                          value={u.role}
                          disabled={isSaving}
                          onChange={(e) => requestChangeRole(u, e.target.value)}
                          style={{ minWidth: 140 }}
                        >
                          <option value="staff">staff</option>
                          <option value="admin">admin</option>
                        </select>

                        {isMe && (
                          <span
                            style={{
                              fontSize: 12,
                              padding: "3px 8px",
                              borderRadius: 999,
                              background: "#111827",
                              color: "#fff",
                            }}
                          >
                            you
                          </span>
                        )}

                        {isSaving && (
                          <span style={{ fontSize: 12, color: "#6b7280" }}>Saving...</span>
                        )}
                      </div>

                      {/* inline row error */}
                      {inlineErr ? (
                        <div style={{ marginTop: 6, color: "#991b1b", fontSize: 12 }}>
                          {inlineErr}
                        </div>
                      ) : null}
                    </td>

                    <td>{u.created_at ? new Date(u.created_at).toLocaleString() : "-"}</td>

                    <td style={{ minWidth: 210 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <button
                          className="btn"
                          onClick={() => undoRole(u.id)}
                          disabled={!canUndo || isSaving}
                          title={canUndo ? `Undo to ${undoMap[u.id].prevRole}` : "No recent change"}
                        >
                          Undo
                        </button>

                        <span style={{ fontSize: 12, color: "#6b7280" }}>
                          {isMe ? "Self protected" : "Ready"}
                        </span>
                      </div>

                      {canUndo && (
                        <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                          Last change: <b>{undoMap[u.id].newRole}</b>{" "}
                          <span style={{ opacity: 0.8 }}>
                            (undo → {undoMap[u.id].prevRole})
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: "center" }}>
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
