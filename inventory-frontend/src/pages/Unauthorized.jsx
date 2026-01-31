import { Link, useLocation, useNavigate } from "react-router-dom";

export default function Unauthorized() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "";

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.badge}>403</div>
        <h1 style={styles.title}>Access denied</h1>
        <p style={styles.text}>
          You don’t have permission to view this page.
          {from ? (
            <>
              <br />
              <span style={styles.muted}>Tried to access: </span>
              <code style={styles.code}>{from}</code>
            </>
          ) : null}
        </p>

        <div style={styles.actions}>
          <button className="btn" onClick={() => navigate(-1)} style={styles.btn}>
            Go back
          </button>
          <Link className="btn" to="/dashboard" style={{ ...styles.btn, textDecoration: "none" }}>
            Dashboard
          </Link>
        </div>

        <div style={styles.help}>
          If you think this is a mistake, contact an admin.
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "70vh",
    display: "grid",
    placeItems: "center",
    padding: 20,
  },
  card: {
    width: "min(560px, 100%)",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 22,
    background: "#fff",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    padding: "6px 12px",
    fontWeight: 700,
    border: "1px solid rgba(0,0,0,0.12)",
    marginBottom: 10,
  },
  title: { margin: "6px 0 6px", fontSize: 24 },
  text: { margin: 0, color: "rgba(0,0,0,0.7)", lineHeight: 1.5 },
  muted: { color: "rgba(0,0,0,0.6)" },
  code: {
    padding: "2px 6px",
    borderRadius: 8,
    background: "rgba(0,0,0,0.06)",
  },
  actions: { display: "flex", gap: 10, marginTop: 16 },
  btn: { padding: "10px 14px" },
  help: { marginTop: 14, fontSize: 13, color: "rgba(0,0,0,0.6)" },
};
