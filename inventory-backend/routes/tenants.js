// routes/tenants.js
import express from "express";
import jwt from "jsonwebtoken";
import { db } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { logAudit, SEVERITY } from "../utils/audit.js";

const router = express.Router();

function signTenantToken({ id, email, tenantId, role }) {
  return jwt.sign({ id, email, tenantId, role }, process.env.JWT_SECRET, {
    expiresIn: "15m",
  });
}

/**
 * ✅ Non-blocking wrapper: audit must NEVER break tenant selection
 */
async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch (e) {
    console.error("AUDIT FAILED (ignored):", e?.message || e);
  }
}

// List tenants for current user
router.get("/", requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const [rows] = await db.query(
      `SELECT t.id, t.name, t.slug, tm.role, t.plan_key, t.status
       FROM tenant_members tm
       JOIN tenants t ON t.id = tm.tenant_id
       WHERE tm.user_id = ?
       ORDER BY t.created_at DESC`,
      [userId]
    );

    res.json({ tenants: rows });
  } catch (err) {
    console.error("TENANTS LIST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// Select tenant and mint tenant-scoped token
router.post("/select", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const email = req.user.email;
  const tenantId = Number(req.body?.tenantId);

  if (!tenantId) return res.status(400).json({ message: "tenantId required" });

  try {
    const [rows] = await db.query(
      `SELECT role FROM tenant_members WHERE tenant_id=? AND user_id=? LIMIT 1`,
      [tenantId, userId]
    );

    if (!rows.length) return res.status(403).json({ message: "Not a member of this tenant" });

    const role = String(rows[0].role || "").toLowerCase();
    req.tenantId = tenantId; // ensures request context is tenant scoped for auditing


    // ✅ audit tenant selection (non-blocking)
    await safeAudit(req, {
      action: "TENANT_SELECT",
      entity_type: "tenant",
      entity_id: tenantId,
      details: { tenantId, role },
      user_id: userId,
      user_email: email,
      severity: SEVERITY.INFO,      
    });

    const token = signTenantToken({ id: userId, email, tenantId, role });

    res.json({ token, tenantId, role });
  } catch (err) {
    console.error("TENANT SELECT ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
