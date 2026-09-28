import { useEffect, useState } from "react";
import { api } from "../api";

// Indian number ko wa.me format me: 98xxxxxxxx -> 9198xxxxxxxx
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
          {busy ? "Bhej rahe hain…" : "Sabko Email abhi bhejein"}
        </button>
      </div>
      <p className="muted">
        Roz subah (backend/.env ka REMINDER_TIME) har doer ko uske overdue + aaj ke tasks ka email apne aap jata hai. WhatsApp button se message seedha WhatsApp
        me khulta hai – bas Send dabana hai.
      </p>
      {error && <div className="error">{error}</div>}
      {result && (
        <div className={result.error ? "error" : "notice"}>
          {result.error || `${result.sent} email gaye, ${result.skipped} doers ka email nahi hai.`}
          {result.failed?.length > 0 && <div>Fail: {result.failed.join("; ")}</div>}
        </div>
      )}
      {!list && !error && <p className="muted">Loading…</p>}
      {list && !list.length && <div className="card empty">Kisi ka koi task due nahi hai 🎉</div>}
      <div className="cards">
        {(list || []).map((e) => (
          <div key={e.doer._id} className="card">
            <div className="row between">
              <h3>{e.doer.name}</h3>
              <span>
                {e.overdue > 0 && <span className="tag red">{e.overdue} overdue</span>} {e.dueToday > 0 && <span className="tag">{e.dueToday} aaj</span>}
              </span>
            </div>
            <pre className="msg">{e.message}</pre>
            <div className="row">
              {e.doer.phone ? (
                <a className="btn primary small" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(e.doer.phone)}?text=${encodeURIComponent(e.message)}`}>
                  WhatsApp
                </a>
              ) : (
                <span className="muted small">Phone number nahi hai (Users me daalein)</span>
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
