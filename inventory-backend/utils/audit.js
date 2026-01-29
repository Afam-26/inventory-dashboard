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

/**
 * ✅ Normalize emails into an array
 */
function normalizeEmailList(input) {
  if (Array.isArray(input)) {
    return input.flat().map((x) => String(x || "").trim()).filter(Boolean);
  }
  const s = String(input || "").trim();
  if (!s) return [];
  if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
  return [s];
}

/**
 * ✅ HMAC helper (never crashes app if secret missing)
 */
function hmacSha256Hex(input) {
  const secret = process.env.AUDIT_HASH_SECRET;
  if (!secret) {
    console.warn("WARN: AUDIT_HASH_SECRET is not set (audit hashing fallback used).");
    return crypto.createHash("sha256").update(`NO_SECRET|${input}`).digest("hex");
  }
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

/**
 * Stable JSON stringify: sorts object keys recursively
 */
function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

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

let _cachedDefaultTenantId = null;
async function getDefaultTenantId(db) {
  if (_cachedDefaultTenantId) return _cachedDefaultTenantId;
  try {
    const [[t]] = await db.query("SELECT id FROM tenants WHERE slug='default' LIMIT 1");
    _cachedDefaultTenantId = Number(t?.id || 1);
  } catch {
    _cachedDefaultTenantId = 1;
  }
  return _cachedDefaultTenantId;
}

/**
 * Canonical payload for hashing (stable).
 */
function canonicalAuditPayload(entry, createdAtIso) {
  return stableStringify({
    tenant_id: entry.tenant_id ?? null,
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

function isDeadlock(e) {
  return (
    e?.code === "ER_LOCK_DEADLOCK" ||
    e?.errno === 1213 ||
    e?.sqlState === "40001" ||
    /deadlock/i.test(String(e?.message || ""))
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * ✅ Retry helper for deadlocks / serialization failures
 */
async function withDeadlockRetry(fn, { tries = 4, baseDelayMs = 25 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (!isDeadlock(e) || attempt >= tries) throw e;

      const jitter = Math.floor(Math.random() * 15);
      await sleep(baseDelayMs * attempt + jitter);
    }
  }
}

/**
 * Acquire a per-tenant advisory lock for audit chain creation.
 */
async function acquireTenantAuditLock(db, tenantId, timeoutSec = 2) {
  const lockName = `audit_chain_tenant_${Number(tenantId)}`;
  try {
    const [[r]] = await db.query("SELECT GET_LOCK(?, ?) AS ok", [lockName, timeoutSec]);
    return Number(r?.ok || 0) === 1 ? lockName : null;
  } catch {
    return null;
  }
}

async function releaseTenantAuditLock(db, lockName) {
  if (!lockName) return;
  try {
    await db.query("SELECT RELEASE_LOCK(?)", [lockName]);
  } catch {
    // ignore
  }
}

/**
 * ✅ logAudit(req, entry)
 * - tenant chain locked per tenant
 * - deadlock retry
 * - ✅ FIX: automatically fills user_id/user_email from req.user when missing
 */
export async function logAudit(req, entry, options = {}) {
  if (!entry?.action) throw new Error("logAudit: entry.action is required");
  if (!entry?.entity_type) throw new Error("logAudit: entry.entity_type is required");

  const pool = options.db || defaultDb;
  const { ip, ua } = getRequestContext(req);

  // resolve tenantId
  let tenantId =
    req?.tenantId ??
    req?.user?.tenantId ??
    entry?.tenant_id ??
    entry?.tenantId ??
    null;

  if (!tenantId) tenantId = await getDefaultTenantId(pool);
  tenantId = Number(tenantId);

  const detailsObj =
    entry.details && typeof entry.details === "object"
      ? entry.details
      : entry.details == null
      ? null
      : { value: entry.details };

  const detailsC14n = stableStringify(detailsObj);

  const conn = typeof pool.getConnection === "function" ? await pool.getConnection() : null;
  const db = conn || pool;

  let lockName = null;

  const run = async () => {
    // createdAtIso should be unique per attempt (helps if we retry after deadlock)
    const createdAtIso = new Date().toISOString();

    try {
      if (conn) await conn.beginTransaction();

      // advisory lock to serialize chain per tenant
      lockName = await acquireTenantAuditLock(db, tenantId, 2);

      // 🔒 lock latest row for this tenant
      const [lastRows] = await db.query(
        `
        SELECT row_hash
        FROM audit_logs
        WHERE tenant_id = ?
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE
        `,
        [tenantId]
      );

      const prevHash = lastRows?.[0]?.row_hash ?? null;

      // ✅ Resolve actor (fixes user/email showing as "-")
      const resolvedUserId = entry.user_id ?? req?.user?.id ?? null;

      let resolvedUserEmail = entry.user_email ?? req?.user?.email ?? null;

      // If we still don't have email but we have userId, look it up (best-effort)
      if (!resolvedUserEmail && resolvedUserId) {
        try {
          const [[u]] = await db.query("SELECT email FROM users WHERE id=? LIMIT 1", [
            Number(resolvedUserId),
          ]);
          resolvedUserEmail = u?.email ?? null;
        } catch {
          // ignore
        }
      }

      const canonical = canonicalAuditPayload(
        {
          tenant_id: tenantId,
          user_id: resolvedUserId,
          user_email: resolvedUserEmail,
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
          (tenant_id, user_id, user_email, action, entity_type, entity_id,
           details, ip_address, user_agent, prev_hash, row_hash, created_at_iso)
        VALUES
          (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?)
        `,
        [
          tenantId,
          resolvedUserId,
          resolvedUserEmail,
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

      if (conn) await conn.commit();

      return { tenantId, prevHash, rowHash, createdAtIso };
    } catch (e) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {}
      }
      throw e;
    } finally {
      // release lock outside of transaction too
      try {
        await releaseTenantAuditLock(db, lockName);
      } catch {}
      lockName = null;
    }
  };

  try {
    return await withDeadlockRetry(run, { tries: 4, baseDelayMs: 25 });
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Admin alert targets
 */
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
  } catch (e) {
    const emailTo = process.env.ALERT_EMAIL_TO;
    const fallbackEmails = normalizeEmailList(emailTo);

    if (fallbackEmails.length) {
      return fallbackEmails.map((email) => ({
        admin_user_id: null,
        email,
        email_enabled: 1,
        slack_enabled: 1,
        security_only: 1,
        min_severity: 2,
      }));
    }

    return [];
  }
}

/**
 * Alerts never throw
 */
export async function sendSecurityAlert(db, alert) {
  const severity = alert?.severity ?? SEVERITY.WARN;

  let targets = [];
  try {
    targets = await getAdminAlertTargets(db, severity);
  } catch (e) {
    console.error("SECURITY ALERT TARGETS ERROR:", e?.message || e);
    targets = [];
  }

  const emailRecipients = targets
    .filter((t) => Number(t.email_enabled) === 1)
    .map((t) => t?.email)
    .flatMap((e) => normalizeEmailList(e))
    .filter(Boolean);

  const shouldSlack = targets.some((t) => Number(t.slack_enabled) === 1);

  if (emailRecipients.length > 0 && (alert?.html || alert?.text)) {
    try {
      await sendEmail({
        to: emailRecipients,
        subject: alert.subject ?? "Security Alert",
        html: alert.html,
        text: alert.text,
      });
    } catch (e) {
      console.error("SECURITY ALERT EMAIL ERROR:", e?.message || e);
    }
  }

  if (shouldSlack && (alert?.text || alert?.subject || alert?.blocks)) {
    try {
      await sendSlackAlert({
        text: alert.text ?? alert.subject ?? "Security Alert",
        blocks: alert.blocks,
      });
    } catch (e) {
      console.error("SECURITY ALERT SLACK ERROR:", e?.message || e);
    }
  }
}

/**
 * Verify tamper-evident audit chain.
 */
export async function verifyAuditChain(db, { limit = 20000, tenantId = null } = {}) {
  const params = [];
  const where = [];

  if (tenantId) {
    where.push("tenant_id = ?");
    params.push(Number(tenantId));
  }
  params.push(Number(limit));

  const [rows] = await db.query(
    `
    SELECT
      id, tenant_id, user_id, user_email, action, entity_type, entity_id,
      details, ip_address, user_agent,
      prev_hash, row_hash, created_at_iso
    FROM audit_logs
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY id ASC
    LIMIT ?
    `,
    params
  );

  if (!rows.length) {
    return { ok: false, checked: 0, scanned: 0, reason: "No rows found." };
  }

  const startIndex = rows.findIndex((r) => r.row_hash && r.created_at_iso);
  if (startIndex === -1) {
    return {
      ok: false,
      checked: 0,
      scanned: rows.length,
      legacyUnhashedBeforeStart: rows.length,
      reason: "No hashed audit rows found (row_hash/created_at_iso are NULL).",
      tenantId: tenantId ? Number(tenantId) : null,
    };
  }

  const startRow = rows[startIndex];
  const startId = startRow.id;
  const startHash = startRow.row_hash ?? null;
  const legacyUnhashedBeforeStart = startIndex;

  let expectedPrev = startRow.prev_hash ?? null;

  for (let i = startIndex; i < rows.length; i++) {
    const r = rows[i];

    if (!r.row_hash || !r.created_at_iso) {
      return {
        ok: false,
        checked: i - startIndex,
        scanned: rows.length,
        startId,
        endId: rows[i - 1]?.id ?? startId,
        startHash,
        endHash: rows[i - 1]?.row_hash ?? startHash,
        lastCreatedAtIso: rows[i - 1]?.created_at_iso ?? null,
        brokenAtId: r.id,
        legacyUnhashedBeforeStart,
        tenantId: tenantId ? Number(tenantId) : null,
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
        tenant_id: r.tenant_id ?? null,
        user_id: r.user_id ?? null,
        user_email: r.user_email ?? null,
        action: r.action,
        entity_type: r.entity_type ?? null,
        entity_id: r.entity_id ?? null,
        ip_address: r.ip_address ?? null,
        user_agent: r.user_agent ?? null,
        details_c14n: detailsC14n,
      },
      r.created_at_iso
    );

    if ((r.prev_hash ?? null) !== (expectedPrev ?? null)) {
      return {
        ok: false,
        checked: i - startIndex,
        scanned: rows.length,
        startId,
        endId: rows[i - 1]?.id ?? startId,
        startHash,
        endHash: rows[i - 1]?.row_hash ?? startHash,
        lastCreatedAtIso: rows[i - 1]?.created_at_iso ?? null,
        brokenAtId: r.id,
        legacyUnhashedBeforeStart,
        tenantId: tenantId ? Number(tenantId) : null,
        reason: `prev_hash mismatch (expected ${expectedPrev}, got ${r.prev_hash})`,
      };
    }

    const expectedRowHash = hmacSha256Hex(`${canonical}|prev=${expectedPrev || ""}`);
    if (r.row_hash !== expectedRowHash) {
      return {
        ok: false,
        checked: i - startIndex,
        scanned: rows.length,
        startId,
        endId: rows[i - 1]?.id ?? startId,
        startHash,
        endHash: rows[i - 1]?.row_hash ?? startHash,
        lastCreatedAtIso: rows[i - 1]?.created_at_iso ?? null,
        brokenAtId: r.id,
        legacyUnhashedBeforeStart,
        tenantId: tenantId ? Number(tenantId) : null,
        reason: "row_hash mismatch",
      };
    }

    expectedPrev = r.row_hash;
  }

  return {
    ok: true,
    checked: rows.length - startIndex,
    startId: rows[startIndex].id,
    tenantId: tenantId ? Number(tenantId) : null,
    lastId: rows[rows.length - 1]?.id ?? null,
    lastCreatedAtIso: rows[rows.length - 1]?.created_at_iso ?? null,
    lastRowHash: rows[rows.length - 1]?.row_hash ?? null,
  };
}
