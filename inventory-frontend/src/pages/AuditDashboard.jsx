import { useEffect, useMemo, useState } from "react";
import { fetchAuditCsvBlob, getAuditReport, getAuditStats } from "../services/api";

function BarChart({ data }) {
  // data: [{ day: "2026-01-15", count: 12 }, ...]
  const max = Math.max(1, ...data.map((d) => Number(d.count || 0)));

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Events per day</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140, overflowX: "auto" }}>
        {data.map((d) => {
          const h = Math.round((Number(d.count || 0) / max) * 120);
          return (
            <div key={d.day} style={{ width: 18, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                title={`${d.day}: ${d.count}`}
                style={{ width: "100%", height: h, background: "#111827", borderRadius: 6 }}
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
      <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
        Max/day: <b>{max}</b>
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export default function AuditDashboard({ user }) {
  const isAdmin = user?.role === "admin";

  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [reportDays, setReportDays] = useState(7);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const s = await getAuditStats(days);
        setStats(s);
      } catch (e) {
        setErr(e?.message || "Failed to load stats");
      } finally {
        setLoading(false);
      }
    })();
  }, [days, isAdmin]);

  const byDay = useMemo(() => stats?.byDay || [], [stats]);
  const byAction = useMemo(() => stats?.byAction || [], [stats]);
  const byEntity = useMemo(() => stats?.byEntity || [], [stats]);
  const topUsers = useMemo(() => stats?.topUsers || [], [stats]);

  async function downloadCsv() {
    try {
      const blob = await fetchAuditCsvBlob({ limit: 20000 });
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

  async function generateReport() {
    try {
      setReportLoading(true);
      const r = await getAuditReport(reportDays);
      setReport(r);
    } catch (e) {
      alert(e?.message || "Failed to generate report");
    } finally {
      setReportLoading(false);
    }
  }

  function printReport() {
    window.print();
  }

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 1000 }}>
        <h1>Audit Dashboard</h1>
        <p>You do not have access to this page.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Audit Dashboard</h1>
          <div style={{ color: "#6b7280" }}>Charts, exports, and SOC-style summaries for your audit logs.</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 140 }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
          </select>

          <button className="btn" onClick={downloadCsv}>Export CSV</button>
        </div>
      </div>

      {err && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
          }}
        >
          {err}
        </div>
      )}

      {loading ? (
        <div style={{ marginTop: 16 }}>Loading...</div>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
          <BarChart data={byDay} />

          <Card title="Top users">
            {topUsers.length ? (
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {topUsers.map((u) => (
                  <li key={u.user_email} style={{ marginBottom: 6 }}>
                    <b>{u.user_email}</b> <span style={{ color: "#6b7280" }}>({u.count})</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div style={{ color: "#6b7280" }}>No data</div>
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
              <div style={{ color: "#6b7280" }}>No data</div>
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
              <div style={{ color: "#6b7280" }}>No data</div>
            )}
          </Card>
        </div>
      )}

      {/* SOC Report */}
      <div style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700 }}>SOC-style Audit Report</div>
            <div style={{ color: "#6b7280", fontSize: 13 }}>
              Summarizes failed logins, privilege changes, deletes, and after-hours logins.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select
              className="input"
              value={reportDays}
              onChange={(e) => setReportDays(Number(e.target.value))}
              style={{ width: 140 }}
            >
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

        {report && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 10, color: "#6b7280", fontSize: 12 }}>
              Generated: <b>{report.generated_at}</b> • Window: <b>{report.window_days} days</b>
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(4, 1fr)" }}>
              <Card title="Total events">{report.summary.total_events}</Card>
              <Card title="Logins">{report.summary.logins}</Card>
              <Card title="Failed logins">{report.summary.failed_logins}</Card>
              <Card title="Role changes">{report.summary.role_changes}</Card>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <Card title="Failed logins (top emails)">
                {(report.findings.failed_logins_by_email || []).length ? (
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    {report.findings.failed_logins_by_email.map((x, i) => (
                      <li key={i}>
                        <b>{x.user_email}</b> <span style={{ color: "#6b7280" }}>({x.count})</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div style={{ color: "#6b7280" }}>None</div>
                )}
              </Card>

              <Card title="Failed logins (top IPs)">
                {(report.findings.failed_logins_by_ip || []).length ? (
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    {report.findings.failed_logins_by_ip.map((x, i) => (
                      <li key={i}>
                        <b>{x.ip_address}</b> <span style={{ color: "#6b7280" }}>({x.count})</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div style={{ color: "#6b7280" }}>None</div>
                )}
              </Card>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <Card title="After-hours logins">
                {(report.findings.after_hours_logins || []).length ? (
                  <div style={{ fontSize: 13, color: "#111827" }}>
                    Showing latest {report.findings.after_hours_logins.length} results.
                  </div>
                ) : (
                  <div style={{ color: "#6b7280" }}>None</div>
                )}
              </Card>

              <Card title="Destructive events (DELETE)">
                {(report.findings.destructive_events || []).length ? (
                  <div style={{ fontSize: 13, color: "#111827" }}>
                    Showing latest {report.findings.destructive_events.length} results.
                  </div>
                ) : (
                  <div style={{ color: "#6b7280" }}>None</div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
