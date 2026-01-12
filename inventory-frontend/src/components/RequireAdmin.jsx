import { Navigate } from "react-router-dom";
import { getStoredUser } from "../services/api";

export default function RequireAdmin({ children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
