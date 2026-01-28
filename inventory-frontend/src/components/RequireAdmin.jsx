import { Navigate, useLocation } from "react-router-dom";

export default function RequireAdmin({ user, children }) {
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;

  // ✅ Treat owner as admin
  const role = String(user.tenantRole || user.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "owner";

  if (!isAdmin) {
    return <Navigate to="/unauthorized" replace state={{ from: location.pathname }} />;
  }

  return children;
}
