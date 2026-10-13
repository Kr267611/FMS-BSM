import { useEffect, useState } from "react";
import { api } from "../../api";

const blank = { name: "", code: "", description: "", paid: true, gender: "all", carryForward: false, maxCarryForward: 0, encashable: false, requiresDocument: false, color: "#14877a", active: true };
const GENDER = { all: "Everyone", male: "Male only", female: "Female only", other: "Other only" };
const yes = (b) => (b ? "Yes" : "—");

// MIDAP "Leave Type Configure": Casual, Sick, Earned, Maternity, Unpaid…
export default function LeaveTypes() {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null); // the form values; _id when editing
  const [msg, setMsg] = useState(null);
  const set = (p) => setEdit((v) => ({ ...v, ...p }));

  const load = () =>
    api("/hr/types", { query: { all: 1 } })
      .then(setList)
      .catch((e) => setMsg({ error: e.message }));
  useEffect(() => {
    load();
  }, []);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    try {
      if (edit._id) await api(`/hr/types/${edit._id}`, { method: "PUT", body: edit });
      else await api("/hr/types", { method: "POST", body: edit });
      setMsg({ ok: `${edit.name} saved.` });
      setEdit(null);
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }
  async function remove(t) {
    if (!window.confirm(`Delete the leave type "${t.name}"?`)) return;
    setMsg(null);
    try {
      await api(`/hr/types/${t._id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Leave Types</h2>
          <div className="muted small">The kinds of leave people can ask for. How many days each person gets is set in the Leave Policy.</div>
        </div>
        {!edit && (
          <button className="btn primary" onClick={() => setEdit({ ...blank })}>
            + Leave type
          </button>
        )}
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      {edit && (
        <form className="card form-grid" onSubmit={save}>
          <h3 className="span-all">{edit._id ? `Edit ${edit.name}` : "New leave type"}</h3>
          <label className="span-2">
            Name
            <input value={edit.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Casual Leave" required maxLength={60} autoFocus />
          </label>
          <label>
            Short code
            <input value={edit.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="CL" maxLength={12} />
          </label>
          <label>
            Colour
            <input type="color" value={edit.color} onChange={(e) => set({ color: e.target.value })} />
          </label>
          <label className="span-all">
            Description
            <input value={edit.description} onChange={(e) => set({ description: e.target.value })} placeholder="When can it be used?" maxLength={300} />
          </label>
          <label>
            Who can take it
            <select value={edit.gender} onChange={(e) => set({ gender: e.target.value })}>
              {Object.entries(GENDER).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.paid} onChange={(e) => set({ paid: e.target.checked })} /> Paid leave
            <small className="muted"> (unpaid has no limit)</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.requiresDocument} onChange={(e) => set({ requiresDocument: e.target.checked })} /> Needs an attachment
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.encashable} onChange={(e) => set({ encashable: e.target.checked })} /> Can be encashed
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.carryForward} onChange={(e) => set({ carryForward: e.target.checked })} /> Carry forward to next year
          </label>
          {edit.carryForward && (
            <label>
              Most days carried <small className="muted">(0 = no limit)</small>
              <input type="number" min={0} max={366} value={edit.maxCarryForward} onChange={(e) => set({ maxCarryForward: e.target.value })} />
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={edit.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
          <div className="span-all row">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Leave type</th>
                <th>Code</th>
                <th>Paid</th>
                <th>Who</th>
                <th>Carry forward</th>
                <th>Encash</th>
                <th>Attachment</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list && !list.length && (
                <tr>
                  <td colSpan={9} className="muted center">
                    No leave types yet. Add Casual Leave, Sick Leave… to start.
                  </td>
                </tr>
              )}
              {(list || []).map((t) => (
                <tr key={t._id}>
                  <td>
                    <span className="dot" style={{ background: t.color }} /> <b>{t.name}</b>
                    {t.description && <div className="muted small">{t.description}</div>}
                  </td>
                  <td>{t.code || "—"}</td>
                  <td>{t.paid ? "Paid" : <span className="txt-warn">Unpaid</span>}</td>
                  <td className="small">{GENDER[t.gender]}</td>
                  <td>{t.carryForward ? (t.maxCarryForward ? `Up to ${t.maxCarryForward}` : "Yes") : "—"}</td>
                  <td>{yes(t.encashable)}</td>
                  <td>{t.requiresDocument ? "Needed" : "—"}</td>
                  <td>
                    <span className={"tag " + (t.active ? "green" : "gray")}>{t.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="nowrap">
                    <button className="btn ghost small" onClick={() => setEdit({ ...blank, ...t })}>
                      Edit
                    </button>
                    <button className="btn ghost small danger" onClick={() => remove(t)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
