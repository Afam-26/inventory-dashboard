// src/pages/AuditLogs.jsx
import { useEffect, useMemo, useState } from "react";
import { getAuditLogs, downloadAuditCsv } from "../services/api";

export default function AuditLogs({ user }) {
  const role = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = role === "owner" || role === "admin";

  function RolePill({ role }) {
    const r = String(role || "staff").toLowerCase();
    return <span className={`role-pill ${r}`}>{r}</span>;
  }

  const [action, setAction] = useState("");
  const [userEmail, setUserEmail] = useState("");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const totalPages = useMemo(() => {
    const lp = Math.max(1, Number(limit || 50));
    return Math.max(1, Math.ceil(Number(total || 0) / lp));
  }, [total, limit]);

  async function load(opts = {}) {
    setLoading(true);
    setErr("");
    try {
      const data = await getAuditLogs({
        page: opts.page ?? page,
        limit: opts.limit ?? limit,
        action: String(action || "").trim() || undefined,
        user_email: isAdmin ? (String(userEmail || "").trim().toLowerCase() || undefined) : undefined,
      });

      setRows(Array.isArray(data?.logs) ? data.logs : []);
      setTotal(Number(data?.total || 0));
    } catch (e) {
      setRows([]);
      setTotal(0);
      setErr(e?.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  function applyFilters() {
    setPage(1);
    load({ page: 1 });
  }

  function clearFilters() {
    setAction("");
    setUserEmail("");
    setPage(1);
    load({ page: 1 });
  }

  return (
    <div className="auditlogs-page">
      <div className="page-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{isAdmin ? "Audit Logs" : "My Activity"}</h1>
          <RolePill role={role || "staff"} />
        </div>

        <button className="btn" onClick={() => downloadAuditCsv({ limit: 20000 })} disabled={loading}>
          Export CSV
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="auditlogs-filters">
          <input className="input" placeholder="Action (e.g. LOGIN_FAILED)" value={action} onChange={(e) => setAction(e.target.value)} />

          <input
            className="input"
            placeholder="User email (admins only)"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            disabled={!isAdmin}
          />

          <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>

          <div className="auditlogs-filterBtns">
            <button className="btn" onClick={applyFilters} disabled={loading}>
              Apply
            </button>
            <button className="btn" onClick={clearFilters} disabled={loading}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {err && <p style={{ color: "red" }}>{err}</p>}
      {loading && <p>Loading…</p>}

      <div className="tableWrap" style={{ marginTop: 12 }}>
        <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th align="left">ID</th>
              <th align="left">Date</th>
              <th align="left">User</th>
              <th align="left">Action</th>
              <th align="left">Entity</th>
              <th align="left">IP</th>
              <th align="left">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.created_at ? new Date(r.created_at).toLocaleString() : "-"}</td>
                <td>{r.user_email || "-"}</td>
                <td>
                  <code>{r.action}</code>
                </td>
                <td>
                  {r.entity_type}:{r.entity_id ?? "-"}
                </td>
                <td>{r.ip_address ?? "-"}</td>
                <td>
                  <pre className="preBox">{r.details ? JSON.stringify(r.details, null, 2) : "-"}</pre>
                </td>
              </tr>
            ))}

            {!rows.length && !loading && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center" }}>
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="auditlogs-pager" style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={() => setPage(1)} disabled={page === 1 || loading}>
          First
        </button>
        <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}>
          Prev
        </button>

        <span style={{ color: "#374151" }}>
          Page <b>{page}</b> / <b>{totalPages}</b>
        </span>

        <button className="btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>
          Next
        </button>
        <button className="btn" onClick={() => setPage(totalPages)} disabled={page >= totalPages || loading}>
          Last
        </button>
      </div>
    </div>
  );
}
