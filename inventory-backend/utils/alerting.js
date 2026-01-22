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
 * Cooldown gate for alerts.
 * - timezone-safe (uses unix timestamps from MySQL)
 * - duplicate-safe (uses UPSERT)
 */
async function acquireCooldown(alertKeyRaw) {
  const alertKey = normalizeKey(alertKeyRaw);
  const minutes = Math.max(1, Number(process.env.ALERT_COOLDOWN_MINUTES || 30));

  // If DB is unavailable, don’t block alerts.
  try {
    // Read last sent time as unix timestamp (UTC-safe across envs)
    const [[row]] = await db.query(
      `
      SELECT UNIX_TIMESTAMP(sent_at) AS sent_ts
      FROM alert_cooldowns
      WHERE alert_key = ?
      LIMIT 1
      `,
      [alertKey]
    );

    if (row?.sent_ts) {
      const lastMs = Number(row.sent_ts) * 1000;
      const nowMs = Date.now();
      const diffMin = (nowMs - lastMs) / (60 * 1000);

      if (diffMin < minutes) {
        return { ok: false, skipped: true, reason: `cooldown_active_${minutes}m` };
      }
    }

    // Upsert: insert if new, otherwise refresh sent_at
    await db.query(
      `
      INSERT INTO alert_cooldowns (alert_key, sent_at)
      VALUES (?, NOW())
      ON DUPLICATE KEY UPDATE sent_at = NOW()
      `,
      [alertKey]
    );

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
    const cooldownKey =
      key ||
      `${subject}:${meta?.action || ""}:${meta?.entity_type || ""}:${meta?.entity_id || ""}:${
        meta?.user_email || ""
      }:${meta?.ip || ""}`;

    const cd = await acquireCooldown(cooldownKey);
    if (cd.skipped) {
      if (process.env.NODE_ENV !== "production") {
        console.log("SECURITY ALERT SKIPPED (cooldown):", cooldownKey, cd.reason);
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
