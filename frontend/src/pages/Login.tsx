import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../App";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/auth/login", { method: "POST", body: { username, password, remember } });
      login(r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      {/* Bhaskar = the sun: night sky, the sun rises to where it sits in the logo (behind the B), the logo opens out of it, then the day */}
      <div className="login-sky" aria-hidden="true">
        <div className="sky-dawn" />
        <svg className="sky-hills" viewBox="0 0 1440 220" preserveAspectRatio="none">
          <path d="M0 150 C 240 100 430 190 720 145 C 1010 100 1210 180 1440 130 L1440 220 L0 220 Z" />
        </svg>
      </div>
      <div className="login-logo" aria-hidden="true">
        <span className="logo-sun" />
        <div className="logo-plate">
          <img src="/bhaskar-logo.png" alt="" />
        </div>
      </div>
      <form className="card login" onSubmit={submit}>
        <h1>FMS BSM</h1>
        <p className="muted">Flow Management System — sign in to continue</p>
        <label>
          Email or username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" required />
        </label>
        <label>
          Password
          <span className="pw-field">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
              {show ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        <div className="row between small">
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me for 7 days
          </label>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
