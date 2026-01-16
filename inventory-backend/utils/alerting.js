// utils/alerting.js
import { db } from "../config/db.js";
import { sendEmail } from "./mailer.js";

function truthy(v) {
  return String(v || "").toLowerCase() === "true";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtJson(v) {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return String(v);
  }
}

function shouldEmail() {
  return truthy(process.env.ALERT_EMAIL_ENABLED) && !!process.env.ALERT_EMAIL_TO;
}

function shouldSlack() {
  return truthy(process.env.ALERT_SLACK_ENABLED) && !!process.env.ALERT_SLACK_WEBHOOK_URL;
}

async function sendSlack(text) {
  if (!shouldSlack()) return { ok: false, skipped: true };

  const res = await fetch(process.env.ALERT_SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook failed (${res.status}): ${body}`);
  }
  return { ok: true };
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 255);
}

/**
 * Returns true if we should send this alert now (cooldown not active).
 * Also records the send time on success path (we record just before/after sending).
 */
async function acquireCooldown(alertKeyRaw) {
  const alertKey = normalizeKey(alertKeyRaw);
  const minutes = Math.max(1, Number(process.env.ALERT_COOLDOWN_MINUTES || 30));

  // If DB is unavailable, don’t block alerts.
  try {
    const [[row]] = await db.query(
      `
      SELECT sent_at
      FROM alert_cooldowns
      WHERE alert_key = ?
      ORDER BY sent_at DESC
      LIMIT 1
      `,
      [alertKey]
    );

    if (row?.sent_at) {
      const last = new Date(row.sent_at).getTime();
      const now = Date.now();
      const diffMin = (now - last) / (60 * 1000);
      if (diffMin < minutes) {
        return { ok: false, skipped: true, reason: `cooldown_active_${minutes}m` };
      }
    }

    // Record that we are sending (best effort)
    await db.query(`INSERT INTO alert_cooldowns (alert_key) VALUES (?)`, [alertKey]);
    return { ok: true, skipped: false };
  } catch (e) {
    console.error("ALERT COOLDOWN ERROR:", e?.message || e);
    return { ok: true, skipped: false, reason: "cooldown_db_error_bypass" };
  }
}

/**
 * Best-effort alert sender: never throws to callers.
 * Provide a stable `key` to dedupe spam (e.g. "bruteforce:email:ip")
 */
export async function sendSecurityAlert({ key, subject, lines = [], meta = {} }) {
  try {
    // Cooldown check
    const cooldownKey =
      key ||
      `${subject}:${meta?.action || ""}:${meta?.entity_type || ""}:${meta?.entity_id || ""}:${meta?.user_email || ""}:${meta?.ip || ""}`;

    const cd = await acquireCooldown(cooldownKey);
    if (cd.skipped) {
      if (process.env.NODE_ENV !== "production") {
        console.log("SECURITY ALERT SKIPPED (cooldown):", cooldownKey);
      }
      return { ok: true, skipped: true, reason: cd.reason };
    }

    const text = [subject, "", ...lines, "", "Meta:", fmtJson(meta)].join("\n");

    if (shouldEmail()) {
      await sendEmail({
        to: process.env.ALERT_EMAIL_TO,
        subject: `[Inventory Alert] ${subject}`,
        text,
        html: `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; white-space: pre-wrap;">${escapeHtml(
          text
        )}</pre>`,
      });
    }

    if (shouldSlack()) {
      await sendSlack(text);
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("SECURITY ALERT SENT:", subject);
    }

    return { ok: true };
  } catch (err) {
    console.error("SECURITY ALERT ERROR:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}
