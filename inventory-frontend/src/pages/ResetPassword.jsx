import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { resetPassword } from "../services/api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const email = params.get("email"); // ✅ required by backend

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setMsg("");

    if (!password || password.length < 8) {
      return setErr("Password must be at least 8 characters");
    }
    if (password !== confirm) {
      return setErr("Passwords do not match");
    }

    setLoading(true);
    try {
      // ✅ matches backend: { email, token, newPassword }
      await resetPassword(email, token, password);

      setMsg("Password updated successfully. You may now log in.");
      setPassword("");
      setConfirm("");
    } catch (e2) {
      setErr(e2?.message || "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  if (!token || !email) {
    return (
      <div style={{ maxWidth: 420 }}>
        <h1>Invalid link</h1>
        <p>Password reset token or email is missing/invalid.</p>
        <a href="/login">Back to login</a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h1>Reset password</h1>

      <p style={{ opacity: 0.8, marginTop: 0 }}>
        Resetting password for <b>{email}</b>
      </p>

      <form onSubmit={handleSubmit}>
        <input
          className="input"
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />

        <input
          className="input"
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          style={{ marginTop: 10 }}
          required
        />

        <button
          className="btn"
          style={{ marginTop: 10, width: "100%" }}
          disabled={loading}
        >
          {loading ? "Updating..." : "Reset password"}
        </button>
      </form>

      {msg && <p style={{ color: "green" }}>{msg}</p>}
      {err && <p style={{ color: "red" }}>{err}</p>}

      <p style={{ marginTop: 10 }}>
        <a href="/login">Back to login</a>
      </p>
    </div>
  );
}
