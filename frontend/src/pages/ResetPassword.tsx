import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match");
    setBusy(true);
    setError("");
    try {
      const r = await api("/auth/reset-password", { method: "POST", body: { token, password } });
      setDone(r.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <h1>FMS BSM</h1>
        <p className="muted">Choose a new password</p>
        {done ? (
          <div className="notice">{done}</div>
        ) : !token ? (
          <div className="error">This reset link is incomplete. Open the link from your email again.</div>
        ) : (
          <>
            <label>
              New password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" minLength={4} required />
            </label>
            <label>
              Confirm new password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={4} required />
            </label>
            <p className="muted small">At least 4 characters.</p>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Reset password"}
            </button>
          </>
        )}
        <Link to={done ? "/login" : "/forgot-password"} className="small center">
          {done ? "Go to sign in" : "Request a new link"}
        </Link>
      </form>
    </div>
  );
}
