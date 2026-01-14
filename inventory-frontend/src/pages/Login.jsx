import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, setToken, setStoredUser } from "../services/api";

export default function Login({ onSuccess }) {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);

    try {
      const data = await login(email, password); // { token, user }

      setToken(data.token);
      setStoredUser(data.user);

      onSuccess?.(data.user);

      // ✅ redirect into your protected app
      navigate("/", { replace: true });
    } catch (e2) {
      setErr(e2?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>

      <form onSubmit={handleSubmit}>
        <input
          className="input"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="input"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ marginTop: 10 }}
        />

        <button
          className="btn"
          style={{ marginTop: 10, width: "100%" }}
          disabled={loading}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {err && <p style={{ color: "red" }}>{err}</p>}
      <p style={{ marginTop: 10 }}>
        <a href="/forgot-password">Forgot password?</a>
      </p>
    </div>
  );
}
