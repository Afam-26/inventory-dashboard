import express from "express";
import rateLimit from "express-rate-limit";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/request-access", limiter, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const company = String(req.body?.company || "").trim();
    const message = String(req.body?.message || "").trim();

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!email) return res.status(400).json({ message: "Email is required" });

    const to = process.env.REQUEST_ACCESS_TO;
    if (!to) return res.status(500).json({ message: "Missing env var: REQUEST_ACCESS_TO" });

    const subject = `Request Access — ${name}${company ? ` (${company})` : ""}`;

    const safeCompany = company || "—";
    const safeMsg = message || "—";

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>New Request Access</h2>
        <p><b>Name:</b> ${escapeHtml(name)}</p>
        <p><b>Email:</b> ${escapeHtml(email)}</p>
        <p><b>Company:</b> ${escapeHtml(safeCompany)}</p>
        <p><b>Message:</b><br/>${escapeHtml(safeMsg).replace(/\n/g, "<br/>")}</p>
      </div>
    `;
    

    await sendEmail({
      to,
      subject,
      html,
      text: `Request Access\nName: ${name}\nEmail: ${email}\nCompany: ${safeCompany}\nMessage: ${safeMsg}`,
    });

    return res.json({ ok: true });
  } catch (e) {
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
