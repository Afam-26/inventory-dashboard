import { Outlet } from "react-router-dom";

export default function PublicLayout() {
  return <Outlet />; // Landing handles its own top nav
}
