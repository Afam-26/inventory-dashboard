// src/components/RequireAdmin.jsx
import { Navigate, useLocation } from "react-router-dom";

export default function RequireAdmin({ user, children }) {
  const location = useLocation();

  // Not logged in
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  /**
   * IMPORTANT:
   * - Use tenantRole (owner/admin) instead of global user.role
   * - tenantRole comes from /auth/select-tenant
   */
  const role = String(user.tenantRole || "").toLowerCase();

  const isAdmin = role === "owner" || role === "admin";

  if (!isAdmin) {
    return (
      <Navigate
        to="/unauthorized"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  return children;
}
