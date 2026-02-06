// utils/mailer.js
import { Resend } from "resend";

function getEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function normalizeToArray(to) {
  // Already array -> flatten, trim
  if (Array.isArray(to)) {
    return to
      .flat()
      .map((x) => String(x || "").trim())
      .filter(Boolean);
  }

  // String -> split by comma if present
  const s = String(to || "").trim();
  if (!s) return [];

  if (s.includes(",")) {
    return s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return [s];
}

/**
 * sendEmail({ to, subject, html, text })
 * - Does not crash app startup if RESEND_API_KEY is missing.
 * - Throws ONLY when you actually try to send an email.
 */
export async function sendEmail({ to, subject, html, text }) {
  const apiKey = getEnv("RESEND_API_KEY");
  const from = getEnv("EMAIL_FROM");

  if (!apiKey) throw new Error("Missing env var: RESEND_API_KEY");
  if (!from) throw new Error("Missing env var: EMAIL_FROM");

  const resend = new Resend(apiKey);

  const toArr = normalizeToArray(to);
  if (!toArr.length) throw new Error("Invalid `to`: no recipients provided");

  const { error } = await resend.emails.send({
    from,
    to: toArr, // ✅ ALWAYS array (Resend format)
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
  });

  if (error) throw new Error(error.message || "Resend send failed");
}
