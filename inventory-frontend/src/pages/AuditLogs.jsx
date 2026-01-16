import { useEffect, useMemo, useState } from "react";
import { getAuditLogs, downloadAuditCsv } from "../services/api";

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
        q: q || undefined,
        action: action || undefined,
        entity_type: entityType || undefined,
        user_email: isAdmin ? userEmail || undefined : undefined,
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
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h1>{isAdmin ? "Audit Logs" : "My Activity"}</h1>
        {isAdmin && (
          <button className="btn" onClick={() => downloadAuditCsv()}>
            Export CSV
          </button>
        )}
      </div>

      <div style={filterCard}>
        <div style={filterGrid}>
          <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <input className="input" placeholder="Action" value={action} onChange={(e) => setAction(e.target.value)} />
          <input className="input" placeholder="Entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          <input
            className="input"
            placeholder="User email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            disabled={!isAdmin}
          />
          <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={applyFilters}>Apply</button>
            <button className="btn" onClick={clearFilters}>Clear</button>
          </div>
        </div>
      </div>

      {err && <p style={{ color: "red" }}>{err}</p>}
      {loading && <p>Loading…</p>}

      <table border="1" cellPadding="10" style={{ width: "100%", marginTop: 12 }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>User</th>
            <th>Action</th>
            <th>Entity</th>
            <th>ID</th>
            <th>IP</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.user_email || "-"}</td>
              <td><code>{r.action}</code></td>
              <td>{r.entity_type}</td>
              <td>{r.entity_id ?? "-"}</td>
              <td>{r.ip_address ?? "-"}</td>
              <td>
                <pre style={pre}>{JSON.stringify(r.details || {}, null, 2)}</pre>
              </td>
            </tr>
          ))}
          {!rows.length && !loading && (
            <tr>
              <td colSpan={7} style={{ textAlign: "center" }}>No results</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={pager}>
        <button className="btn" onClick={() => setPage(1)} disabled={page === 1}>First</button>
        <button className="btn" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>Prev</button>
        <span>Page {page} / {totalPages}</span>
        <button className="btn" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>Next</button>
        <button className="btn" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>Last</button>
      </div>
    </div>
  );
}

const filterCard = { border: "1px solid #ddd", padding: 12, borderRadius: 12, marginTop: 12 };
const filterGrid = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 };
const pre = { background: "#f3f4f6", padding: 8, borderRadius: 8, maxHeight: 200, overflow: "auto" };
const pager = { display: "flex", gap: 8, marginTop: 12 };
