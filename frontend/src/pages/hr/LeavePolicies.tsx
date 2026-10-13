import { useEffect, useState } from "react";
import { api } from "../../api";

const ACCRUAL = { frontload: "Whole year on 1 January", monthly: "A twelfth every month" };
const EXHAUST = { lwp: "Extra days become unpaid leave (LWP)", reject: "Refuse the request", negative: "Allow a negative balance" };
const blank = { name: "", code: "", description: "", accrual: "frontload", creditDay: 1, capacity: 0, exhaust: "lwp", maxNegative: 0, rules: [], active: true };
const rule = (type) => ({ type, perYear: 12, minAtOnce: 0, maxAtOnce: 0, carryLimit: 0, encashLimit: 0 });

// MIDAP "Leave Policy": days per leave type, how they are credited and what happens when they run out
export default function LeavePolicies() {
  const [list, setList] = useState(null);
  const [types, setTypes] = useState([]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState(null);
  const set = (p) => setEdit((v) => ({ ...v, ...p }));
  const setRule = (i, p) => setEdit((v) => ({ ...v, rules: v.rules.map((r, j) => (j === i ? { ...r, ...p } : r)) }));

  const load = () =>
    api("/hr/policies")
      .then(setList)
      .catch((e) => setMsg({ error: e.message }));
  useEffect(() => {
    load();
    api("/hr/types", { query: { all: 1 } }).then(setTypes).catch(() => {});
  }, []);

  const typeName = (id) => types.find((t) => t._id === id)?.name || "?";
  const unused = edit ? types.filter((t) => t.paid && !edit.rules.some((r) => r.type === t._id)) : [];

  function open(p) {
    setMsg(null);
    setEdit(p ? { ...blank, ...p, rules: p.rules.map((r) => ({ ...r, type: r.type?._id || r.type })) } : { ...blank, rules: types.filter((t) => t.paid && t.active).map((t) => rule(t._id)) });
  }
  async function save(e) {
    e.preventDefault();
    setMsg(null);
    try {
      if (edit._id) await api(`/hr/policies/${edit._id}`, { method: "PUT", body: edit });
      else await api("/hr/policies", { method: "POST", body: edit });
      setMsg({ ok: `${edit.name} saved.` });
      setEdit(null);
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }
  async function act(p, what) {
    setMsg(null);
    try {
      if (what === "clone") await api(`/hr/policies/${p._id}/clone`, { method: "POST" });
      else {
        if (!window.confirm(`Delete the policy "${p.name}"?`)) return;
        await api(`/hr/policies/${p._id}`, { method: "DELETE" });
      }
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Leave Policies</h2>
          <div className="muted small">How many days of each leave type a person gets in a year. Give a policy to people in Policy Assignment.</div>
        </div>
        {!edit && (
          <button className="btn primary" onClick={() => open(null)} disabled={!types.length} title={types.length ? "" : "Add leave types first"}>
            + Leave policy
          </button>
        )}
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      {edit && (
        <form className="card form-grid" onSubmit={save}>
          <h3 className="span-all">{edit._id ? `Edit ${edit.name}` : "New leave policy"}</h3>
          <label className="span-2">
            Policy name
            <input value={edit.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Staff Policy 2026" required maxLength={80} autoFocus />
          </label>
          <label>
            Code
            <input value={edit.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="STAFF" maxLength={12} />
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
          <label className="span-2">
            How leave is credited
            <select value={edit.accrual} onChange={(e) => set({ accrual: e.target.value })}>
              {Object.entries(ACCRUAL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {edit.accrual === "monthly" && (
            <label>
              Credit on day
              <input type="number" min={1} max={28} value={edit.creditDay} onChange={(e) => set({ creditDay: e.target.value })} />
            </label>
          )}
          <label>
            Most a balance can hold <small className="muted">(0 = no cap)</small>
            <input type="number" min={0} max={1000} value={edit.capacity} onChange={(e) => set({ capacity: e.target.value })} />
          </label>
          <label className="span-2">
            When the balance runs out
            <select value={edit.exhaust} onChange={(e) => set({ exhaust: e.target.value })}>
              {Object.entries(EXHAUST).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {edit.exhaust === "negative" && (
            <label>
              Lowest balance <small className="muted">(days below 0)</small>
              <input type="number" min={0} max={60} value={edit.maxNegative} onChange={(e) => set({ maxNegative: e.target.value })} />
            </label>
          )}
          <label className="span-all">
            Description
            <input value={edit.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} placeholder="Who is this policy for?" />
          </label>

          <div className="span-all table-scroll">
            <table className="grid policy-rules">
              <thead>
                <tr>
                  <th>Leave type</th>
                  <th>Days per year</th>
                  <th>Per month</th>
                  <th>Min at once</th>
                  <th>Max at once</th>
                  <th>Carry forward limit</th>
                  <th>Encash limit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {edit.rules.map((r, i) => (
                  <tr key={r.type}>
                    <td>
                      <b>{typeName(r.type)}</b>
                    </td>
                    <td>
                      <input type="number" min={0} max={366} step={0.5} value={r.perYear} onChange={(e) => setRule(i, { perYear: e.target.value })} />
                    </td>
                    <td className="muted small">{(Number(r.perYear) / 12).toFixed(2)}</td>
                    <td>
                      <input type="number" min={0} max={366} step={0.5} value={r.minAtOnce} onChange={(e) => setRule(i, { minAtOnce: e.target.value })} />
                    </td>
                    <td>
                      <input type="number" min={0} max={366} step={0.5} value={r.maxAtOnce} onChange={(e) => setRule(i, { maxAtOnce: e.target.value })} />
                    </td>
                    <td>
                      <input type="number" min={0} max={366} value={r.carryLimit} onChange={(e) => setRule(i, { carryLimit: e.target.value })} disabled={!types.find((t) => t._id === r.type)?.carryForward} title="Turn on Carry forward in the leave type to use this" />
                    </td>
                    <td>
                      <input type="number" min={0} max={366} value={r.encashLimit} onChange={(e) => setRule(i, { encashLimit: e.target.value })} disabled={!types.find((t) => t._id === r.type)?.encashable} title="Turn on Can be encashed in the leave type to use this" />
                    </td>
                    <td>
                      <button type="button" className="btn ghost small danger" onClick={() => set({ rules: edit.rules.filter((_, j) => j !== i) })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="muted small">0 in Min / Max at once means no limit. Unpaid leave types need no row – they never run out.</div>
          </div>
          {unused.length > 0 && (
            <label className="span-2">
              Add a leave type
              <select value="" onChange={(e) => e.target.value && set({ rules: [...edit.rules, rule(e.target.value)] })}>
                <option value="">Choose…</option>
                {unused.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="span-all row">
            <button className="btn primary">Save policy</button>
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
                <th>Code</th>
                <th>Policy</th>
                <th>Leave per year</th>
                <th>Credited</th>
                <th>When it runs out</th>
                <th>Status</th>
                <th>People</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list && !list.length && (
                <tr>
                  <td colSpan={8} className="muted center">
                    No leave policies yet.
                  </td>
                </tr>
              )}
              {(list || []).map((p) => (
                <tr key={p._id}>
                  <td>{p.code || "—"}</td>
                  <td>
                    <b>{p.name}</b>
                    {p.description && <div className="muted small">{p.description}</div>}
                  </td>
                  <td className="small">{p.rules.map((r) => `${r.type?.code || r.type?.name}: ${r.perYear}`).join(" · ")}</td>
                  <td className="small">{p.accrual === "monthly" ? `Monthly, day ${p.creditDay}` : "1 January"}</td>
                  <td className="small">{p.exhaust === "negative" ? `Negative to -${p.maxNegative}` : EXHAUST[p.exhaust]}</td>
                  <td>
                    <span className={"tag " + (p.active ? "green" : "gray")}>{p.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td>{p.assigned}</td>
                  <td className="nowrap">
                    <button className="btn ghost small" onClick={() => open(p)}>
                      Edit
                    </button>
                    <button className="btn ghost small" onClick={() => act(p, "clone")}>
                      Clone
                    </button>
                    <button className="btn ghost small danger" onClick={() => act(p, "delete")}>
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
