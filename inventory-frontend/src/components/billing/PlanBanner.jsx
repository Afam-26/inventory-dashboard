// inventory-frontend/src/components/billing/PlanBanner.jsx
import { Link } from "react-router-dom";

export default function PlanBanner({ banner }) {
  if (!banner) return null;

  const tone = banner.tone || "warn";
  const styles = {
    warn: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e" },
    danger: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
    info: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e3a8a" },
    ok: { bg: "#ecfdf5", border: "#bbf7d0", text: "#065f46" },
  }[tone];

  return (
    <div
      style={{
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        borderRadius: 12,
        padding: 12,
        color: styles.text,
        marginBottom: 12,
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 4 }}>{banner.title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.4 }}>{banner.message}</div>

      {banner.ctaHref && banner.ctaLabel ? (
        <div style={{ marginTop: 10 }}>
          <Link className="btn" to={banner.ctaHref} style={{ textDecoration: "none" }}>
            {banner.ctaLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
