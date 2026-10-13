import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import PhotoInput from "../../components/PhotoInput";

const blank = { category: "", title: "", description: "", location: "", priority: "", photos: [] };

// MIDAP "Raise Help Ticket": the problem goes to the category's solver with a solve-by time
export default function RaiseTicket() {
  const [cats, setCats] = useState([]);
  const [v, setV] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");
  const set = (p) => setV((x) => ({ ...x, ...p }));
  useEffect(() => {
    api("/tickets/categories").then(setCats).catch((e) => setError(e.message));
  }, []);
  const cat = cats.find((c) => c._id === v.category);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/tickets", { method: "POST", body: { ...v, priority: v.priority || undefined } });
      setDone(r);
      setV({ ...blank });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Raise Ticket</h2>
          <div className="muted small">Tell us the problem. It goes straight to the person who solves it, with a time to solve it by.</div>
        </div>
      </div>
      {done && (
        <div className="notice">
          Ticket <b>{done.code}</b> raised{done.solver ? "" : " – it will be assigned to someone soon"}. Follow it in <Link to="/tickets/mine">My Tickets</Link>.
        </div>
      )}
      <form className="card form-grid" onSubmit={send}>
        <label className="span-2">
          Category
          <select value={v.category} onChange={(e) => set({ category: e.target.value, priority: "" })} required>
            <option value="">Choose…</option>
            {cats.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
          {cat && (
            <small className="muted">
              {cat.description ? `${cat.description} · ` : ""}solved within {cat.tatHours} working hour(s){cat.solver ? ` by ${cat.solver.name}` : ""}
            </small>
          )}
        </label>
        <label>
          Priority
          <select value={v.priority || cat?.priority || "normal"} onChange={(e) => set({ priority: e.target.value })}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical – work has stopped</option>
          </select>
        </label>
        <label>
          Where <small className="muted">(machine / room / place)</small>
          <input value={v.location} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. JET-5, Accounts office" maxLength={100} />
        </label>
        <label className="span-all">
          Problem in a few words
          <input value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. JET-5 motor is overheating" required minLength={3} maxLength={150} />
        </label>
        <label className="span-all">
          Details <small className="muted">(optional)</small>
          <textarea rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder="Since when, what you already tried…" maxLength={2000} />
        </label>
        <label className="span-all">
          Photos <small className="muted">(optional, up to 5)</small>
          <PhotoInput value={v.photos} onChange={(photos) => set({ photos })} max={5} />
        </label>
        {error && <div className="error span-all">{error}</div>}
        <div className="span-all">
          <button className="btn primary" disabled={busy}>
            {busy ? "Sending…" : "Raise ticket"}
          </button>
        </div>
      </form>
    </>
  );
}
