// middleware/billing.js
export function requireBillingAdmin(req, res, next) {
  const role = String(req?.user?.role || "").toLowerCase();
  // In your tenant-token, role becomes tenantRole already (owner/admin/staff)
  const ok = role === "owner" || role === "admin";
  if (!ok) return res.status(403).json({ message: "Owner/Admin only" });
  next();
}
