// routes/products.js
import express from "express";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

function csvEscape(v) {
  const s = String(v ?? "");
  // If contains comma, quote, or newline, wrap in quotes and escape quotes
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

// Basic CSV parser that supports quoted fields and commas inside quotes.
// Returns array of rows, each row is array of strings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // normalize line endings
  const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        // escaped quote
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      field = "";
      // avoid pushing trailing empty row if file ends with newline
      if (row.some((x) => String(x).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  // last field/row
  row.push(field);
  if (row.some((x) => String(x).trim() !== "")) rows.push(row);

  return rows;
}

// ✅ any logged in user can view products (+ optional search)
router.get("/", requireAuth, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const like = `%${search}%`;

    const [rows] = await db.query(
      `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.category_id,
        c.name AS category,
        p.quantity,
        p.cost_price,
        p.selling_price,
        p.reorder_level,
        p.created_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE (? = '' OR p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ?)
      ORDER BY p.id DESC
      `,
      [search, like, like, like]
    );

    res.json(rows);
  } catch (err) {
    console.error("PRODUCTS GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ CSV export (admin + staff)
router.get("/export.csv", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT 
        p.name,
        p.sku,
        c.name AS category,
        p.quantity,
        p.cost_price,
        p.selling_price,
        p.reorder_level
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.id DESC
      `
    );

    const header = ["name", "sku", "category", "quantity", "cost_price", "selling_price", "reorder_level"];
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push(
        [
          csvEscape(r.name),
          csvEscape(r.sku),
          csvEscape(r.category || ""),
          csvEscape(r.quantity ?? 0),
          csvEscape(r.cost_price ?? 0),
          csvEscape(r.selling_price ?? 0),
          csvEscape(r.reorder_level ?? 0),
        ].join(",")
      );
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="products.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("PRODUCTS CSV EXPORT ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ CSV import (admin only)
// Body: { csvText: "name,sku,category,quantity,cost_price,selling_price,reorder_level\n..." }
router.post("/import", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const csvText = String(req.body?.csvText || "");
    if (!csvText.trim()) return res.status(400).json({ message: "csvText is required" });

    const rows = parseCsv(csvText);
    if (rows.length < 2) return res.status(400).json({ message: "CSV must include header and at least 1 row" });

    const header = rows[0].map((h) => String(h || "").trim().toLowerCase());
    const idx = (name) => header.indexOf(name);

    const required = ["name", "sku"];
    for (const r of required) {
      if (idx(r) === -1) return res.status(400).json({ message: `Missing required column: ${r}` });
    }

    const iName = idx("name");
    const iSku = idx("sku");
    const iCategory = idx("category"); // optional (category name)
    const iQuantity = idx("quantity"); // optional
    const iCost = idx("cost_price"); // optional
    const iSell = idx("selling_price"); // optional
    const iReorder = idx("reorder_level"); // optional

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    // Cache category lookups to reduce DB calls
    const catCache = new Map(); // nameLower -> id|null

    async function getOrCreateCategoryId(catNameRaw) {
      const catName = String(catNameRaw || "").trim();
      if (!catName) return null;

      const key = catName.toLowerCase();
      if (catCache.has(key)) return catCache.get(key);

      const [[found]] = await db.query("SELECT id FROM categories WHERE LOWER(name)=LOWER(?) LIMIT 1", [catName]);
      if (found?.id) {
        catCache.set(key, found.id);
        return found.id;
      }

      // create new category (admin allowed)
      const [r] = await db.query("INSERT INTO categories (name) VALUES (?)", [catName]);
      const newId = r.insertId;

      await logAudit(req, {
        action: "CATEGORY_CREATE",
        entity_type: "category",
        entity_id: newId,
        details: { name: catName, via: "CSV_IMPORT" },
      });

      catCache.set(key, newId);
      return newId;
    }

    // Process each row
    for (let line = 1; line < rows.length; line++) {
      const r = rows[line];

      const name = String(r[iName] ?? "").trim();
      const sku = String(r[iSku] ?? "").trim();

      if (!name || !sku) {
        skipped++;
        errors.push({ line: line + 1, message: "Missing name or sku" });
        continue;
      }

      const categoryName = iCategory !== -1 ? String(r[iCategory] ?? "").trim() : "";
      const category_id = categoryName ? await getOrCreateCategoryId(categoryName) : null;

      const quantity = iQuantity !== -1 ? Number(r[iQuantity]) || 0 : 0;
      const cost_price = iCost !== -1 ? Number(r[iCost]) || 0 : 0;
      const selling_price = iSell !== -1 ? Number(r[iSell]) || 0 : 0;
      const reorder_level = iReorder !== -1 ? Number(r[iReorder]) || 0 : 10;

      // Upsert by SKU
      // (Assumes you either have UNIQUE index on sku OR you want to treat sku as unique logically)
      // If sku isn't unique in DB yet, you should add UNIQUE(sku) for best results.
      const [result] = await db.query(
        `
        INSERT INTO products
          (name, sku, category_id, quantity, cost_price, selling_price, reorder_level)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name=VALUES(name),
          category_id=VALUES(category_id),
          quantity=VALUES(quantity),
          cost_price=VALUES(cost_price),
          selling_price=VALUES(selling_price),
          reorder_level=VALUES(reorder_level)
        `,
        [name, sku, category_id, quantity, cost_price, selling_price, reorder_level]
      );

      // MySQL affectedRows behavior:
      // 1 = insert, 2 = update, 0 = no-op
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows === 2) updated++;
      else skipped++;
    }

    await logAudit(req, {
      action: "PRODUCTS_CSV_IMPORT",
      entity_type: "product",
      entity_id: null,
      details: { inserted, updated, skipped, errorsCount: errors.length },
    });

    res.json({
      message: "CSV import completed",
      inserted,
      updated,
      skipped,
      errors,
    });
  } catch (err) {
    // Duplicate errors if sku isn't unique won't hit ON DUPLICATE KEY. If you see issues, add UNIQUE(sku).
    console.error("PRODUCTS CSV IMPORT ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ Batch import rows (admin only)
// Body: { rows: [{name, sku, category, quantity, cost_price, selling_price, reorder_level}], createMissingCategories?: true }
router.post("/import-rows", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const createMissingCategories = req.body?.createMissingCategories !== false;

    if (!rows.length) return res.status(400).json({ message: "rows is required" });

    // Cache category name -> id
    const catCache = new Map();

    async function getCategoryIdByName(catNameRaw) {
      const catName = String(catNameRaw || "").trim();
      if (!catName) return null;

      const key = catName.toLowerCase();
      if (catCache.has(key)) return catCache.get(key);

      const [[found]] = await db.query(
        "SELECT id FROM categories WHERE LOWER(name)=LOWER(?) LIMIT 1",
        [catName]
      );

      if (found?.id) {
        catCache.set(key, found.id);
        return found.id;
      }

      if (!createMissingCategories) {
        catCache.set(key, null);
        return null;
      }

      const [r] = await db.query("INSERT INTO categories (name) VALUES (?)", [catName]);
      const newId = r.insertId;

      await logAudit(req, {
        action: "CATEGORY_CREATE",
        entity_type: "category",
        entity_id: newId,
        details: { name: catName, via: "CSV_IMPORT" },
      });

      catCache.set(key, newId);
      return newId;
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = []; // { index, sku, message }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const name = String(r.name ?? "").trim();
      const sku = String(r.sku ?? "").trim();
      const category = String(r.category ?? "").trim();

      if (!name || !sku) {
        skipped++;
        errors.push({ index: i, sku, message: "Missing name or sku" });
        continue;
      }

      const category_id = category ? await getCategoryIdByName(category) : null;

      const quantity = Number(r.quantity) || 0;
      const cost_price = Number(r.cost_price) || 0;
      const selling_price = Number(r.selling_price) || 0;
      const reorder_level =
        r.reorder_level === undefined || r.reorder_level === null || r.reorder_level === ""
          ? 10
          : Number(r.reorder_level) || 0;

      try {
        const [result] = await db.query(
          `
          INSERT INTO products
            (name, sku, category_id, quantity, cost_price, selling_price, reorder_level)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            category_id=VALUES(category_id),
            quantity=VALUES(quantity),
            cost_price=VALUES(cost_price),
            selling_price=VALUES(selling_price),
            reorder_level=VALUES(reorder_level)
          `,
          [name, sku, category_id, quantity, cost_price, selling_price, reorder_level]
        );

        if (result.affectedRows === 1) inserted++;
        else if (result.affectedRows === 2) updated++;
        else skipped++;
      } catch (e) {
        skipped++;
        errors.push({ index: i, sku, message: e?.message || "DB error" });
      }
    }

    await logAudit(req, {
      action: "PRODUCTS_CSV_IMPORT",
      entity_type: "product",
      entity_id: null,
      details: { inserted, updated, skipped, batchSize: rows.length, errorsCount: errors.length },
    });

    res.json({ message: "Batch import completed", inserted, updated, skipped, errors });
  } catch (err) {
    console.error("PRODUCTS IMPORT-ROWS ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});


// ✅ admin only can create product
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const {
      name,
      sku,
      category_id = null,
      quantity = 0,
      cost_price = 0,
      selling_price = 0,
      reorder_level = 10,
    } = req.body;

    const cleanName = String(name || "").trim();
    const cleanSku = String(sku || "").trim();

    if (!cleanName) return res.status(400).json({ message: "Name is required" });
    if (!cleanSku) return res.status(400).json({ message: "SKU is required" });

    // ✅ prevent duplicate SKU
    const [[skuExists]] = await db.query("SELECT id FROM products WHERE sku=? LIMIT 1", [cleanSku]);
    if (skuExists) return res.status(409).json({ message: "SKU already exists" });

    const cid = category_id ? Number(category_id) : null;

    const [result] = await db.query(
      `INSERT INTO products
        (name, sku, category_id, quantity, cost_price, selling_price, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanName,
        cleanSku,
        cid,
        Number(quantity) || 0,
        Number(cost_price) || 0,
        Number(selling_price) || 0,
        Number(reorder_level) || 0,
      ]
    );

    await logAudit(req, {
      action: "PRODUCT_CREATE",
      entity_type: "product",
      entity_id: result.insertId,
      details: {
        name: cleanName,
        sku: cleanSku,
        category_id: cid,
        quantity: Number(quantity) || 0,
        cost_price: Number(cost_price) || 0,
        selling_price: Number(selling_price) || 0,
        reorder_level: Number(reorder_level) || 0,
      },
    });

    // return created row
    const [[created]] = await db.query(
      `SELECT p.id, p.name, p.sku, p.category_id, c.name AS category,
              p.quantity, p.cost_price, p.selling_price, p.reorder_level, p.created_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id=? LIMIT 1`,
      [result.insertId]
    );

    res.json({ message: "Product created", id: result.insertId, product: created });
  } catch (err) {
    console.error("PRODUCTS POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ admin only: edit product
router.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid product id" });

    // fetch current
    const [[current]] = await db.query("SELECT * FROM products WHERE id=? LIMIT 1", [id]);
    if (!current) return res.status(404).json({ message: "Product not found" });

    const name = req.body?.name != null ? String(req.body.name).trim() : current.name;
    const sku = req.body?.sku != null ? String(req.body.sku).trim() : current.sku;

    const category_id =
      req.body?.category_id !== undefined
        ? req.body.category_id === null || req.body.category_id === ""
          ? null
          : Number(req.body.category_id)
        : current.category_id;

    const cost_price =
      req.body?.cost_price !== undefined ? Number(req.body.cost_price) || 0 : current.cost_price;

    const selling_price =
      req.body?.selling_price !== undefined
        ? Number(req.body.selling_price) || 0
        : current.selling_price;

    const reorder_level =
      req.body?.reorder_level !== undefined
        ? Number(req.body.reorder_level) || 0
        : current.reorder_level;

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!sku) return res.status(400).json({ message: "SKU is required" });

    // ✅ prevent duplicate SKU (but allow if it's the same product)
    if (sku !== current.sku) {
      const [[skuExists]] = await db.query(
        "SELECT id FROM products WHERE sku=? AND id<>? LIMIT 1",
        [sku, id]
      );
      if (skuExists) return res.status(409).json({ message: "SKU already exists" });
    }

    await db.query(
      `UPDATE products
       SET name=?, sku=?, category_id=?, cost_price=?, selling_price=?, reorder_level=?
       WHERE id=?`,
      [name, sku, category_id, cost_price, selling_price, reorder_level, id]
    );

    await logAudit(req, {
      action: "PRODUCT_UPDATE",
      entity_type: "product",
      entity_id: id,
      details: {
        old: {
          name: current.name,
          sku: current.sku,
          category_id: current.category_id,
          cost_price: current.cost_price,
          selling_price: current.selling_price,
          reorder_level: current.reorder_level,
        },
        new: { name, sku, category_id, cost_price, selling_price, reorder_level },
      },
    });

    const [[updated]] = await db.query(
      `SELECT p.id, p.name, p.sku, p.category_id, c.name AS category,
              p.quantity, p.cost_price, p.selling_price, p.reorder_level, p.created_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id=? LIMIT 1`,
      [id]
    );

    res.json({ message: "Product updated", product: updated });
  } catch (err) {
    console.error("PRODUCT PATCH ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ admin only: delete product
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid product id" });

    const [[current]] = await db.query(
      "SELECT id, name, sku, category_id FROM products WHERE id=? LIMIT 1",
      [id]
    );
    if (!current) return res.status(404).json({ message: "Product not found" });

    await db.query("DELETE FROM products WHERE id=?", [id]);

    await logAudit(req, {
      action: "PRODUCT_DELETE",
      entity_type: "product",
      entity_id: id,
      details: { deleted: current },
    });

    res.json({ message: "Product deleted", deleted: current });
  } catch (err) {
    console.error("PRODUCT DELETE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
