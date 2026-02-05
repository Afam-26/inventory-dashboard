// src/pages/UsersAdmin.jsx
import { useEffect, useMemo, useState } from "react";
import { createUser, getUsers, updateUserRoleById, inviteUserToTenant } from "../services/api";

export default function UsersAdmin({ user }) {
  const uiRole = useMemo(() => String(user?.tenantRole || user?.role || "").toLowerCase(), [user]);
  const isAdmin = uiRole === "admin" || uiRole === "owner";

  const [authReady, setAuthReady] = useState(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState(null);

  const [rowErrors, setRowErrors] = useState({});
  const [undoMap, setUndoMap] = useState({});
  const [confirm, setConfirm] = useState(null);

  const [toasts, setToasts] = useState([]);
  function toast(type, message) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((t) => [...t, { id, type, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  const [inviteForm, setInviteForm] = useState({ email: "", role: "staff" });
  const [inviting, setInviting] = useState(false);

  const [createForm, setCreateForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "staff",
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setAuthReady(true), 0);
    return () => window.clearTimeout(t);
  }, [uiRole]);

  function RolePill({ role, className = "" }) {
    const r = String(role || "staff").toLowerCase();
    return <span className={`role-pill ${r} ${className}`}>{r}</span>;
  }

  async function load() {
    setLoading(true);
    setPageErr("");
    try {
      const list = await getUsers();
      setRows(Array.isArray(list) ? list : []);
      setRowErrors({});
    } catch (e) {
      setRows([]);
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

  async function handleInvite(e) {
    e.preventDefault();
    setPageErr("");

    const payload = {
      email: inviteForm.email.trim().toLowerCase(),
      role: inviteForm.role,
    };
    if (!payload.email) return toast("error", "Email is required");

    setInviting(true);
    try {
      const res = await inviteUserToTenant(payload);
      toast("success", res?.mode === "invited" ? "Invite sent" : "User added to tenant");
      setInviteForm({ email: "", role: "staff" });
      await load();
    } catch (e2) {
      toast("error", e2?.message || "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((u) => {
      const email = String(u.email || "").toLowerCase();
      const name = String(u.full_name || "").toLowerCase();
      const roleText = String(u.tenantRole || u.role || "").toLowerCase();

      return email.includes(q) || name.includes(q) || roleText.includes(q) || String(u.id).includes(q);
    });
  }, [rows, query]);

  function getRoleForRow(u) {
    return String(u.tenantRole || u.role || "staff").toLowerCase();
  }

  function canChangeRole(targetUser, nextRole) {
    const me = Number(targetUser.id) === Number(user?.id);
    const next = String(nextRole || "").toLowerCase();
    if (me && !["admin", "owner"].includes(next)) {
      return { ok: false, reason: "You cannot remove your own admin/owner access." };
    }
    return { ok: true };
  }

  function requestChangeRole(targetUser, nextRole) {
    setRowErrors((prev) => ({ ...prev, [targetUser.id]: "" }));

    const prevRole = getRoleForRow(targetUser);
    const next = String(nextRole || "").toLowerCase();
    if (prevRole === next) return;

    const check = canChangeRole(targetUser, next);
    if (!check.ok) {
      toast("error", check.reason);
      setRowErrors((prev) => ({ ...prev, [targetUser.id]: check.reason }));
      return;
    }

    setConfirm({ target: targetUser, prevRole, nextRole: next });
  }

  async function confirmChangeRole() {
    if (!confirm?.target) return;

    const target = confirm.target;
    const prevRole = confirm.prevRole;
    const nextRole = confirm.nextRole;

    setConfirm(null);
    setSavingId(target.id);
    setRowErrors((prev) => ({ ...prev, [target.id]: "" }));

    setRows((prev) =>
      prev.map((u) =>
        u.id === target.id
          ? u.tenantRole !== undefined
            ? { ...u, tenantRole: nextRole }
            : { ...u, role: nextRole }
          : u
      )
    );

    try {
      const res = await updateUserRoleById(target.id, nextRole);

      setUndoMap((prev) => ({
        ...prev,
        [target.id]: { prevRole, newRole: nextRole, at: Date.now() },
      }));

      toast("success", res?.message || `Updated ${target.email} to ${nextRole}`);
      await load();
    } catch (e) {
      setRows((prev) =>
        prev.map((u) =>
          u.id === target.id
            ? u.tenantRole !== undefined
              ? { ...u, tenantRole: prevRole }
              : { ...u, role: prevRole }
            : u
        )
      );

      const msg = e?.message || "Failed to update role";
      setRowErrors((prev) => ({ ...prev, [target.id]: msg }));
      toast("error", msg);
    } finally {
      setSavingId(null);
    }
  }

  function cancelConfirm() {
    setConfirm(null);
  }

  async function undoRole(userId) {
    const info = undoMap[userId];
    if (!info) return;

    const target = rows.find((u) => u.id === userId);
    if (!target) return;

    const check = canChangeRole(target, info.prevRole);
    if (!check.ok) {
      toast("error", check.reason);
      setRowErrors((prev) => ({ ...prev, [userId]: check.reason }));
      return;
    }

    setSavingId(userId);
    setRowErrors((prev) => ({ ...prev, [userId]: "" }));

    const currentRole = getRoleForRow(target);

    setRows((prev) =>
      prev.map((u) =>
        u.id === userId
          ? u.tenantRole !== undefined
            ? { ...u, tenantRole: info.prevRole }
            : { ...u, role: info.prevRole }
          : u
      )
    );

    try {
      const res = await updateUserRoleById(userId, info.prevRole);

      setUndoMap((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });

      toast("success", res?.message || `Reverted role to ${info.prevRole}`);
      await load();
    } catch (e) {
      setRows((prev) =>
        prev.map((u) =>
          u.id === userId
            ? u.tenantRole !== undefined
              ? { ...u, tenantRole: currentRole }
              : { ...u, role: currentRole }
            : u
        )
      );

      const msg = e?.message || "Undo failed";
      setRowErrors((prev) => ({ ...prev, [userId]: msg }));
      toast("error", msg);
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setPageErr("");

    const payload = {
      full_name: createForm.full_name.trim(),
      email: createForm.email.trim().toLowerCase(),
      password: createForm.password,
      role: createForm.role,
    };

    if (!payload.full_name) return toast("error", "Full name is required");
    if (!payload.email) return toast("error", "Email is required");
    if (!payload.password || payload.password.length < 8) {
      return toast("error", "Password must be at least 8 characters");
    }

    setCreating(true);
    try {
      const res = await createUser(payload);
      toast("success", res?.message || "User created");
      setCreateForm({ full_name: "", email: "", password: "", role: "staff" });
      await load();
    } catch (e2) {
      toast("error", e2?.message || "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  if (!authReady) {
    return (
      <div>
        <h1>Users</h1>
        <p style={{ color: "#6b7280" }}>Loading access…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
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
    <div className="users-page">
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
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t.type === "success" ? "✅ Success" : "⚠️ Error"}</div>
            <div style={{ opacity: 0.95 }}>{t.message}</div>
          </div>
        ))}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div style={overlayStyle} onMouseDown={cancelConfirm}>
          <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px" }}>Confirm role change</h2>

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
                <span style={{ fontWeight: 400, color: "#6b7280" }}>(ID: {confirm.target.id})</span>
              </div>
              <div style={{ color: "#374151" }}>{confirm.target.email}</div>

              <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "#6b7280" }}>Current</span>
                <RolePill role={confirm.prevRole} />
                <span style={{ fontSize: 13, color: "#6b7280" }}>→ New</span>
                <RolePill role={confirm.nextRole} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" onClick={cancelConfirm}>
                Cancel
              </button>
              <button className="btn" onClick={confirmChangeRole}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-head">
        <div>
          <h1 style={{ marginBottom: 6 }}>User Management</h1>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            Create users, invite users to tenant, and manage per-tenant roles.
          </p>
        </div>

        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Invite user */}
      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Invite user to this tenant</h3>

        <form onSubmit={handleInvite} className="form-grid-3">
          <input
            className="input"
            placeholder="Email"
            value={inviteForm.email}
            onChange={(e) => setInviteForm((p) => ({ ...p, email: e.target.value }))}
          />

          <select className="input" value={inviteForm.role} onChange={(e) => setInviteForm((p) => ({ ...p, role: e.target.value }))}>
            <option value="staff">staff</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>

          <button className="btn" type="submit" disabled={inviting}>
            {inviting ? "Inviting..." : "Send invite"}
          </button>
        </form>

        <p style={{ marginTop: 10, color: "#6b7280", fontSize: 13 }}>
          Invited users will join this tenant with the selected role.
        </p>
      </div>

      {/* Create user */}
      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Create user</h3>

       <form onSubmit={handleCreate} className="form-grid-2" autoComplete="off">
          {/* 🔒 Autofill busters (Chrome/Safari) */}
          <input
            type="text"
            name="fake_username"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
          />
          <input
            type="password"
            name="fake_password"
            autoComplete="new-password"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
          />

          <input
            className="input"
            name="create_full_name"
            autoComplete="off"
            placeholder="Full name"
            value={createForm.full_name}
            onChange={(e) => setCreateForm((p) => ({ ...p, full_name: e.target.value }))}
          />

          <input
            className="input"
            type="email"
            name="create_email"
            autoComplete="off"
            placeholder="Email"
            value={createForm.email}
            onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
          />

          <input
            className="input"
            type="password"
            name="create_password"
            autoComplete="new-password"
            placeholder="Temp password (min 8)"
            value={createForm.password}
            onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
          />

          <select
            className="input"
            name="create_role"
            autoComplete="off"
            value={createForm.role}
            onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}
          >
            <option value="staff">staff</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>

          <button className="btn" type="submit" disabled={creating} style={{ gridColumn: "1 / -1" }}>
            {creating ? "Creating..." : "Create user"}
          </button>
        </form>
      </div>

      {/* Search row */}
      <div className="users-searchRow">
        <input
          className="input"
          placeholder="Search name, email, role, id..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Showing <b>{filtered.length}</b> of <b>{rows.length}</b>
        </div>
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

      <div className="tableWrap" style={{ marginTop: 10 }}>
        <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th align="left">ID</th>
              <th align="left">Name</th>
              <th align="left">Email</th>
              <th align="left">Role (tenant)</th>
              <th align="left">Created</th>
              <th align="left">Actions</th>
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
                const isMe = Number(u.id) === Number(user?.id);
                const isSaving = savingId === u.id;
                const inlineErr = rowErrors[u.id];
                const canUndo = !!undoMap[u.id];
                const currentRole = getRoleForRow(u);

                return (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.full_name || "-"}</td>
                    <td>{u.email}</td>

                    <td style={{ minWidth: 260 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <select
                          className="input"
                          value={currentRole}
                          disabled={isSaving}
                          onChange={(e) => requestChangeRole(u, e.target.value)}
                          style={{ minWidth: 140 }}
                        >
                          <option value="staff">staff</option>
                          <option value="admin">admin</option>
                          <option value="owner">owner</option>
                        </select>

                        <RolePill role={currentRole} />

                        {isMe && <span className="role-pill you">you</span>}

                        {isSaving && <span style={{ fontSize: 12, color: "#6b7280" }}>Saving...</span>}
                      </div>

                      {inlineErr ? <div style={{ marginTop: 6, color: "#991b1b", fontSize: 12 }}>{inlineErr}</div> : null}
                    </td>

                    <td>{u.created_at ? new Date(u.created_at).toLocaleString() : "-"}</td>

                    <td style={{ minWidth: 230 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          className="btn"
                          onClick={() => undoRole(u.id)}
                          disabled={!canUndo || isSaving}
                          title={canUndo ? `Undo → ${undoMap[u.id].prevRole}` : "No recent change"}
                        >
                          Undo
                        </button>

                        <span style={{ fontSize: 12, color: "#6b7280" }}>{isMe ? "Self protected" : "Ready"}</span>
                      </div>

                      {canUndo && (
                        <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                          Last change: <b>{undoMap[u.id].newRole}</b>{" "}
                          <span style={{ opacity: 0.8 }}>(undo → {undoMap[u.id].prevRole})</span>
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
