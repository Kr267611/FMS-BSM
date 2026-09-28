import { useEffect, useState } from "react";
import { api } from "../api";

// Indian number in wa.me format: 98xxxxxxxx -> 9198xxxxxxxx
function waNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  return digits;
}

export default function Reminders() {
  const [list, setList] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/reminders").then(setList).catch((e) => setError(e.message));
  }, []);

  async function sendEmails() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api("/reminders/send-email", { method: "POST" }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>Reminders</h2>
        <button className="btn primary" onClick={sendEmails} disabled={busy || !list?.length}>
          {busy ? "Sending…" : "Email everyone now"}
        </button>
      </div>
      <p className="muted">
        Every morning (REMINDER_TIME in backend/.env) each doer is emailed their overdue and due-today tasks. The WhatsApp button opens the message
        in WhatsApp, ready to send.
      </p>
      {error && <div className="error">{error}</div>}
      {result && (
        <div className={result.error ? "error" : "notice"}>
          {result.error || `${result.sent} email(s) sent; ${result.skipped} doer(s) have no email address.`}
          {result.failed?.length > 0 && <div>Failed: {result.failed.join("; ")}</div>}
        </div>
      )}
      {!list && !error && <p className="muted">Loading…</p>}
      {list && !list.length && <div className="card empty">Nobody has tasks due. Everyone is on track.</div>}
      <div className="cards">
        {(list || []).map((e) => (
          <div key={e.doer._id} className="card">
            <div className="row between">
              <h3>{e.doer.name}</h3>
              <span>
                {e.overdue > 0 && <span className="tag red">{e.overdue} overdue</span>} {e.dueToday > 0 && <span className="tag">{e.dueToday} today</span>}
              </span>
            </div>
            <pre className="msg">{e.message}</pre>
            <div className="row">
              {e.doer.phone ? (
                <a className="btn primary small" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(e.doer.phone)}?text=${encodeURIComponent(e.message)}`}>
                  WhatsApp
                </a>
              ) : (
                <span className="muted small">No phone number (add it under Users)</span>
              )}
              <button className="btn ghost small" onClick={() => navigator.clipboard?.writeText(e.message)}>
                Copy
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
