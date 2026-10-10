import { useEffect, useState } from "react";
import { api } from "../api";

const COLS = [
  ["checklist", "Checklist %"],
  ["delegation", "Delegation %"],
  ["fms", "FMS %"],
];
const show = (v) => (v === null || v === undefined ? "" : String(v));

// MIDAP "Auditor Settings": per auditor, the share of finished tasks to audit and the days they have for it
export default function AuditorSettings() {
  const [users, setUsers] = useState(null);
  const [rows, setRows] = useState({});
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api("/audits/settings")
      .then((r) => {
        setUsers(r.users);
        setRows(Object.fromEntries(Object.entries(r.settings).map(([id, v]) => [id, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, show(x)]))])));
      })
      .catch((e) => setMsg({ error: e.message }));
  }, []);

  const set = (id, key, value) => setRows((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value.replace(/[^\d]/g, "").slice(0, 3) } }));
  const configured = (u) => Object.values(rows[u._id] || {}).some((v) => v !== "");
  const shown = (users || []).filter((u) => all || u.role === "auditor" || configured(u));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("/audits/settings", { method: "PUT", body: { settings: rows } });
      setRows(Object.fromEntries(Object.entries(r.settings).map(([id, v]) => [id, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, show(x)]))])));
      setMsg({ ok: "Saved. New finished tasks follow these settings; tasks already in an Audit List stay there." });
    } catch (e) {
      setMsg({ error: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Auditor Settings</h2>
          <div className="muted small">How much of the finished work each auditor checks, and in how many days.</div>
        </div>
        <div className="row">
          <label className="check small">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all users
          </label>
          <button className="btn primary" onClick={save} disabled={busy || !users}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <p className="muted small">
        <b>%</b> = the share of finished tasks that go to this auditor's Audit List (blank = 100%, every task). The same task is always picked or
        always left out, so redoing it does not change the sample. <b>Audit TAT</b> = days the auditor has to audit a task after it is done (blank
        = no due date); late audits show in the Auditor Report. A task the auditor sent back is always audited again.
      </p>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}
      {!users && !msg?.error && <p className="muted">Loading…</p>}
      {users && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Auditor</th>
                  {COLS.map(([k, label]) => (
                    <th key={k}>{label}</th>
                  ))}
                  <th>Audit TAT (days)</th>
                </tr>
              </thead>
              <tbody>
                {!shown.length && (
                  <tr>
                    <td colSpan={5} className="muted center">
                      No user has the Auditor role yet. Tick “Show all users” to set anyone who audits.
                    </td>
                  </tr>
                )}
                {shown.map((u) => (
                  <tr key={u._id}>
                    <td>
                      <b>{u.name}</b>
                      <div className="muted small">
                        {u.role}
                        {u.department ? ` · ${u.department}` : ""}
                      </div>
                    </td>
                    {COLS.map(([k]) => (
                      <td key={k}>
                        <input className="num-input" inputMode="numeric" value={rows[u._id]?.[k] ?? ""} onChange={(e) => set(u._id, k, e.target.value)} placeholder="100" aria-label={`${u.name} ${k} %`} />
                      </td>
                    ))}
                    <td>
                      <input className="num-input" inputMode="numeric" value={rows[u._id]?.tat ?? ""} onChange={(e) => set(u._id, "tat", e.target.value)} placeholder="—" aria-label={`${u.name} audit TAT`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="muted small">
        Who audits what: a checklist or delegation has its own Auditor; an FMS has one Auditor for all its steps (Master FMS → Auditor).
      </p>
    </>
  );
}
