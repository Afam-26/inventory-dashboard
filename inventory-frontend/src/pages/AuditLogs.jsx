import { useEffect, useMemo, useState } from "react";
import { getAuditLogs } from "../services/api";

export default function AuditLogs({ user }) {
  const isAdmin = user?.role === "admin";

  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [userEmail, setUserEmail] = useState("");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((total || 0) / limit)),
    [total, limit]
  );

  async function load(opts = {}) {
    setLoading(true);
    setErr("");
    try {
      const data = await getAuditLogs({
        q: q.trim() || undefined,
        action: action || undefined,
        entity_type: entityType || undefined,
        user_email: userEmail.trim() ? userEmail.trim().toLowerCase() : undefined,
        page: opts.page ?? page,
        limit: opts.limit ?? limit,
      });

      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (e) {
      setErr(e.message || "Failed to load audit logs");
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
    setQ("");
    setAction("");
    setEntityType("");
    setUserEmail("");
    setPage(1);
    load({ page: 1 });
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{isAdmin ? "Audit Logs" : "My Activity"}</h1>
        {!isAdmin && <span style={badgeStyle}>Your activity only</span>}
      </div>

      <div style={filterCard}>
        <div style={filterGrid}>
          <label style={labelStyle}>
            Search
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="email / action / entity / id"
            />
          </label>

          <label style={labelStyle}>
            Action
            <input
              className="input"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. PRODUCT_CREATE"
            />
          </label>

          <label style={labelStyle}>
            Entity Type
            <input
              className="input"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="e.g. product"
            />
          </label>

          <label style={labelStyle}>
            User Email {isAdmin ? "" : "(self only)"}
            <input
              className="input"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder={isAdmin ? "admin@store.com" : user?.email}
              disabled={!isAdmin}
            />
          </label>

          <label style={labelStyle}>
            Page Size
            <select
              className="input"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>

          <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
            <button className="btn" onClick={applyFilters} disabled={loading}>
              Apply
            </button>
            <button className="btn" onClick={clearFilters} disabled={loading}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {err ? <p style={{ color: "red" }}>{err}</p> : null}
      {loading ? <p>Loading…</p> : null}

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th align="left">Date</th>
              <th align="left">User</th>
              <th align="left">Action</th>
              <th align="left">Entity</th>
              <th align="left">Entity ID</th>
              <th align="left">IP</th>
              <th align="left">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.created_at)}</td>
                <td>{r.user_email || "-"}</td>
                <td><code>{r.action}</code></td>
                <td>{r.entity_type}</td>
                <td>{r.entity_id ?? "-"}</td>
                <td>{r.ip_address ?? "-"}</td>
                <td>
                  <details>
                    <summary style={{ cursor: "pointer" }}>View</summary>
                    <pre style={pre}>
                      {JSON.stringify(r.details ?? {}, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
            {!rows.length && !loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center" }}>No results</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={pager}>
        <button className="btn" onClick={() => setPage(1)} disabled={page === 1 || loading}>
          ⏮ First
        </button>
        <button
          className="btn"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1 || loading}
        >
          ◀ Prev
        </button>

        <span style={{ padding: "0 10px" }}>
          Page <b>{page}</b> of <b>{totalPages}</b> (Total: {total})
        </span>

        <button
          className="btn"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || loading}
        >
          Next ▶
        </button>
        <button className="btn" onClick={() => setPage(totalPages)} disabled={page >= totalPages || loading}>
          Last ⏭
        </button>
      </div>
    </div>
  );
}

function formatDate(dt) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return String(dt || "");
  }
}

const filterCard = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 12,
  padding: 12,
  background: "#fff",
};

const filterGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(200px, 1fr))",
  gap: 10,
};

const labelStyle = { display: "grid", gap: 6, fontSize: 13, color: "rgba(0,0,0,0.75)" };
const badgeStyle = {
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "rgba(0,0,0,0.03)",
};
const pre = { margin: 0, background: "rgba(0,0,0,0.05)", padding: 10, borderRadius: 10, overflow: "auto" };
const pager = { display: "flex", alignItems: "center", gap: 8, marginTop: 12 };
