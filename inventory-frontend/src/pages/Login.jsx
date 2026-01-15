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
      // ✅ Sends credentials (refresh_token cookie) via services/api.js
      const data = await login(email, password); // { token, user }

      // ✅ Store access token + user
      setToken(data.token);
      setStoredUser(data.user);

      // ✅ Lift user state to App.jsx
      onSuccess?.(data.user);

      // ✅ Enter protected app
      navigate("/", { replace: true });
    } catch (e2) {
      setErr(e2?.message || "Invalid email or password");
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
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={{ marginTop: 10 }}
          required
        />

        <button
          className="btn"
          style={{ marginTop: 10, width: "100%" }}
          disabled={loading}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {err && (
        <p style={{ color: "red", marginTop: 10 }}>
          {err}
        </p>
      )}

      <p style={{ marginTop: 10 }}>
        <a href="/forgot-password">Forgot password?</a>
      </p>
    </div>
  );
}
