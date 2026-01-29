import TenantSwitcher from "./TenantSwitcher";

export default function Topbar() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 12,
        borderBottom: "1px solid #e5e7eb",
        background: "#fff",
      }}
    >
      <div style={{ fontWeight: 800 }}>Inventory</div>
      <TenantSwitcher />
    </div>
  );
}
