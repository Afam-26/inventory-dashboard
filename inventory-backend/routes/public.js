// routes/public.js
import express from "express";
import rateLimit from "express-rate-limit";

import { sendEmail } from "../services/mail/mailer.js";
import { logAudit, SEVERITY, sendSecurityAlert } from "../utils/audit.js";
import { sendSlackAlert } from "../utils/slack.js";

const router = express.Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});

/**
 * POST /api/public/request-access
 * Body:
 * { name, email, company, message, website }  // website = honeypot
 */
router.post("/request-access", limiter, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const company = String(req.body?.company || "").trim();
  const message = String(req.body?.message || "").trim();

  // honeypot (must be empty)
  const website = String(req.body?.website || "").trim();

  if (!name) return res.status(400).json({ message: "Name is required" });
  if (!email) return res.status(400).json({ message: "Email is required" });
  if (!email.includes("@")) return res.status(400).json({ message: "Enter a valid email" });

  // ✅ bot trap: silently accept but do nothing
  if (website) {
    try {
      await logAudit(req, {
        action: "REQUEST_ACCESS_SPAM",
        entity_type: "PUBLIC",
        details: { name, email, company, message, website, dropped: true },
      });
    } catch {}
    return res.json({ ok: true });
  }

  // Resend recipient
  const to = String(process.env.REQUEST_ACCESS_TO || "").trim();
  if (!to) return res.status(500).json({ message: "Missing env var: REQUEST_ACCESS_TO" });

  const safeCompany = company || "—";
  const safeMsg = message || "—";

  const subject = `Request Access — ${name}${company ? ` (${company})` : ""}`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2>New Request Access</h2>
      <p><b>Name:</b> ${escapeHtml(name)}</p>
      <p><b>Email:</b> ${escapeHtml(email)}</p>
      <p><b>Company:</b> ${escapeHtml(safeCompany)}</p>
      <p><b>Message:</b><br/>${escapeHtml(safeMsg).replace(/\n/g, "<br/>")}</p>
    </div>
  `;

  try {
    // 1) Email
    await sendEmail({
      to,
      subject,
      html,
      text: `Request Access\nName: ${name}\nEmail: ${email}\nCompany: ${safeCompany}\nMessage: ${safeMsg}`,
    });

    // 2) Slack (non-blocking)
    try {
      await sendSlackAlert({
        text:
          `🆕 *Request Access*\n` +
          `• Name: ${name}\n` +
          `• Email: ${email}\n` +
          `• Company: ${safeCompany}\n` +
          `• Message: ${safeMsg}`,
      });
    } catch (e) {
      console.error("REQUEST ACCESS SLACK ERROR:", e?.message || e);
    }

    // 3) Audit log (non-blocking)
    try {
      await logAudit(req, {
        action: "REQUEST_ACCESS",
        entity_type: "PUBLIC",
        details: { name, email, company: safeCompany, message: safeMsg },
      });
    } catch (e) {
      console.error("REQUEST ACCESS AUDIT ERROR:", e?.message || e);
    }

    return res.json({ ok: true });
  } catch (e) {
    // audit failure (non-blocking)
    try {
      await logAudit(req, {
        action: "REQUEST_ACCESS_FAILED",
        entity_type: "PUBLIC",
        details: {
          name,
          email,
          company: safeCompany,
          message: safeMsg,
          error: String(e?.message || e || "unknown"),
        },
      });
    } catch {}

    // optional: alert admins
    try {
      await sendSecurityAlert(undefined, {
        severity: SEVERITY.WARN,
        subject: "Request Access email failed",
        text: `Request access email failed: ${String(e?.message || e)}`,
      });
    } catch {}

    return res.status(400).json({ message: e?.message || "Failed to send request" });
  }
});

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default router;
