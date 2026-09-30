import { useState } from "react";
import { ROLE_LABELS, api } from "../api";
import { useAuth } from "../App";

export default function Account() {
  const { user } = useAuth();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [msg, setMsg] = useState(null);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api("/auth/change-password", { method: "POST", body: { oldPassword, newPassword } });
      setMsg({ ok: true, text: r.message });
      setOld("");
      setNew("");
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>My Account</h2>
      </div>
      <div className="card narrow">
        <p>
          <b>{user.name}</b> ({user.email || user.username}) · {ROLE_LABELS[user.role] || user.role}{user.department ? ` · ${user.department}` : ""}
        </p>
        <form className="stack" onSubmit={save}>
          <label>
            Current password
            <input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required autoComplete="current-password" />
          </label>
          <label>
            New password
            <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} required minLength={4} autoComplete="new-password" />
          </label>
          {msg && <div className={msg.ok ? "notice" : "error"}>{msg.text}</div>}
          <button className="btn primary">Change password</button>
        </form>
      </div>
    </>
  );
}
