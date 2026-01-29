// middleware/auth.js
import jwt from "jsonwebtoken";
import { db } from "../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

// Optional: role ranks if you use requireMinRole
const ROLE_RANK = { staff: 1, admin: 2, owner: 3 };

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    req.user = {
      id: payload.id ?? payload.userId ?? null,
      email: payload.email ?? null,
      role: payload.role ?? null, // tenant role IF tenant-token, otherwise global
      tenantId: payload.tenantId ?? null, // tenant-token includes this
    };

    if (!req.user.id) return res.status(401).json({ message: "Invalid token" });

    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/**
 * ✅ Require a selected tenant.
 * - If token has tenantId: use it (tenant-token flow)
 * - Else if x-tenant-id present: verify membership & set role from tenant_members
 */
export async function requireTenant(req, res, next) {
  const headerTenant = req.headers["x-tenant-id"];
  const tokenTenant = req.user?.tenantId;

  const tenantId = Number(tokenTenant || headerTenant);

  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return res.status(400).json({ message: "No tenant selected" });
  }

  // If token already has tenantId, trust it (it came from select-tenant mint)
  if (Number(tokenTenant) === tenantId && Number(tokenTenant) > 0) {
    req.tenantId = tenantId;
    req.user.tenantId = tenantId;
    return next();
  }

  // Otherwise: header-based tenant selection -> MUST verify membership
  try {
    const [[m]] = await db.query(
      `SELECT role, status
       FROM tenant_members
       WHERE tenant_id=? AND user_id=?
       LIMIT 1`,
      [tenantId, req.user.id]
    );

    if (!m) return res.status(403).json({ message: "Not a member of this tenant" });
    if (String(m.status || "active") !== "active") {
      return res.status(403).json({ message: "Tenant membership is not active" });
    }

    // ✅ lock request to tenant + set tenant role for requireRole()
    req.tenantId = tenantId;
    req.user.tenantId = tenantId;
    req.user.role = String(m.role || "").toLowerCase();

    return next();
  } catch (e) {
    console.error("REQUIRE TENANT ERROR:", e?.message || e);
    return res.status(500).json({ message: "Database error" });
  }
}

/**
 * Require one of the allowed roles (tenant role).
 * Use AFTER requireTenant.
 */
export function requireRole(...allowed) {
  const allowedSet = new Set(allowed.map((x) => String(x).toLowerCase()));

  return (req, res, next) => {
    if (!req.tenantId) return res.status(400).json({ message: "No tenant selected" });

    const role = String(req.user?.role || "").toLowerCase();
    if (!role || !allowedSet.has(role)) return res.status(403).json({ message: "Forbidden" });

    return next();
  };
}

export function requireMinRole(minRole) {
  const min = ROLE_RANK[String(minRole || "").toLowerCase()] || 999;

  return (req, res, next) => {
    if (!req.tenantId) return res.status(400).json({ message: "No tenant selected" });

    const role = String(req.user?.role || "").toLowerCase();
    const rank = ROLE_RANK[role] || 0;

    if (rank < min) return res.status(403).json({ message: "Forbidden" });
    return next();
  };
}
