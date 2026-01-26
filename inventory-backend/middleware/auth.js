// middleware/auth.js
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

// Optional: role ranks for comparisons if you ever want "at least admin"
const ROLE_RANK = { staff: 1, admin: 2, owner: 3 };

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // Normalize for safety
    req.user = {
      id: payload.id ?? payload.userId ?? null,
      email: payload.email ?? null,
      role: payload.role ?? null, // should be tenant role once selected
      tenantId: payload.tenantId ?? null,
    };

    if (!req.user.id) {
      return res.status(401).json({ message: "Invalid token" });
    }

    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/**
 * Require a selected tenant (tenant-scoped token)
 */
export function requireTenant(req, res, next) {
  const tenantId = req.user?.tenantId;

  // Treat 0/NaN as missing
  const n = Number(tenantId);
  if (!tenantId || !Number.isFinite(n) || n <= 0) {
    return res.status(400).json({ message: "No tenant selected" });
  }

  req.tenantId = n;
  return next();
}

/**
 * Require one of the allowed tenant roles.
 * IMPORTANT:
 * - This should only be used on tenant-scoped routes.
 * - It also implicitly requires tenant selection to prevent using a user-token to pass role checks.
 */
export function requireRole(...allowed) {
  const allowedSet = new Set(allowed);

  return (req, res, next) => {
    const tenantId = req.user?.tenantId;
    const role = String(req.user?.role || "").toLowerCase();

    // Must be tenant-scoped token
    const n = Number(tenantId);
    if (!tenantId || !Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ message: "No tenant selected" });
    }

    if (!role || !allowedSet.has(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return next();
  };
}

/**
 * Optional helper if later you want "at least admin" logic:
 * requireMinRole("admin") -> allows admin + owner
 */
export function requireMinRole(minRole) {
  const min = ROLE_RANK[String(minRole || "").toLowerCase()] || 999;

  return (req, res, next) => {
    const tenantId = req.user?.tenantId;
    const role = String(req.user?.role || "").toLowerCase();

    const n = Number(tenantId);
    if (!tenantId || !Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ message: "No tenant selected" });
    }

    const rank = ROLE_RANK[role] || 0;
    if (rank < min) return res.status(403).json({ message: "Forbidden" });

    return next();
  };
}
