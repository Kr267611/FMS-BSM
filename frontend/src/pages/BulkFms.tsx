import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../App";

// MIDAP "Bulk Delete/Download": choose FMS, status and entry date range; download as Excel or delete
export default function BulkFms() {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [processes, setProcesses] = useState([]);
  const [f, setF] = useState({ process: "", status: "", from: "", to: "" });
  const [count, setCount] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = (patch) => (setF((prev) => ({ ...prev, ...patch })), setConfirm(""), setMsg(""));

  useEffect(() => {
    api("/processes", { query: { all: 1, summary: 1 } })
      .then((list) => {
        setProcesses(list);
        if (list[0]) setF((prev) => ({ ...prev, process: prev.process || list[0]._id }));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!f.process) return;
    setCount(null);
    api("/jobs/count", { query: f })
      .then((r) => setCount(r.count))
      .catch((e) => setError(e.message));
  }, [f]);

  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const proc = processes.find((p) => p._id === f.process);

  async function remove() {
    setError("");
    try {
      const r = await api("/jobs/bulk-delete", { method: "POST", body: { ...f, confirm } });
      setMsg(`${r.entries} entries and ${r.steps} steps deleted.`);
      setConfirm("");
      setF({ ...f });
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Bulk Delete / Download</h2>
          <div className="muted small">Choose the FMS, entry status and entry date range. Download the entries as Excel, or delete them in one go (admin only).</div>
        </div>
      </div>
      <div className="card form-grid">
        <label className="span-2">
          FMS
          <select value={f.process} onChange={(e) => set({ process: e.target.value })}>
            {processes.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
                {p.active ? "" : " (draft)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All entries</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <div />
        <label>
          Entry date from
          <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          to
          <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
      </div>

      {error && <div className="error">{error}</div>}
      {msg && <div className="notice">{msg}</div>}
      {proc && (
        <div className="card stack">
          <div className="row wrap between">
            <b>{count === null ? "Counting…" : `${count} entr${count === 1 ? "y" : "ies"} of ${proc.name} match`}</b>
            <a className={"btn primary" + (count ? "" : " disabled-link")} href={count ? `/api/jobs/export?${qs}` : undefined}>
              Download Excel (CSV)
            </a>
          </div>
          {count > 5000 && <p className="muted small">The download holds the latest 5,000 entries. Narrow the dates to get the rest.</p>}
          {isAdmin && count > 0 && (
            <div className="danger-zone">
              <b>Delete these {count} entries</b>
              <p className="small muted">Every step of these entries is deleted too, and they leave the MIS. This cannot be undone – download them first.</p>
              <div className="row wrap">
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type DELETE to confirm" />
                <button className="btn ghost danger" disabled={confirm !== "DELETE"} onClick={remove}>
                  Delete {count} entries
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
