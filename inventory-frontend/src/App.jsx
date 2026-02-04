// src/App.jsx
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { consumePageExit } from "./utils/pageTransition";

import RequireAdmin from "./components/RequireAdmin";

import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Unauthorized from "./pages/Unauthorized";

import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Categories from "./pages/Categories";
import Stock from "./pages/Stock";
import AuditLogs from "./pages/AuditLogs";
import UsersAdmin from "./pages/UsersAdmin";
import AuditDashboard from "./pages/AuditDashboard";
import SelectTenant from "./pages/SelectTenant";
import Signup from "./pages/Signup";
import Billing from "./pages/Billing";
import Landing from "./pages/Landing";

import AppLayout from "./layouts/AppLayout";

import { getStoredUser, getTenantId } from "./services/api";
import { savePostLoginRedirect, peekPostLoginRedirect } from "./utils/authRedirect";

/**
 * ✅ Public landing + private app layout split
 * ✅ Landing is INDEX route (so it never matches /login)
 * ✅ FIX: Use effectiveUser from storage to avoid role flash after tenant select
 * ✅ FIX: No side-effects during render
 * ✅ FIX: Always clear page-exit on navigation (prevents white screen)
 */
export default function App() {
  const [user, setUser] = useState(() => getStoredUser());

  const effectiveUser = user || getStoredUser();

  const token = localStorage.getItem("token") || "";
  const isAuthed = Boolean(token) && Boolean(effectiveUser);

  const tenantId = getTenantId();
  const hasTenant = Boolean(tenantId);

  useEffect(() => {
    if (!user && effectiveUser) setUser(effectiveUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tenantId]);

  return (
    <>
      {/* ✅ runs on every route change */}
      <RouteEffects />

      <Routes>
        {/* =========================
            PUBLIC AREA
          ========================= */}
        <Route element={<PublicLayout />}>
          <Route index element={<Landing />} />

          <Route
            path="login"
            element={
              !isAuthed ? (
                <Login onSuccess={(u) => setUser(u)} />
              ) : !hasTenant ? (
                <Navigate to="/select-tenant" replace />
              ) : (
                <Navigate to={peekPostLoginRedirect("/dashboard")} replace />
              )
            }
          />

          <Route path="signup" element={<Signup />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />

          <Route
            path="select-tenant"
            element={
              !isAuthed ? (
                <Navigate to="/login" replace />
              ) : (
                <SelectTenant onSuccess={(u) => setUser(u)} />
              )
            }
          />
        </Route>

        {/* =========================
            PRIVATE APP AREA
          ========================= */}
        <Route element={<RequireAuth isAuthed={isAuthed} hasTenant={hasTenant} />}>
          <Route element={<AppLayout user={effectiveUser} setUser={setUser} />}>
            <Route path="/dashboard" element={<Dashboard user={effectiveUser} />} />
            <Route path="/products" element={<Products user={effectiveUser} />} />
            <Route path="/audit" element={<AuditLogs user={effectiveUser} />} />

            <Route
              path="/categories"
              element={
                <RequireAdmin user={effectiveUser}>
                  <Categories user={effectiveUser} />
                </RequireAdmin>
              }
            />

            <Route
              path="/audit-dashboard"
              element={
                <RequireAdmin user={effectiveUser}>
                  <AuditDashboard user={effectiveUser} />
                </RequireAdmin>
              }
            />

            <Route
              path="/stock"
              element={
                <RequireAdmin user={effectiveUser}>
                  <Stock user={effectiveUser} />
                </RequireAdmin>
              }
            />

            <Route
              path="/users"
              element={
                <RequireAdmin user={effectiveUser}>
                  <UsersAdmin user={effectiveUser} />
                </RequireAdmin>
              }
            />

            <Route
              path="/billing"
              element={
                <RequireAdmin user={effectiveUser}>
                  <Billing user={effectiveUser} />
                </RequireAdmin>
              }
            />

            <Route path="/unauthorized" element={<Unauthorized />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

/** Public layout wrapper */
function PublicLayout() {
  return <Outlet />;
}

/**
 * ✅ Clears any stuck transition styles on every navigation.
 * This prevents "white screen until refresh".
 */
function RouteEffects() {
  const location = useLocation();

  useEffect(() => {
    consumePageExit();
  }, [location.pathname, location.search]);

  return null;
}

/**
 * ✅ Auth guard component
 * ✅ IMPORTANT: save redirect only in useEffect (no render side-effects)
 */
function RequireAuth({ isAuthed, hasTenant }) {
  const location = useLocation();

  const currentPath = useMemo(() => {
    return location.pathname + (location.search || "");
  }, [location.pathname, location.search]);

  useEffect(() => {
    const isPublic =
      currentPath === "/" ||
      currentPath.startsWith("/login") ||
      currentPath.startsWith("/signup") ||
      currentPath.startsWith("/forgot-password") ||
      currentPath.startsWith("/reset-password") ||
      currentPath.startsWith("/select-tenant");

    if (!isPublic) savePostLoginRedirect(currentPath);
  }, [currentPath]);

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: currentPath }} />;
  }

  if (!hasTenant) {
    return <Navigate to="/select-tenant" replace state={{ from: currentPath }} />;
  }

  return <Outlet />;
}
