// src/pages/AuditDashboard.jsx
import { useEffect, useMemo, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:5000") + "/api";

function getToken() {
  return localStorage.getItem("token") || "";
}
function getTenantId() {
  const t = localStorage.getItem("tenantId");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function authHeaders(extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenantId = getTenantId();
  if (tenantId) headers["x-tenant-id"] = String(tenantId);
  return headers;
}
async function safeJson(res) {
  if (res.status === 204 || res.status === 304) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
async function fetchJsonAudit(path) {
  const primary = `${API_BASE}/audit${path}`;
  const fallback = `${API_BASE}/admin/audit${path}`;

  let res = await fetch(primary, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
    cache: "no-store",
  });

  if (res.status === 404) {
    res = await fetch(fallback, {
      method: "GET",
      headers: authHeaders(),
      credentials: "include",
      cache: "no-store",
    });
  }

  if (!res.ok) {
    const body = await safeJson(res);
    const msg = body?.message || `Request failed (${res.status}) for ${path}`;
    const err = new Error(msg);
    err.status = res.status;
    err.path = path;
    throw err;
  }

  return (await safeJson(res)) ?? {};
}

async function fetchBlobAudit(path) {
  const primary = `${API_BASE}/audit${path}`;
  const fallback = `${API_BASE}/admin/audit${path}`;

  let res = await fetch(primary, {
    method: "GET",
    headers: authHeaders({ Accept: "text/csv" }),
    credentials: "include",
    cache: "no-store",
  });

  if (res.status === 404) {
    res = await fetch(fallback, {
      method: "GET",
      headers: authHeaders({ Accept: "text/csv" }),
      credentials: "include",
      cache: "no-store",
    });
  }

  if (!res.ok) {
    const body = await safeJson(res);
    const msg = body?.message || `CSV export failed (${res.status})`;
    throw new Error(msg);
  }

  return await res.blob();
}

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function Card({ title, right, children }) {
  return (
    <div className="card">
      <div style={styles.cardHeaderRow}>
        <div style={styles.cardTitle}>{title}</div>
        {right ? <div>{right}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="card">
      <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>{value ?? "—"}</div>
      {sub ? <div style={{ fontSize: 12, color: "#6b7280" }}>{sub}</div> : null}
    </div>
  );
}

function BarChart({ data }) {
  const max = Math.max(1, ...(data || []).map((d) => Number(d.count || 0)));

  return (
    <div className="card">
      <div style={styles.cardHeaderRow}>
        <div style={styles.cardTitle}>Events per day</div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Max/day: <b>{max}</b>
        </div>
      </div>

      {!data || data.length === 0 ? (
        <div style={{ color: "#6b7280", fontSize: 13 }}>No daily data for this range.</div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            height: 150,
            overflowX: "auto",
            paddingTop: 4,
          }}
        >
          {data.map((d) => {
            const h = Math.round((Number(d.count || 0) / max) * 120);
            return (
              <div key={d.day} style={{ width: 18, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  title={`${d.day}: ${d.count}`}
                  style={{
                    width: "100%",
                    height: h,
                    background: "#111827",
                    borderRadius: 6,
                    opacity: d.count ? 1 : 0.25,
                  }}
                />
                <div
                  style={{
                    fontSize: 10,
                    color: "#6b7280",
                    marginTop: 6,
                    writingMode: "vertical-rl",
                    transform: "rotate(180deg)",
                  }}
                >
                  {String(d.day).slice(5)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Table({ columns, rows, emptyText = "No data" }) {
  return (
    <div className="tableWrap">
      <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ background: "#f3f4f6" }}>
          <tr>
            {columns.map((c) => (
              <th key={c.key} align="left">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows || rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: "center", color: "#6b7280" }}>
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((r, idx) => (
              <tr key={r.id ?? `${idx}`}>
                {columns.map((c) => (
                  <td key={c.key}>{typeof c.render === "function" ? c.render(r) : r[c.key]}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditDashboard({ user }) {
  const role = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = role === "owner" || role === "admin";

  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsErr, setStatsErr] = useState("");

  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  const [reportDays, setReportDays] = useState(7);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;

    (async () => {
      setStatsLoading(true);
      setStatsErr("");
      try {
        const data = await fetchJsonAudit(`/stats?days=${Number(days)}`);
        setStats(data);
      } catch (e) {
        setStats(null);
        setStatsErr(e?.message || "Failed to load stats");
      } finally {
        setStatsLoading(false);
      }
    })();
  }, [days, isAdmin]);

  const byDay = useMemo(() => stats?.byDay || [], [stats]);
  const byAction = useMemo(() => stats?.byAction || [], [stats]);
  const byEntity = useMemo(() => stats?.byEntity || [], [stats]);
  const topUsers = useMemo(() => stats?.topUsers || [], [stats]);

  const totalEvents = useMemo(() => {
    if (typeof stats?.total === "number") return stats.total;
    return (byAction || []).reduce((sum, a) => sum + Number(a.count || 0), 0);
  }, [stats, byAction]);

  const loginCount = useMemo(() => {
    const row = (byAction || []).find((x) => x.action === "LOGIN");
    return row ? Number(row.count || 0) : 0;
  }, [byAction]);

  const loginFailedCount = useMemo(() => {
    const row = (byAction || []).find((x) => x.action === "LOGIN_FAILED");
    return row ? Number(row.count || 0) : 0;
  }, [byAction]);

  const roleChangeCount = useMemo(() => {
    const row = (byAction || []).find((x) => x.action === "USER_ROLE_UPDATE");
    return row ? Number(row.count || 0) : 0;
  }, [byAction]);

  async function downloadCsv() {
    try {
      const blob = await fetchBlobAudit(`/csv?limit=20000`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit_logs.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.message || "CSV export failed");
    }
  }

  async function verifyIntegrity() {
    try {
      setVerifyLoading(true);
      setVerifyResult(null);
      const r = await fetchJsonAudit(`/verify?limit=20000`);
      setVerifyResult(r);
    } catch (e) {
      setVerifyResult({ ok: false, reason: e?.message || "Verify failed" });
    } finally {
      setVerifyLoading(false);
    }
  }

  async function generateReport() {
    try {
      setReportLoading(true);
      const r = await fetchJsonAudit(`/report?days=${Number(reportDays)}`);
      setReport(r);
    } catch (e) {
      setReport(null);
      alert(e?.message || "Report endpoint failed");
    } finally {
      setReportLoading(false);
    }
  }

  function printReport() {
    window.print();
  }

  if (!isAdmin) {
    return (
      <div>
        <h1>Audit Dashboard</h1>
        <p>You do not have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="auditdash-page">
      <div className="page-head">
        <div>
          <h1 style={{ marginBottom: 6 }}>Audit Dashboard</h1>
          <div style={{ color: "#6b7280" }}>Stats, exports, integrity checks, and SOC-style summaries.</div>
        </div>
      </div>

      <div className="auditdash-sticky">
        <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 160 }}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
        </select>

        <button className="btn" onClick={downloadCsv}>
          Export CSV
        </button>

        <button className="btn" onClick={verifyIntegrity} disabled={verifyLoading}>
          {verifyLoading ? "Verifying..." : "Verify integrity"}
        </button>

        {verifyResult && (
          <span style={verifyResult.ok ? styles.pillOk : styles.pillBad}>
            {verifyResult.ok
              ? `OK (checked ${verifyResult.checked}${verifyResult.startId ? `, startId ${verifyResult.startId}` : ""})`
              : `BROKEN${verifyResult.brokenAtId ? ` at id ${verifyResult.brokenAtId}` : ""}: ${
                  verifyResult.reason || "unknown"
                }`}
          </span>
        )}
      </div>

      {statsErr && (
        <div style={styles.errorBox}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Audit stats failed</div>
          <div>{statsErr}</div>
        </div>
      )}

      {statsLoading ? (
        <div style={{ marginTop: 16 }}>Loading stats...</div>
      ) : stats ? (
        <>
          <div className="auditdash-kpis">
            <Kpi label="Total events" value={totalEvents} sub={`Range: last ${days} days`} />
            <Kpi label="Logins" value={loginCount} />
            <Kpi label="Failed logins" value={loginFailedCount} />
            <Kpi label="Role changes" value={roleChangeCount} sub="(derived from action names)" />
          </div>

          <div className="auditdash-grid2">
            <BarChart data={byDay} />

            <Card title="Top users" right={<span style={{ fontSize: 12, color: "#6b7280" }}>Most active</span>}>
              {topUsers.length ? (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {topUsers.map((u) => (
                    <li key={u.user_email} style={{ marginBottom: 6 }}>
                      <b>{u.user_email}</b> <span style={{ color: "#6b7280" }}>({u.count})</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div style={{ color: "#6b7280", fontSize: 13 }}>No data</div>
              )}
            </Card>

            <Card title="Top actions">
              {byAction.length ? (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {byAction.map((a) => (
                    <li key={a.action} style={{ marginBottom: 6 }}>
                      <b>{a.action}</b> <span style={{ color: "#6b7280" }}>({a.count})</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div style={{ color: "#6b7280", fontSize: 13 }}>No data</div>
              )}
            </Card>

            <Card title="Top entity types">
              {byEntity.length ? (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {byEntity.map((e) => (
                    <li key={e.entity_type} style={{ marginBottom: 6 }}>
                      <b>{e.entity_type}</b> <span style={{ color: "#6b7280" }}>({e.count})</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div style={{ color: "#6b7280", fontSize: 13 }}>No data</div>
              )}
            </Card>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 16, color: "#6b7280" }}>
          Stats are not available. You can still use <b>Verify integrity</b> and <b>Export CSV</b>.
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="auditdash-reportHead">
          <div>
            <div style={{ fontWeight: 800 }}>SOC-style Audit Report</div>
            <div style={{ color: "#6b7280", fontSize: 13 }}>
              Summarizes failed logins, privilege changes, deletes, and after-hours logins.
            </div>
          </div>

          <div className="auditdash-reportActions">
            <select className="input" value={reportDays} onChange={(e) => setReportDays(Number(e.target.value))} style={{ width: 140 }}>
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>

            <button className="btn" onClick={generateReport} disabled={reportLoading}>
              {reportLoading ? "Generating..." : "Generate"}
            </button>

            <button className="btn" onClick={printReport} disabled={!report}>
              Print / Save PDF
            </button>
          </div>
        </div>

        {report ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 10, color: "#6b7280", fontSize: 12 }}>
              Generated: <b>{fmtDate(report.generated_at)}</b> • Window: <b>{report.window_days} days</b>
            </div>

            <div className="auditdash-kpis">
              <Card title="Total events">{report?.summary?.total_events ?? "—"}</Card>
              <Card title="Logins">{report?.summary?.logins ?? "—"}</Card>
              <Card title="Failed logins">{report?.summary?.failed_logins ?? "—"}</Card>
              <Card title="Role changes">{report?.summary?.role_changes ?? "—"}</Card>
            </div>

            <div className="auditdash-grid2">
              <div className="card">
                <div style={styles.cardHeaderRow}>
                  <div style={styles.cardTitle}>Failed logins by email (Top 10)</div>
                </div>
                <Table
                  columns={[
                    { key: "user_email", label: "User email" },
                    { key: "count", label: "Count" },
                  ]}
                  rows={(report?.findings?.failed_logins_by_email || []).slice(0, 10)}
                  emptyText="No failed logins"
                />
              </div>

              <div className="card">
                <div style={styles.cardHeaderRow}>
                  <div style={styles.cardTitle}>Failed logins by IP (Top 10)</div>
                </div>
                <Table
                  columns={[
                    { key: "ip_address", label: "IP address" },
                    { key: "count", label: "Count" },
                  ]}
                  rows={(report?.findings?.failed_logins_by_ip || []).slice(0, 10)}
                  emptyText="No failed logins"
                />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="card">
                <div style={styles.cardHeaderRow}>
                  <div style={styles.cardTitle}>After-hours logins (Latest 25)</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Total: {(report?.findings?.after_hours_logins || []).length}</div>
                </div>
                <Table
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "user_email", label: "User" },
                    { key: "ip_address", label: "IP" },
                    { key: "action", label: "Action" },
                    { key: "created_at", label: "Date", render: (r) => fmtDate(r.created_at) },
                  ]}
                  rows={(report?.findings?.after_hours_logins || []).slice(0, 25)}
                  emptyText="No after-hours logins"
                />
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <div style={styles.cardHeaderRow}>
                  <div style={styles.cardTitle}>Destructive events (Latest 25)</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Total: {(report?.findings?.destructive_events || []).length}</div>
                </div>
                <Table
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "action", label: "Action" },
                    { key: "entity_type", label: "Entity" },
                    { key: "entity_id", label: "Entity ID" },
                    { key: "user_email", label: "User" },
                    { key: "ip_address", label: "IP" },
                    { key: "created_at", label: "Date", render: (r) => fmtDate(r.created_at) },
                  ]}
                  rows={(report?.findings?.destructive_events || []).slice(0, 25)}
                  emptyText="No destructive events"
                />
              </div>

              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", color: "#374151" }}>Show raw JSON</summary>
                <pre style={{ ...styles.pre, marginTop: 10 }}>{JSON.stringify(report, null, 2)}</pre>
              </details>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, color: "#6b7280", fontSize: 13 }}>Generate a report to see SOC-style findings.</div>
        )}
      </div>
    </div>
  );
}

const styles = {
  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "baseline",
    marginBottom: 10,
    flexWrap: "wrap",
  },
  cardTitle: { fontWeight: 800 },
  errorBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
  },
  pillOk: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    fontSize: 12,
    fontWeight: 700,
  },
  pillBad: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    fontSize: 12,
    fontWeight: 700,
  },
  pre: {
    margin: 0,
    fontSize: 12,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    overflowX: "auto",
    maxHeight: 260,
  },
};
