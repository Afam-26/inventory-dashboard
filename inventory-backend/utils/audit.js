// utils/audit.js
import { db } from "../config/db.js";
import { sendSecurityAlert } from "./alerting.js";

function afterHours(now = new Date()) {
  const start = Number(process.env.ALERT_AFTER_HOURS_START || 19);
  const end = Number(process.env.ALERT_AFTER_HOURS_END || 7);
  const h = now.getHours();
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}

function isLargeStockOut(details) {
  const threshold = Number(process.env.ALERT_STOCK_OUT_THRESHOLD || 50);
  const qty = Number(details?.qty ?? details?.quantity ?? 0);

  const type = String(details?.type || details?.direction || "").toLowerCase();
  const isOut =
    type === "out" ||
    type === "stock_out" ||
    String(details?.movement || "").toLowerCase() === "out";

  return isOut && qty >= threshold;
}

async function failedLoginSpikeCheck(userEmail) {
  const threshold = Number(process.env.ALERT_FAILED_LOGIN_THRESHOLD || 5);
  const windowMin = Number(process.env.ALERT_FAILED_LOGIN_WINDOW_MINUTES || 15);
  if (!userEmail) return { spiking: false, count: 0, threshold, windowMin };

  const [[row]] = await db.query(
    `
    SELECT COUNT(*) AS c
    FROM audit_logs
    WHERE action='LOGIN_FAILED'
      AND user_email = ?
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
    `,
    [userEmail, windowMin]
  );

  const count = Number(row?.c || 0);
  return { spiking: count >= threshold, count, threshold, windowMin };
}

/**
 * logAudit(req, { action, entity_type, entity_id, details })
 * Best-effort: never crashes your API if auditing/alerting fails.
 */
export async function logAudit(
  req,
  { action, entity_type, entity_id = null, details = null, user_id = null, user_email = null }
) {
  try {
    const resolvedUserId = user_id ?? req.user?.id ?? null;
    const resolvedUserEmail =
      (user_email ?? req.user?.email ?? null)?.toLowerCase?.() ?? null;

    const ipAddress =
      (req.headers["x-forwarded-for"]?.toString().split(",")[0] || "").trim() ||
      req.socket?.remoteAddress ||
      null;

    const userAgent = req.headers["user-agent"] || null;

    const safeDetails =
      details == null
        ? null
        : typeof details === "object"
        ? details
        : { value: details };

    // 1) Write audit row
    const [result] = await db.query(
      `INSERT INTO audit_logs
        (user_id, user_email, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resolvedUserId,
        resolvedUserEmail,
        action,
        entity_type,
        entity_id,
        safeDetails ? JSON.stringify(safeDetails) : null,
        ipAddress,
        userAgent,
      ]
    );

    // 2) Alert rules (best-effort)
    try {
      const role = String(req.user?.role || "").toLowerCase();
      const isAdminActor = role === "admin";

      // A) Privilege changes
      if (action === "USER_ROLE_UPDATE" || action === "USER_CREATE") {
        await sendSecurityAlert({
          key: `privchange:${action}:${resolvedUserEmail || "-"}:${entity_id ?? "-"}`,
          subject: `User privilege change: ${action}`,
          lines: [
            `Actor: ${resolvedUserEmail || "-"} (id=${resolvedUserId ?? "-"}) role=${role || "-"}`,
            `Target: ${entity_type}#${entity_id ?? "-"}`,
            `IP: ${ipAddress || "-"}`,
          ],
          meta: {
            audit_id: result.insertId,
            action,
            entity_type,
            entity_id,
            user_email: resolvedUserEmail,
            ip: ipAddress,
            details: safeDetails,
          },
        });
      }

      // B) Destructive operations
      if (String(action).includes("DELETE")) {
        await sendSecurityAlert({
          key: `delete:${action}:${entity_type}:${entity_id ?? "-"}:${resolvedUserEmail || "-"}`,
          subject: `Destructive action: ${action}`,
          lines: [
            `Actor: ${resolvedUserEmail || "-"} (id=${resolvedUserId ?? "-"}) role=${role || "-"}`,
            `Entity: ${entity_type}#${entity_id ?? "-"}`,
            `IP: ${ipAddress || "-"}`,
          ],
          meta: {
            audit_id: result.insertId,
            action,
            entity_type,
            entity_id,
            user_email: resolvedUserEmail,
            ip: ipAddress,
            details: safeDetails,
          },
        });
      }

      // C) Brute-force: repeated failed logins
      if (action === "LOGIN_FAILED") {
        const { spiking, count, threshold, windowMin } = await failedLoginSpikeCheck(
          resolvedUserEmail
        );
        if (spiking) {
          await sendSecurityAlert({
            // cooldown key dedupes repeated notifications for same user+ip
            key: `bruteforce:${resolvedUserEmail || "-"}:${ipAddress || "-"}`,
            subject: `Possible brute-force: repeated LOGIN_FAILED`,
            lines: [
              `User: ${resolvedUserEmail || "-"}`,
              `IP: ${ipAddress || "-"}`,
              `Count: ${count} in last ${windowMin} min (threshold ${threshold})`,
            ],
            meta: {
              audit_id: result.insertId,
              action,
              user_email: resolvedUserEmail,
              ip: ipAddress,
              user_agent: userAgent,
              details: safeDetails,
            },
          });
        }
      }

      // D) After-hours admin logins
      if (action === "LOGIN" && isAdminActor && afterHours(new Date())) {
        await sendSecurityAlert({
          key: `afterhours_admin_login:${resolvedUserEmail || "-"}:${ipAddress || "-"}`,
          subject: `After-hours admin login`,
          lines: [
            `Admin: ${resolvedUserEmail || "-"} (id=${resolvedUserId ?? "-"})`,
            `IP: ${ipAddress || "-"}`,
            `UA: ${userAgent || "-"}`,
          ],
          meta: {
            audit_id: result.insertId,
            action,
            user_email: resolvedUserEmail,
            ip: ipAddress,
            details: safeDetails,
          },
        });
      }

      // E) Large stock-outs (if your details include qty/type)
      if (action === "STOCK_OUT" || action === "STOCK_UPDATE") {
        if (isLargeStockOut(safeDetails || {})) {
          await sendSecurityAlert({
            key: `large_stock_out:${entity_type}:${entity_id ?? "-"}:${resolvedUserEmail || "-"}`,
            subject: `Large stock-out detected`,
            lines: [
              `Actor: ${resolvedUserEmail || "-"} (id=${resolvedUserId ?? "-"}) role=${role || "-"}`,
              `Entity: ${entity_type}#${entity_id ?? "-"}`,
              `IP: ${ipAddress || "-"}`,
            ],
            meta: {
              audit_id: result.insertId,
              action,
              entity_type,
              entity_id,
              user_email: resolvedUserEmail,
              ip: ipAddress,
              details: safeDetails,
            },
          });
        }
      }
    } catch (alertErr) {
      console.error("AUDIT ALERT ERROR:", alertErr?.message || alertErr);
    }
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err?.message || err);
  }
}
