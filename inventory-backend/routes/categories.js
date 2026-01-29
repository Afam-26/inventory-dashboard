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
 * Plan category limits
 */
function getCategoryLimitForPlan(planKey) {
  const plan = String(planKey || "starter").toLowerCase();

  if (plan === "pro") return 200;
  if (plan === "starter") return 100;

  if (plan === "business") {
    // choose unlimited or 500
    const unlimited = String(process.env.BUSINESS_UNLIMITED || "").toLowerCase() === "true";
    return unlimited ? Infinity : 500;
  }

  // unknown plans => be generous but not infinite
  return 1000;
}

async function getTenantPlanKey(tenantId) {
  const [[t]] = await db.query(
    `SELECT plan_key FROM tenants WHERE id = ? LIMIT 1`,
    [tenantId]
  );
  return t?.plan_key || "starter";
}

async function countActiveCategories(tenantId) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM categories
     WHERE tenant_id = ?
       AND deleted_at IS NULL`,
    [tenantId]
  );
  return Number(r?.cnt || 0);
}

/**
 * GET /api/categories
 * Tenant-scoped list (ACTIVE ONLY)
 */
router.get("/", async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const [rows] = await db.query(
      `SELECT id, name
       FROM categories
       WHERE tenant_id = ?
         AND deleted_at IS NULL
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
 * Optional: list deleted categories (admin/owner)
 * GET /api/categories/deleted
 */
router.get("/deleted", requireRole("owner", "admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const [rows] = await db.query(
      `SELECT id, name, deleted_at
       FROM categories
       WHERE tenant_id = ?
         AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
      [tenantId]
    );

    res.json(rows || []);
  } catch (err) {
    console.error("CATEGORIES DELETED GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * POST /api/categories
 * Owner/Admin only
 * Body: { name }
 *
 * - Enforces plan limit per tenant (ACTIVE categories only)
 * - Uniqueness is enforced by DB via generated column index:
 *   UNIQUE (tenant_id, name_norm, is_deleted)
 */
router.post("/", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const name = normalizeCategoryName(req.body?.name);
    if (!name) return res.status(400).json({ message: "Name is required" });

    // ✅ Per-tenant plan limit (active only)
    const planKey = await getTenantPlanKey(tenantId);
    const limit = getCategoryLimitForPlan(planKey);

    if (Number.isFinite(limit)) {
      const activeCount = await countActiveCategories(tenantId);
      if (activeCount >= limit) {
        return res.status(409).json({
          message: `Category limit reached for plan '${planKey}'. Limit: ${limit}`,
        });
      }
    }

    // ✅ Insert (DB enforces case-insensitive uniqueness for active rows)
    const [result] = await db.query(
      `INSERT INTO categories (tenant_id, name, deleted_at)
       VALUES (?, ?, NULL)`,
      [tenantId, name]
    );

    await safeAudit(req, {
      action: "CATEGORY_CREATE",
      entity_type: "category",
      entity_id: result.insertId,
      details: { name, planKey, limit },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      severity: SEVERITY.INFO,
    });

    res.status(201).json({ message: "Category created", id: result.insertId });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Category already exists in this tenant" });
    }

    console.error("CATEGORIES POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * PATCH /api/categories/:id
 * Rename a category (owner/admin)
 * Body: { name }
 */
router.patch("/:id", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  try {
    if (!id) return res.status(400).json({ message: "Invalid category id" });

    const name = normalizeCategoryName(req.body?.name);
    if (!name) return res.status(400).json({ message: "Name is required" });

    const [[current]] = await db.query(
      `SELECT id, name
       FROM categories
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [id, tenantId]
    );
    if (!current) return res.status(404).json({ message: "Category not found" });

    await db.query(
      `UPDATE categories
       SET name = ?
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [name, id, tenantId]
    );

    await safeAudit(req, {
      action: "CATEGORY_RENAME",
      entity_type: "category",
      entity_id: id,
      details: { from: current.name, to: name },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      severity: SEVERITY.INFO,
    });

    res.json({ message: "Category updated" });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Category already exists in this tenant" });
    }

    console.error("CATEGORIES PATCH ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * DELETE /api/categories/:id
 * Owner/Admin only
 * Soft-delete with in-use protection
 */
router.delete("/:id", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  try {
    if (!id) return res.status(400).json({ message: "Invalid category id" });

    const [[current]] = await db.query(
      `SELECT id, name
       FROM categories
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
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

    // ✅ soft delete
    await db.query(
      `UPDATE categories
       SET deleted_at = NOW()
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [id, tenantId]
    );

    await safeAudit(req, {
      action: "CATEGORY_SOFT_DELETE",
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

/**
 * POST /api/categories/:id/restore
 * Restore a soft-deleted category (owner/admin)
 */
router.post("/:id/restore", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  try {
    if (!id) return res.status(400).json({ message: "Invalid category id" });

    const [[current]] = await db.query(
      `SELECT id, name, deleted_at
       FROM categories
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL
       LIMIT 1`,
      [id, tenantId]
    );
    if (!current) return res.status(404).json({ message: "Category not found or not deleted" });

    // plan limit check (restoring adds back to active)
    const planKey = await getTenantPlanKey(tenantId);
    const limit = getCategoryLimitForPlan(planKey);

    if (Number.isFinite(limit)) {
      const activeCount = await countActiveCategories(tenantId);
      if (activeCount >= limit) {
        return res.status(409).json({
          message: `Category limit reached for plan '${planKey}'. Limit: ${limit}`,
        });
      }
    }

    // restore
    await db.query(
      `UPDATE categories
       SET deleted_at = NULL
       WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    await safeAudit(req, {
      action: "CATEGORY_RESTORE",
      entity_type: "category",
      entity_id: id,
      details: { restored: { id: current.id, name: current.name } },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      severity: SEVERITY.INFO,
    });

    res.json({ message: "Category restored" });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "An active category with this name already exists." });
    }

    console.error("CATEGORIES RESTORE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
