// src/components/RequireOwner.jsx
import { Navigate } from "react-router-dom";

export default function RequireOwner({ user, children }) {
  const role = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isOwner = role === "owner";

  if (!user) return <Navigate to="/login" replace />;
  if (!isOwner) return <Navigate to="/unauthorized" replace />;

  return children;
}
