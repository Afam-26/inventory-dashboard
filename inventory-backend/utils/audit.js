// utils/audit.js
import crypto from "crypto";
import { db as defaultDb } from "../config/db.js";
import { sendEmail } from "./mailer.js";
import { sendSlackAlert } from "./slack.js";

/**
 * Severity convention:
 * 1 = info
 * 2 = warn
 * 3 = critical
 */
export const SEVERITY = Object.freeze({
  INFO: 1,
  WARN: 2,
  CRITICAL: 3,
});

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function hmacSha256Hex(input) {
  const secret = requireEnv("AUDIT_HASH_SECRET");
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

/**
 * Stable JSON stringify: sorts object keys recursively
 * so MySQL JSON key reordering won't break verification.
 */
function stableStringify(value) {
  if (value === null || value === undefined) return "null";

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${entries.join(",")}}`;
}

function getRequestContext(req) {
  const ip =
    req?.headers?.["x-forwarded-for"]?.split(",")?.[0]?.trim() ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    null;

  const ua =
    (req?.get ? req.get("user-agent") : null) ||
    req?.headers?.["user-agent"] ||
    null;

  return { ip, ua };
}

/**
 * Canonical payload for hashing.
 * IMPORTANT: Keep stable over time.
 *
 * Key point: we hash details_c14n (a stable string), not the raw JSON object.
 */
function canonicalAuditPayload(entry, createdAtIso) {
  return stableStringify({
    user_id: entry.user_id ?? null,
    user_email: entry.user_email ?? null,
    action: entry.action,
    entity_type: entry.entity_type ?? null,
    entity_id: entry.entity_id ?? null,
    ip_address: entry.ip_address ?? null,
    user_agent: entry.user_agent ?? null,
    details_c14n: entry.details_c14n ?? "null",
    created_at_iso: createdAtIso,
  });
}

/**
 * ✅ logAudit(req, entry)
 * Matches your routes/auth.js usage.
 */
export async function logAudit(req, entry, options = {}) {
  if (!entry?.action) throw new Error("logAudit: entry.action is required");
  if (!entry?.entity_type) throw new Error("logAudit: entry.entity_type is required");

  const db = options.db || defaultDb;
  const { ip, ua } = getRequestContext(req);

  const createdAtIso = new Date().toISOString();

  const [lastRows] = await db.query(
    "SELECT row_hash FROM audit_logs ORDER BY id DESC LIMIT 1"
  );
  const prevHash = lastRows?.[0]?.row_hash ?? null;

  // Ensure details is an object or null (DB column is JSON)
  const detailsObj =
    entry.details && typeof entry.details === "object"
      ? entry.details
      : entry.details == null
      ? null
      : { value: entry.details };

  const detailsC14n = stableStringify(detailsObj);

  const canonical = canonicalAuditPayload(
    {
      user_id: entry.user_id ?? null,
      user_email: entry.user_email ?? null,
      action: entry.action,
      entity_type: entry.entity_type ?? null,
      entity_id: entry.entity_id ?? null,
      ip_address: entry.ip_address ?? ip,
      user_agent: entry.user_agent ?? ua,
      details_c14n: detailsC14n,
    },
    createdAtIso
  );

  const rowHash = hmacSha256Hex(`${canonical}|prev=${prevHash || ""}`);

  await db.query(
    `
      INSERT INTO audit_logs
        (user_id, user_email, action, entity_type, entity_id, details, ip_address, user_agent, prev_hash, row_hash, created_at_iso)
      VALUES
        (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?)
    `,
    [
      entry.user_id ?? null,
      entry.user_email ?? null,
      entry.action,
      entry.entity_type,
      entry.entity_id ?? null,
      JSON.stringify(detailsObj),
      entry.ip_address ?? ip,
      entry.user_agent ?? ua,
      prevHash,
      rowHash,
      createdAtIso,
    ]
  );

  return { prevHash, rowHash, createdAtIso };
}

export async function getAdminAlertTargets(db, severity) {
  try {
    const [rows] = await db.query(
      `
      SELECT
        u.id AS admin_user_id,
        u.email,
        COALESCE(p.email_enabled, 1) AS email_enabled,
        COALESCE(p.slack_enabled, 1) AS slack_enabled,
        COALESCE(p.security_only, 1) AS security_only,
        COALESCE(p.min_severity, 2) AS min_severity
      FROM users u
      LEFT JOIN admin_alert_prefs p ON p.admin_user_id = u.id
      WHERE u.role = 'admin'
      `
    );
    return rows.filter((r) => Number(severity) >= Number(r.min_severity));
  } catch {
    const emailTo = process.env.ALERT_EMAIL_TO;
    return emailTo
      ? [
          {
            admin_user_id: null,
            email: emailTo,
            email_enabled: 1,
            slack_enabled: 1,
            security_only: 1,
            min_severity: 2,
          },
        ]
      : [];
  }
}

export async function sendSecurityAlert(db, alert) {
  const severity = alert.severity ?? SEVERITY.WARN;

  const targets = await getAdminAlertTargets(db, severity);

  const emailRecipients = targets
    .filter((t) => Number(t.email_enabled) === 1)
    .map((t) => t.email)
    .filter(Boolean);

  const shouldSlack = targets.some((t) => Number(t.slack_enabled) === 1);

  if (emailRecipients.length > 0 && (alert.html || alert.text)) {
    await sendEmail({
      to: emailRecipients.join(","),
      subject: alert.subject ?? "Security Alert",
      html: alert.html,
      text: alert.text,
    });
  }

  if (shouldSlack && (alert.text || alert.subject || alert.blocks)) {
    await sendSlackAlert({
      text: alert.text ?? alert.subject ?? "Security Alert",
      blocks: alert.blocks,
    });
  }
}

/**
 * Verify tamper-evident audit chain.
 * ✅ Uses created_at_iso and stable JSON canonicalization.
 * ✅ Skips legacy rows without hashes.
 */
export async function verifyAuditChain(db, { limit = 20000 } = {}) {
  const [rows] = await db.query(
    `
      SELECT
        id, user_id, user_email, action, entity_type, entity_id,
        details, ip_address, user_agent,
        prev_hash, row_hash, created_at_iso
      FROM audit_logs
      ORDER BY id ASC
      LIMIT ?
    `,
    [Number(limit)]
  );

  const startIndex = rows.findIndex((r) => r.row_hash && r.created_at_iso);
  if (startIndex === -1) {
    return {
      ok: false,
      checked: rows.length,
      reason: "No hashed audit rows found (row_hash/created_at_iso are NULL).",
    };
  }

  let expectedPrev = rows[startIndex].prev_hash ?? null;

  for (let i = startIndex; i < rows.length; i++) {
    const r = rows[i];

    if (!r.row_hash || !r.created_at_iso) {
      return {
        ok: false,
        brokenAtId: r.id,
        reason: "Encountered un-hashed row inside hashed chain.",
      };
    }

    let detailsObj = null;
    if (r.details != null) {
      try {
        detailsObj = typeof r.details === "string" ? JSON.parse(r.details) : r.details;
      } catch {
        detailsObj = r.details;
      }
    }

    const detailsC14n = stableStringify(detailsObj);

    const canonical = canonicalAuditPayload(
      {
        user_id: r.user_id,
        user_email: r.user_email,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        ip_address: r.ip_address,
        user_agent: r.user_agent,
        details_c14n: detailsC14n,
      },
      r.created_at_iso
    );

    if ((r.prev_hash ?? null) !== (expectedPrev ?? null)) {
      return {
        ok: false,
        brokenAtId: r.id,
        reason: `prev_hash mismatch (expected ${expectedPrev}, got ${r.prev_hash})`,
      };
    }

    const expectedRowHash = hmacSha256Hex(`${canonical}|prev=${expectedPrev || ""}`);
    if (r.row_hash !== expectedRowHash) {
      return { ok: false, brokenAtId: r.id, reason: "row_hash mismatch" };
    }

    expectedPrev = r.row_hash;
  }

  return { ok: true, checked: rows.length - startIndex, startId: rows[startIndex].id };
}
