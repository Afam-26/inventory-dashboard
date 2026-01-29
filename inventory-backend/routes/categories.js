// routes/categories.js
import express from "express";
import { db } from "../config/db.js";
import { logAudit, SEVERITY } from "../utils/audit.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";

const router = express.Router();

// All category routes require tenant context
router.use(requireAuth, requireTenant);

function normalizeCategoryName(input) {
  // trim and collapse whitespace
  return String(input || "").trim().replace(/\s+/g, " ");
}

async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch (e) {
    console.error("AUDIT FAILED (ignored):", e?.message || e);
  }
}

/**
 * GET /api/categories
 * Tenant-scoped list
 */
router.get("/", async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const [rows] = await db.query(
      `SELECT id, name
       FROM categories
       WHERE tenant_id = ?
       ORDER BY name ASC`,
      [tenantId]
    );

    res.json(rows || []);
  } catch (err) {
    console.error("CATEGORIES GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * POST /api/categories
 * Owner/Admin only
 * Body: { name }
 */
router.post("/", requireRole("owner", "admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const name = normalizeCategoryName(req.body?.name);
    if (!name) return res.status(400).json({ message: "Name is required" });

    // ✅ Let DB enforce uniqueness: UNIQUE(tenant_id, name)
    // This avoids race conditions (two requests at once).
    const [result] = await db.query(
      `INSERT INTO categories (tenant_id, name) VALUES (?, ?)`,
      [tenantId, name]
    );

    await safeAudit(req, {
      action: "CATEGORY_CREATE",
      entity_type: "category",
      entity_id: result.insertId,
      details: { name },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      severity: SEVERITY.INFO,
    });

    res.status(201).json({ message: "Category created", id: result.insertId });
  } catch (err) {
    // ✅ Clean duplicate response
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Category already exists in this tenant" });
    }

    console.error("CATEGORIES POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * DELETE /api/categories/:id
 * Owner/Admin only
 * Tenant-safe delete with in-use protection
 */
router.delete("/:id", requireRole("owner", "admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid category id" });

    const [[current]] = await db.query(
      `SELECT id, name
       FROM categories
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [id, tenantId]
    );
    if (!current) return res.status(404).json({ message: "Category not found" });

    // prevent deleting category used by products (tenant-safe)
    const [[used]] = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM products
       WHERE tenant_id = ?
         AND category_id = ?`,
      [tenantId, id]
    );

    if (Number(used?.cnt || 0) > 0) {
      return res.status(409).json({
        message: "Category is in use by one or more products. Reassign/remove products first.",
      });
    }

    await db.query(`DELETE FROM categories WHERE id = ? AND tenant_id = ?`, [id, tenantId]);

    await safeAudit(req, {
      action: "CATEGORY_DELETE",
      entity_type: "category",
      entity_id: id,
      details: { deleted: current },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      severity: SEVERITY.INFO,
    });

    res.json({ message: "Category deleted", deleted: current });
  } catch (err) {
    console.error("CATEGORIES DELETE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
