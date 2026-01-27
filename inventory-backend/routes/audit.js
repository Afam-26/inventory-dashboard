// routes/audit.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";
import { verifyAuditChain } from "../utils/audit.js";
import { buildAuditProofBundle, verifyAuditProofBundle } from "../utils/auditProof.js";
import { createDailySnapshot } from "../utils/auditSnapshots.js";


const router = express.Router();

/**
 * All audit endpoints are tenant-scoped
 */
router.use(requireAuth, requireTenant);

/**
 * GET /api/audit?limit=50
 * List recent audit logs for current tenant
 */
router.get("/", async (req, res) => {
  const tenantId = req.tenantId;
  const limit = Math.min(Math.max(Number(req.query?.limit || 50), 1), 500);

  try {
    const [rows] = await db.query(
      `
      SELECT
        id, tenant_id, user_id, user_email, action, entity_type, entity_id,
        details, ip_address, user_agent, created_at
      FROM audit_logs
      WHERE tenant_id = ?
      ORDER BY id DESC
      LIMIT ?
      `,
      [tenantId, limit]
    );

    // Normalize details to object for client convenience
    const logs = rows.map((r) => {
      let detailsObj = null;
      if (r.details != null) {
        try {
          detailsObj = typeof r.details === "string" ? JSON.parse(r.details) : r.details;
        } catch {
          detailsObj = r.details;
        }
      }
      return { ...r, details: detailsObj };
    });

    res.json({ logs });
  } catch (err) {
    console.error("AUDIT LIST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * GET /api/audit/verify?limit=20000
 * Verify tamper-evident chain (tenant-scoped)
 */
router.get("/verify", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;
  const limit = Math.min(Math.max(Number(req.query?.limit || 20000), 1), 200000);

  try {
    const out = await verifyAuditChain(db, { limit, tenantId });

    // Add lastCreatedAtIso (requested)
    if (out.ok) {
      const [[last]] = await db.query(
        `
        SELECT created_at_iso AS lastCreatedAtIso
        FROM audit_logs
        WHERE tenant_id = ?
          AND row_hash IS NOT NULL
          AND created_at_iso IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
        `,
        [tenantId]
      );
      out.lastCreatedAtIso = last?.lastCreatedAtIso ?? null;
    }

    res.json(out);
  } catch (err) {
    console.error("AUDIT VERIFY ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/audit/proof
 * Query:
 *  - date=YYYY-MM-DD (UTC day)  OR
 *  - fromId=...&toId=...
 *  - download=1  => sets attachment headers
 */
router.get("/proof", async (req, res) => {
  try {
    const tenantId = Number(req.tenantId);

    const date = req.query?.date ? String(req.query.date) : null;
    const fromId = req.query?.fromId ? Number(req.query.fromId) : null;
    const toId = req.query?.toId ? Number(req.query.toId) : null;
    const download = String(req.query?.download || "") === "1";

    const bundle = await buildAuditProofBundle(db, {
      tenantId,
      date,
      fromId,
      toId,
    });

    // Attach snapshot for date mode if it exists; optionally create it if missing
    if (date && !bundle.snapshot) {
      // optional: auto-create snapshot for requested date (safe upsert)
      const snap = await createDailySnapshot(db, { tenantId, dateStr: date });
      bundle.snapshot = snap;
    }

    if (download) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="audit-proof-${tenantId}-${date || "range"}.json"`);
    }

    return res.json(bundle);
  } catch (e) {
    console.error("AUDIT PROOF ERROR:", e?.message || e);
    return res.status(500).json({ message: "Proof generation failed" });
  }
});

/**
 * POST /api/audit/proof/verify
 * Body: { bundle: <proof json> }
 */
router.post("/proof/verify", async (req, res) => {
  try {
    const bundle = req.body?.bundle;
    if (!bundle) return res.status(400).json({ ok: false, message: "bundle is required" });

    const out = verifyAuditProofBundle(bundle);
    return res.json(out);
  } catch (e) {
    console.error("PROOF VERIFY ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, message: "Proof verify failed" });
  }
});


export default router;
