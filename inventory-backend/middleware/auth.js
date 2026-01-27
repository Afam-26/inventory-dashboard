// middleware/auth.js
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

// Optional: role ranks if you use requireMinRole
const ROLE_RANK = { staff: 1, admin: 2, owner: 3 };

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // Normalize
    req.user = {
      id: payload.id ?? payload.userId ?? null,
      email: payload.email ?? null,
      role: payload.role ?? null, // NOTE: can be global user role OR tenant role after select-tenant
      tenantId: payload.tenantId ?? null,
    };

    if (!req.user.id) return res.status(401).json({ message: "Invalid token" });

    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/**
 * ✅ Require a selected tenant.
 * Accept tenant from:
 *  - x-tenant-id header (user-token flow)
 *  - token tenantId (tenant-token flow)
 */
export function requireTenant(req, res, next) {
  const headerTenant = req.headers["x-tenant-id"];
  const tokenTenant = req.user?.tenantId;

  const tenantId = Number(headerTenant || tokenTenant);

  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return res.status(400).json({ message: "No tenant selected" });
  }

  req.tenantId = tenantId;
  // keep normalized
  req.user.tenantId = tenantId;

  return next();
}

/**
 * Require one of the allowed roles.
 * IMPORTANT: use on tenant-scoped routes AFTER requireTenant.
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
