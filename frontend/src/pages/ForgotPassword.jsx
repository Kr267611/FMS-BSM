import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/auth/forgot-password", { method: "POST", body: { email } });
      setSent(r.message);
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
        <p className="muted">Reset your password</p>
        {sent ? (
          <div className="notice">{sent} Check your inbox and spam folder.</div>
        ) : (
          <>
            <label>
              Work email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="email" required />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}
        <Link to="/login" className="small center">
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
