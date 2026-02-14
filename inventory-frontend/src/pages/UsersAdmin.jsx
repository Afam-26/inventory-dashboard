// src/pages/UsersAdmin.jsx
import { useEffect, useMemo, useState } from "react";
import {
  createUser,
  getUsers,
  updateUserRoleById,
  inviteUserToTenant,
  deactivateUserFromTenant,
  restoreUserToTenant,
  bulkDeactivateUsersFromTenant,
  hardDeleteUserFromTenant,
} from "../services/api";

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

  const [selected, setSelected] = useState({}); // { [id]: true }

  const [showDeactivated, setShowDeactivated] = useState(false);

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

  function isDeactivatedRow(u) {
    return !!(u?.deactivated_at || u?.deleted_at || u?.member_deactivated_at || u?.is_deactivated);
  }

  function isOwnerRow(u) {
    const r = String(u?.tenantRole || u?.role || "staff").toLowerCase();
    return r === "owner";
  }

  async function load() {
    setLoading(true);
    setPageErr("");
    try {
      const list = await getUsers();
      setRows(Array.isArray(list) ? list : []);
      setRowErrors({});
      setSelected({});
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

  const activeFiltered = useMemo(() => filtered.filter((u) => !isDeactivatedRow(u)), [filtered]);
  const deactivatedFiltered = useMemo(() => filtered.filter((u) => isDeactivatedRow(u)), [filtered]);

  const selectedIds = useMemo(() => {
    return Object.keys(selected)
      .filter((k) => selected[k])
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n));
  }, [selected]);

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

    setConfirm({ type: "role", target: targetUser, prevRole, nextRole: next });
  }

  async function confirmChangeRole() {
    if (confirm?.type !== "role" || !confirm?.target) return;

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
        [target.id]: { kind: "role", prevRole, newRole: nextRole, at: Date.now() },
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
    if (!info || info.kind !== "role") return;

    const target = rows.find((u) => Number(u.id) === Number(userId));
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

  function canDeactivate(targetUser) {
    const isMe = Number(targetUser.id) === Number(user?.id);
    if (isMe) return { ok: false, reason: "You cannot deactivate yourself." };
    if (isOwnerRow(targetUser)) return { ok: false, reason: "Owner cannot be deactivated." };
    return { ok: true };
  }

  function requestDeactivate(targetUser) {
    setRowErrors((prev) => ({ ...prev, [targetUser.id]: "" }));

    const check = canDeactivate(targetUser);
    if (!check.ok) {
      toast("error", check.reason);
      setRowErrors((prev) => ({ ...prev, [targetUser.id]: check.reason }));
      return;
    }

    setConfirm({ type: "deactivate", target: targetUser });
  }

  async function confirmDeactivate() {
    if (confirm?.type !== "deactivate" || !confirm?.target) return;
    const target = confirm.target;
    setConfirm(null);

    setSavingId(target.id);
    setRowErrors((prev) => ({ ...prev, [target.id]: "" }));

    const nowIso = new Date().toISOString();
    setRows((prev) => prev.map((u) => (u.id === target.id ? { ...u, deactivated_at: nowIso } : u)));

    try {
      const res = await deactivateUserFromTenant(target.id);
      setUndoMap((prev) => ({ ...prev, [target.id]: { kind: "deactivate", at: Date.now() } }));
      toast("success", res?.message || `Deactivated ${target.email}`);
      await load();
    } catch (e) {
      setRows((prev) => prev.map((u) => (u.id === target.id ? { ...u, deactivated_at: null } : u)));
      const msg = e?.message || "Failed to deactivate user";
      setRowErrors((prev) => ({ ...prev, [target.id]: msg }));
      toast("error", msg);
    } finally {
      setSavingId(null);
    }
  }

  async function restoreUser(userId) {
    const target = rows.find((u) => Number(u.id) === Number(userId));
    if (!target) return;

    setSavingId(userId);
    setRowErrors((prev) => ({ ...prev, [userId]: "" }));

    const prevDeactivated = target.deactivated_at || target.deleted_at || target.member_deactivated_at || true;

    setRows((prev) =>
      prev.map((u) =>
        u.id === userId
          ? { ...u, deactivated_at: null, deleted_at: null, member_deactivated_at: null, is_deactivated: false }
          : u
      )
    );

    try {
      const res = await restoreUserToTenant(userId);
      setUndoMap((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });
      toast("success", res?.message || `Restored ${target.email}`);
      await load();
    } catch (e) {
      setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, deactivated_at: prevDeactivated } : u)));
      const msg = e?.message || "Restore failed";
      setRowErrors((prev) => ({ ...prev, [userId]: msg }));
      toast("error", msg);
    } finally {
      setSavingId(null);
    }
  }

  function requestHardDelete(targetUser) {
    setRowErrors((prev) => ({ ...prev, [targetUser.id]: "" }));

    const isMe = Number(targetUser.id) === Number(user?.id);
    if (isMe) return toast("error", "You cannot delete yourself.");
    if (isOwnerRow(targetUser)) return toast("error", "Owner cannot be removed.");
    if (!isDeactivatedRow(targetUser)) return toast("error", "Deactivate the user first.");

    setConfirm({ type: "hard_delete", target: targetUser });
  }

  async function confirmHardDelete() {
    if (confirm?.type !== "hard_delete" || !confirm?.target) return;
    const target = confirm.target;
    setConfirm(null);

    setSavingId(target.id);
    setRowErrors((prev) => ({ ...prev, [target.id]: "" }));

    const before = rows;
    setRows((prev) => prev.filter((u) => Number(u.id) !== Number(target.id)));

    try {
      const res = await hardDeleteUserFromTenant(target.id);
      toast("success", res?.message || `Deleted ${target.email}`);
      await load();
    } catch (e) {
      setRows(before);
      const msg = e?.message || "Permanent delete failed";
      setRowErrors((prev) => ({ ...prev, [target.id]: msg }));
      toast("error", msg);
    } finally {
      setSavingId(null);
    }
  }

  function requestBulkDeactivate() {
    const ids = selectedIds;
    if (!ids.length) return toast("error", "Select at least one user.");

    const picked = rows.filter((u) => ids.includes(Number(u.id)));

    const blocked = picked.filter((u) => !canDeactivate(u).ok);
    if (blocked.length) {
      const first = blocked[0];
      return toast("error", `Bulk blocked: ${first.email} — ${canDeactivate(first).reason}`);
    }

    setConfirm({ type: "bulk_deactivate", ids });
  }

  async function confirmBulkDeactivate() {
    if (confirm?.type !== "bulk_deactivate" || !Array.isArray(confirm?.ids)) return;
    const ids = confirm.ids;
    setConfirm(null);

    setSavingId("bulk");
    setPageErr("");

    const nowIso = new Date().toISOString();
    setRows((prev) => prev.map((u) => (ids.includes(Number(u.id)) ? { ...u, deactivated_at: nowIso } : u)));

    try {
      const res = await bulkDeactivateUsersFromTenant(ids);
      setUndoMap((prev) => {
        const copy = { ...prev };
        ids.forEach((id) => (copy[id] = { kind: "deactivate", at: Date.now() }));
        return copy;
      });
      setSelected({});
      toast("success", res?.message || `Deactivated ${ids.length} user(s)`);
      await load();
    } catch (e) {
      setRows((prev) => prev.map((u) => (ids.includes(Number(u.id)) ? { ...u, deactivated_at: null } : u)));
      toast("error", e?.message || "Bulk deactivate failed");
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
    if (!payload.password || payload.password.length < 8)
      return toast("error", "Password must be at least 8 characters");

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

  function toggleRow(id) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function allVisibleSelectableIds() {
    return activeFiltered.filter((u) => canDeactivate(u).ok).map((u) => Number(u.id));
  }

  function toggleAllVisible() {
    const ids = allVisibleSelectableIds();
    if (!ids.length) return;

    const allOn = ids.every((id) => selected[id]);
    setSelected((prev) => {
      const copy = { ...prev };
      ids.forEach((id) => (copy[id] = !allOn));
      return copy;
    });
  }

  /* =========================
     Modern Icon Set (inline SVG)
     ========================= */

  function IconBtn({ title, ariaLabel, onClick, disabled, tone = "neutral", children }) {
    // tone: neutral | danger | success
    const toneStyles =
      tone === "danger"
        ? { border: "1px solid rgba(244,63,94,.35)", background: "rgba(244,63,94,.10)", color: "#e11d48" }
        : tone === "success"
        ? { border: "1px solid rgba(16,185,129,.35)", background: "rgba(16,185,129,.10)", color: "#059669" }
        : { border: "1px solid rgba(17,24,39,.12)", background: "#fff", color: "#111827" };

    return (
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel || title}
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          ...toneStyles,
        }}
      >
        {children}
      </button>
    );
  }

  // Modern trash can (rounded, minimal)
  function TrashModernIcon() {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M9 3.75a1 1 0 0 0-.9.55L7.6 5.25H4.75a.75.75 0 0 0 0 1.5h.77l.9 12.03A2 2 0 0 0 8.42 21h7.16a2 2 0 0 0 1.99-2.22l.9-12.03h.78a.75.75 0 0 0 0-1.5H16.4l-.5-.95a1 1 0 0 0-.9-.55H9Zm7.55 3H7.45l.86 11.56a.5.5 0 0 0 .5.46h6.38a.5.5 0 0 0 .5-.46l.86-11.56ZM10 10a.75.75 0 0 1 1.5 0v6a.75.75 0 0 1-1.5 0v-6Zm3.25-.75A.75.75 0 0 1 14 10v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 .75-.75Z"
        />
      </svg>
    );
  }

  // Deactivate (circle minus)
  function DeactivateIcon() {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 2.75c5.11 0 9.25 4.14 9.25 9.25S17.11 21.25 12 21.25 2.75 17.11 2.75 12 6.89 2.75 12 2.75Zm0 1.5A7.75 7.75 0 1 0 19.75 12 7.76 7.76 0 0 0 12 4.25Zm-4 7a.75.75 0 0 1 0-1.5h8a.75.75 0 0 1 0 1.5H8Z"
        />
      </svg>
    );
  }

  // Restore (curved arrow)
  function RestoreIcon() {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M10.25 4.5a.75.75 0 0 1 1.5 0v2.07a8.25 8.25 0 1 1-7.2 4.07.75.75 0 0 1 1.33.7A6.75 6.75 0 1 0 12 7.5h-2.5a.75.75 0 0 1 0-1.5h2.25V4.5Zm-3.47.78a.75.75 0 0 1 1.06 0l1.6 1.6a.75.75 0 1 1-1.06 1.06l-1.6-1.6a.75.75 0 0 1 0-1.06Z"
        />
      </svg>
    );
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

  function confirmTitle() {
    if (!confirm) return "";
    if (confirm.type === "role") return "Confirm role change";
    if (confirm.type === "deactivate") return "Confirm deactivation";
    if (confirm.type === "bulk_deactivate") return "Confirm bulk deactivation";
    if (confirm.type === "hard_delete") return "Confirm permanent delete";
    return "Confirm";
  }

  function confirmBody() {
    if (!confirm) return null;

    if (confirm.type === "role") {
      return (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb", marginBottom: 12 }}>
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
      );
    }

    if (confirm.type === "deactivate") {
      return (
        <div style={{ border: "1px solid #fee2e2", borderRadius: 12, padding: 12, background: "#fef2f2", marginBottom: 12 }}>
          <div style={{ fontWeight: 800, color: "#991b1b" }}>Deactivate this user from the tenant?</div>
          <div style={{ marginTop: 8, color: "#374151" }}>
            <b>{confirm.target.full_name || "—"}</b> ({confirm.target.email})
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
            They will lose access immediately. You can restore them later.
          </div>
        </div>
      );
    }

    if (confirm.type === "bulk_deactivate") {
      return (
        <div style={{ border: "1px solid #fee2e2", borderRadius: 12, padding: 12, background: "#fef2f2", marginBottom: 12 }}>
          <div style={{ fontWeight: 800, color: "#991b1b" }}>Deactivate {confirm.ids.length} user(s)?</div>
          <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
            They will lose access immediately. Each can be restored later.
          </div>
        </div>
      );
    }

    if (confirm.type === "hard_delete") {
      return (
        <div style={{ border: "1px solid #fecaca", borderRadius: 12, padding: 12, background: "#fff1f2", marginBottom: 12 }}>
          <div style={{ fontWeight: 900, color: "#9f1239" }}>Permanently delete this deactivated user?</div>
          <div style={{ marginTop: 8, color: "#374151" }}>
            <b>{confirm.target.full_name || "—"}</b> ({confirm.target.email})
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>This cannot be undone.</div>
        </div>
      );
    }

    return null;
  }

  function confirmAction() {
    if (!confirm) return () => {};
    if (confirm.type === "role") return confirmChangeRole;
    if (confirm.type === "deactivate") return confirmDeactivate;
    if (confirm.type === "bulk_deactivate") return confirmBulkDeactivate;
    if (confirm.type === "hard_delete") return confirmHardDelete;
    return () => {};
  }

  return (
    <div className="users-page">
      {/* Toasts */}
      <div style={{ position: "fixed", right: 16, top: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10, width: 360, maxWidth: "calc(100vw - 32px)" }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ borderRadius: 12, padding: "10px 12px", background: "#111827", color: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,.18)", border: "1px solid rgba(255,255,255,.08)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t.type === "success" ? "✅ Success" : "⚠️ Error"}</div>
            <div style={{ opacity: 0.95 }}>{t.message}</div>
          </div>
        ))}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div style={overlayStyle} onMouseDown={cancelConfirm}>
          <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px" }}>{confirmTitle()}</h2>
            {confirmBody()}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" onClick={cancelConfirm}>
                Cancel
              </button>
              <button className="btn btnDanger" onClick={confirmAction()}>
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
          <p style={{ marginTop: 0, color: "#6b7280" }}>Create users, invite users to tenant, manage roles, and deactivate access.</p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          <button
            className="btn btnDangerOutline"
            onClick={requestBulkDeactivate}
            disabled={!selectedIds.length || savingId === "bulk"}
            title={selectedIds.length ? `Deactivate ${selectedIds.length}` : "Select users first"}
          >
            Deactivate selected ({selectedIds.length || 0})
          </button>
        </div>
      </div>

      {/* Invite user */}
      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Invite user to this tenant</h3>

        <form onSubmit={handleInvite} className="form-grid-3">
          <input className="input" placeholder="Email" value={inviteForm.email} onChange={(e) => setInviteForm((p) => ({ ...p, email: e.target.value }))} />
          <select className="input" value={inviteForm.role} onChange={(e) => setInviteForm((p) => ({ ...p, role: e.target.value }))}>
            <option value="staff">staff</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
          <button className="btn" type="submit" disabled={inviting}>
            {inviting ? "Inviting..." : "Send invite"}
          </button>
        </form>

        <p style={{ marginTop: 10, color: "#6b7280", fontSize: 13 }}>Invited users will join this tenant with the selected role.</p>
      </div>

      {/* Create user */}
      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Create user</h3>

        <form onSubmit={handleCreate} className="form-grid-2" autoComplete="off">
          <input type="text" name="fake_username" autoComplete="username" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px" }} />
          <input type="password" name="fake_password" autoComplete="new-password" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px" }} />

          <input className="input" name="create_full_name" autoComplete="off" placeholder="Full name" value={createForm.full_name} onChange={(e) => setCreateForm((p) => ({ ...p, full_name: e.target.value }))} />
          <input className="input" type="email" name="create_email" autoComplete="off" placeholder="Email" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} />
          <input className="input" type="password" name="create_password" autoComplete="new-password" placeholder="Temp password (min 8)" value={createForm.password} onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))} />

          <select className="input" name="create_role" autoComplete="off" value={createForm.role} onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}>
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
        <input className="input" placeholder="Search name, email, role, id..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Showing <b>{filtered.length}</b> of <b>{rows.length}</b>
        </div>
      </div>

      {pageErr && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 12, marginBottom: 14, color: "#991b1b" }}>
          {pageErr}
        </div>
      )}

      {/* ACTIVE USERS TABLE */}
      <div className="tableWrap" style={{ marginTop: 10 }}>
        <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th align="center" style={{ width: 44 }}>
                <input type="checkbox" onChange={toggleAllVisible} />
              </th>
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
                <td colSpan="7" style={{ textAlign: "center" }}>
                  Loading...
                </td>
              </tr>
            )}

            {!loading &&
              activeFiltered.map((u) => {
                const isMe = Number(u.id) === Number(user?.id);
                const isSaving = savingId === u.id || savingId === "bulk";
                const inlineErr = rowErrors[u.id];
                const canUndoRole = !!undoMap[u.id] && undoMap[u.id].kind === "role";
                const currentRole = getRoleForRow(u);
                const owner = isOwnerRow(u);
                const canSelect = canDeactivate(u).ok;

                return (
                  <tr key={u.id}>
                    <td align="center">
                      <input type="checkbox" checked={!!selected[u.id]} onChange={() => toggleRow(u.id)} disabled={!canSelect} title={!canSelect ? "Not selectable" : "Select"} />
                    </td>

                    <td>{u.id}</td>
                    <td>{u.full_name || "-"}</td>
                    <td>{u.email}</td>

                    <td style={{ minWidth: 260 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <select className="input" value={currentRole} disabled={isSaving} onChange={(e) => requestChangeRole(u, e.target.value)} style={{ minWidth: 140 }}>
                          <option value="staff">staff</option>
                          <option value="admin">admin</option>
                          <option value="owner">owner</option>
                        </select>

                        <RolePill role={currentRole} />
                        {isMe && <span className="role-pill you">you</span>}
                        {owner && <span className="role-pill ownerLock">locked</span>}
                        {isSaving && <span style={{ fontSize: 12, color: "#6b7280" }}>Saving...</span>}
                      </div>

                      {inlineErr ? <div style={{ marginTop: 6, color: "#991b1b", fontSize: 12 }}>{inlineErr}</div> : null}
                    </td>

                    <td>{u.created_at ? new Date(u.created_at).toLocaleString() : "-"}</td>

                    <td style={{ minWidth: 260 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <button className="btn" onClick={() => undoRole(u.id)} disabled={!canUndoRole || isSaving} title={canUndoRole ? `Undo role change` : "No recent role change"}>
                          Undo Role
                        </button>

                        {/* ✅ Deactivate as ICON button */}
                        <IconBtn
                          title="Deactivate"
                          ariaLabel="Deactivate user"
                          onClick={() => requestDeactivate(u)}
                          disabled={isSaving || !canDeactivate(u).ok}
                          tone="danger"
                        >
                          <DeactivateIcon />
                        </IconBtn>

                        <span style={{ fontSize: 12, color: "#6b7280" }}>{isMe ? "Self protected" : owner ? "Owner protected" : "Active"}</span>
                      </div>

                      {inlineErr ? <div style={{ marginTop: 6, color: "#991b1b", fontSize: 12 }}>{inlineErr}</div> : null}
                    </td>
                  </tr>
                );
              })}

            {!loading && activeFiltered.length === 0 && (
              <tr>
                <td colSpan="7" style={{ textAlign: "center" }}>
                  No active users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* DEACTIVATED USERS (COLLAPSIBLE) */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Deactivated users</h3>
            <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>
              {deactivatedFiltered.length} deactivated user(s). You can restore, or permanently delete.
            </div>
          </div>

          <button className="btn" onClick={() => setShowDeactivated((s) => !s)} title="Show/hide deactivated users">
            {showDeactivated ? "Hide" : "Show"}
          </button>
        </div>

        {showDeactivated && (
          <div className="tableWrap" style={{ marginTop: 12 }}>
            <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: "#f3f4f6" }}>
                <tr>
                  <th align="left">ID</th>
                  <th align="left">Name</th>
                  <th align="left">Email</th>
                  <th align="left">Role</th>
                  <th align="left">Deactivated at</th>
                  <th align="left">Actions</th>
                </tr>
              </thead>

              <tbody>
                {deactivatedFiltered.map((u) => {
                  const isSaving = savingId === u.id || savingId === "bulk";
                  const owner = isOwnerRow(u);

                  return (
                    <tr key={`deact-${u.id}`} style={{ opacity: 0.85 }}>
                      <td>{u.id}</td>
                      <td>{u.full_name || "-"}</td>
                      <td>{u.email}</td>
                      <td>
                        <RolePill role={getRoleForRow(u)} /> {owner ? <span className="role-pill ownerLock" style={{ marginLeft: 8 }}>locked</span> : null}
                      </td>
                      <td>{u.deactivated_at ? new Date(u.deactivated_at).toLocaleString() : "-"}</td>
                      <td style={{ minWidth: 160 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          {/* ✅ Restore as ICON button */}
                          <IconBtn
                            title="Restore"
                            ariaLabel="Restore user"
                            onClick={() => restoreUser(u.id)}
                            disabled={isSaving}
                            tone="success"
                          >
                            <RestoreIcon />
                          </IconBtn>

                          {/* ✅ Modern Trash as ICON button */}
                          <IconBtn
                            title={owner ? "Owner cannot be removed" : "Delete permanently"}
                            ariaLabel="Delete permanently"
                            onClick={() => requestHardDelete(u)}
                            disabled={isSaving || owner}
                            tone="danger"
                          >
                            <TrashModernIcon />
                          </IconBtn>
                        </div>

                        {rowErrors[u.id] ? <div style={{ marginTop: 6, color: "#991b1b", fontSize: 12 }}>{rowErrors[u.id]}</div> : null}
                      </td>
                    </tr>
                  );
                })}

                {deactivatedFiltered.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center" }}>
                      No deactivated users
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}