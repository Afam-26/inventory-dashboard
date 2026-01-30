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
 * Plan limits (per tenant)
 * Starter: 100
 * Pro: 200
 * Business: 500  (change to Infinity if you want unlimited)
 */
const PLAN_CATEGORY_LIMITS = {
  starter: 100,
  pro: 200,
  business: 500, // or Infinity for unlimited
};

async function getTenantPlanKey(tenantId) {
  const [[t]] = await db.query("SELECT plan_key FROM tenants WHERE id=? LIMIT 1", [tenantId]);
  return String(t?.plan_key || "starter").toLowerCase();
}

async function getActiveCategoryCount(tenantId) {
  const [[cnt]] = await db.query(
    `SELECT COUNT(*) AS c
     FROM categories
     WHERE tenant_id=? AND deleted_at IS NULL`,
    [tenantId]
  );
  return Number(cnt?.c || 0);
}

async function enforceCategoryLimit(tenantId) {
  const planKey = await getTenantPlanKey(tenantId);
  const limit = PLAN_CATEGORY_LIMITS[planKey] ?? PLAN_CATEGORY_LIMITS.starter;

  // treat Infinity as unlimited
  if (limit === Infinity) return { ok: true, planKey, limit, current: await getActiveCategoryCount(tenantId) };

  const current = await getActiveCategoryCount(tenantId);

  if (current >= limit) {
    return {
      ok: false,
      planKey,
      limit,
      current,
      message: `Category limit reached for plan (${planKey}). Limit: ${limit}.`,
    };
  }

  return { ok: true, planKey, limit, current };
}

/**
 * GET /api/categories
 * Active categories (tenant-scoped)
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
 * GET /api/categories/deleted
 * Deleted categories list (tenant-scoped)
 * ✅ Admin/Owner only (matches your UI tab)
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
 * ✅ DB enforces uniqueness via:
 * UNIQUE (tenant_id, name_norm, is_deleted)
 */
router.post("/", requireRole("owner", "admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const name = normalizeCategoryName(req.body?.name);
    if (!name) return res.status(400).json({ message: "Name is required" });

    // ✅ enforce plan limit
    const limitCheck = await enforceCategoryLimit(tenantId);
    if (!limitCheck.ok) {
      return res.status(402).json({
        message: limitCheck.message,
        code: "PLAN_LIMIT",
        planKey: limitCheck.planKey,
        limit: limitCheck.limit,
        current: limitCheck.current,
      });
    }

    const [result] = await db.query(
      `INSERT INTO categories (tenant_id, name)
       VALUES (?, ?)`,
      [tenantId, name]
    );

    await safeAudit(req, {
      action: "CATEGORY_CREATE",
      entity_type: "category",
      entity_id: result.insertId,
      details: {
        name,
        planKey: limitCheck.planKey,
        limit: limitCheck.limit,
        current: limitCheck.current,
      },
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
 * DELETE /api/categories/:id
 * Owner/Admin only
 * ✅ Soft delete (sets deleted_at)
 */
router.delete("/:id", requireRole("owner", "admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid category id" });

    const [[current]] = await db.query(
      `SELECT id, name, deleted_at
       FROM categories
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [id, tenantId]
    );

    if (!current) return res.status(404).json({ message: "Category not found" });
    if (current.deleted_at) return res.status(409).json({ message: "Category is already deleted" });

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

    await db.query(
      `UPDATE categories
       SET deleted_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    await safeAudit(req, {
      action: "CATEGORY_SOFT_DELETE",
      entity_type: "category",
      entity_id: id,
      details: { deleted: { id: current.id, name: current.name } },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      severity: SEVERITY.INFO,
    });

    res.json({ message: "Category deleted", deleted: { id, name: current.name } });
  } catch (err) {
    console.error("CATEGORIES DELETE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * POST /api/categories/:id/restore
 * Owner/Admin only
 * ✅ Restore soft-deleted category (sets deleted_at = NULL)
 *
 * Restoring counts toward the plan limit.
 */
router.post("/:id/restore", requireRole("owner", "admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid category id" });

    const [[current]] = await db.query(
      `SELECT id, name, deleted_at
       FROM categories
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [id, tenantId]
    );

    if (!current) return res.status(404).json({ message: "Category not found" });
    if (!current.deleted_at) return res.status(409).json({ message: "Category is already active" });

    // ✅ enforce plan limit
    const limitCheck = await enforceCategoryLimit(tenantId);
    if (!limitCheck.ok) {
      return res.status(402).json({
        message: limitCheck.message,
        code: "PLAN_LIMIT",
        planKey: limitCheck.planKey,
        limit: limitCheck.limit,
        current: limitCheck.current,
      });
    }

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
      details: {
        restored: { id: current.id, name: current.name },
        planKey: limitCheck.planKey,
        limit: limitCheck.limit,
        current: limitCheck.current,
      },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      severity: SEVERITY.INFO,
    });

    res.json({ message: "Category restored", restored: { id, name: current.name } });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Cannot restore: an active category with the same name already exists.",
      });
    }

    console.error("CATEGORIES RESTORE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
