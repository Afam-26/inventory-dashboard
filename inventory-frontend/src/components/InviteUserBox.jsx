import { useState } from "react";
import { createUser } from "../services/api";

export default function InviteUserBox({ onDone }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [msg, setMsg] = useState("");

  async function submit() {
    setMsg("");
    await createUser({ email, role });
    setEmail("");
    setMsg("User added");
    onDone?.();
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        placeholder="email@company.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        style={{ padding: 8 }}
      />
      <select value={role} onChange={e => setRole(e.target.value)}>
        <option value="staff">staff</option>
        <option value="admin">admin</option>
        <option value="owner">owner</option>
      </select>
      <button onClick={submit} disabled={!email}>
        Invite
      </button>
      {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
    </div>
  );
}
