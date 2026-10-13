import { useEffect, useState } from "react";
import { api } from "../../api";
import DoerSelect from "../../components/DoerSelect";

const blank = { name: "", description: "", solver: "", department: "", tatHours: 8, priority: "normal", active: true };
const idOf = (v) => (v && typeof v === "object" ? v._id : v || "");

// Help Ticket categories (who solves, in how long) and the settings (MIS score, auto-close)
export default function TicketCategories() {
  const [list, setList] = useState(null);
  const [depts, setDepts] = useState([]);
  const [edit, setEdit] = useState(null);
  const [settings, setSettings] = useState(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const set = (p) => setEdit((v) => ({ ...v, ...p }));
  const load = () =>
    api("/tickets/categories", { query: { all: 1 } })
      .then(setList)
      .catch((e) => setMsg({ error: e.message }));
  useEffect(() => {
    load();
    api("/org/departments").then(setDepts).catch(() => {});
    api("/tickets/settings").then(setSettings).catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    try {
      await api(edit._id ? `/tickets/categories/${edit._id}` : "/tickets/categories", { method: edit._id ? "PUT" : "POST", body: edit });
      setMsg({ ok: `${edit.name} saved.` });
      setEdit(null);
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }
  async function remove(c) {
    if (!window.confirm(`Delete the category "${c.name}"?`)) return;
    try {
      await api(`/tickets/categories/${c._id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }
  async function saveSettings() {
    setMsg(null);
    try {
      setSettings(await api("/tickets/settings", { method: "PUT", body: settings }));
      setMsg({ ok: "Ticket settings saved." });
    } catch (e) {
      setMsg({ error: e.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Ticket Categories</h2>
          <div className="muted small">A new ticket goes to the category's solver; with no solver, to the department's HOD; else it waits in "Not assigned".</div>
        </div>
        {!edit && (
          <button className="btn primary" onClick={() => setEdit({ ...blank })}>
            + Category
          </button>
        )}
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      {edit && (
        <form className="card form-grid" onSubmit={save}>
          <h3 className="span-all">{edit._id ? `Edit ${edit.name}` : "New category"}</h3>
          <label>
            Name
            <input value={edit.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Maintenance" required autoFocus maxLength={60} />
          </label>
          <label className="span-2">
            Description <small className="muted">(helps people pick the right one)</small>
            <input value={edit.description} onChange={(e) => set({ description: e.target.value })} maxLength={200} />
          </label>
          <label>
            Solve within (working hours)
            <input type="number" min={0.25} step={0.25} max={1440} value={edit.tatHours} onChange={(e) => set({ tatHours: e.target.value })} required />
          </label>
          <label>
            Solver
            <DoerSelect value={idOf(edit.solver)} onChange={(solver) => set({ solver })} placeholder="— (the department's HOD)" />
          </label>
          <label>
            Department
            <select value={idOf(edit.department)} onChange={(e) => set({ department: e.target.value })}>
              <option value="">—</option>
              {depts.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Default priority
            <select value={edit.priority} onChange={(e) => set({ priority: e.target.value })}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
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
                <th>Category</th>
                <th>Solver</th>
                <th>Department</th>
                <th>Solve within</th>
                <th>Priority</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(list || []).map((c) => (
                <tr key={c._id}>
                  <td>
                    <b>{c.name}</b>
                    {c.description && <div className="muted small">{c.description}</div>}
                  </td>
                  <td>{c.solver?.name || <span className="muted">—</span>}</td>
                  <td>{c.department?.name || <span className="muted">—</span>}</td>
                  <td>{c.tatHours} h</td>
                  <td className="small">{c.priority}</td>
                  <td>
                    <span className={"tag " + (c.active ? "green" : "gray")}>{c.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="nowrap">
                    <button className="btn ghost small" onClick={() => setEdit({ ...blank, ...c, solver: idOf(c.solver), department: idOf(c.department) })}>
                      Edit
                    </button>
                    <button className="btn ghost small danger" onClick={() => remove(c)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {settings && (
        <div className="card form-grid">
          <h3 className="span-all">Settings</h3>
          <label className="check span-2">
            <input type="checkbox" checked={settings.countInMis} onChange={(e) => setSettings({ ...settings, countInMis: e.target.checked })} /> Count tickets in the solver's MIS score ("Help Tickets" row; late = solved after the solve-by time)
          </label>
          <label>
            Close a solved ticket if not confirmed in (days)
            <input type="number" min={1} max={30} value={settings.autoCloseDays} onChange={(e) => setSettings({ ...settings, autoCloseDays: e.target.value })} />
          </label>
          <div className="span-all">
            <button className="btn primary" onClick={saveSettings}>
              Save settings
            </button>
          </div>
        </div>
      )}
    </>
  );
}
