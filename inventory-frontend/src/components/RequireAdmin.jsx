// src/components/RequireAdmin.jsx
import React, { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";

export default function RequireAdmin({ user, children }) {
  const location = useLocation();

  const role = useMemo(() => {
    return String(user?.tenantRole || user?.role || "").toLowerCase();
  }, [user]);

  const isAdmin = role === "admin" || role === "owner";

  if (!isAdmin) {
    return (
      <Navigate
        to="/unauthorized"
        replace
        state={{ from: location.pathname + (location.search || "") }}
      />
    );
  }

  return children;
}
