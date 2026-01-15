// utils/mailer.js
import { Resend } from "resend";

function getEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
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

  const { error } = await resend.emails.send({
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
  });

  if (error) throw new Error(error.message || "Resend send failed");
}
