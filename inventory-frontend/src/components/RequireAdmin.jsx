import { Navigate, useLocation } from "react-router-dom";

export default function RequireAdmin({ user, children }) {
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;

  if (user.role !== "admin") {
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
