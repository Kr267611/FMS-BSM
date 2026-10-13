import { useCallback, useEffect, useState } from "react";
import { api, can } from "../api";
import { useAuth } from "../App";
import ConditionEditor from "../components/ConditionEditor";
import { describeCondition } from "../fms";

const idOf = (v) => (v && typeof v === "object" ? v._id : v) || "";
const blank = () => ({ name: "", active: true, source: { process: "", step: "" }, when: undefined, target: "", map: [] });

// MIDAP "FMS Auto Complete" / "Split FMS": a finished step creates an entry in another FMS
export default function AutoComplete() {
  const { user } = useAuth();
  const [rules, setRules] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api("/fms-rules/auto-complete")
        .then(setRules)
        .catch((e) => setError(e.message)),
    []
  );
  useEffect(() => {
    load();
    api("/processes", { query: { all: 1 } })
      .then(setProcesses)
      .catch(() => {});
  }, [load]);
  const byId = new Map(processes.map((p) => [p._id, p]));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>FMS Auto Complete</h2>
          <div className="muted small">When a step of one FMS is done (and the condition is true), an entry is created in another FMS with values copied over.</div>
        </div>
        {can(user, "fms", "add") && (
          <button className="btn primary" onClick={() => setForm(blank())}>
            + Add Auto Complete
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {!rules && !error && <p className="muted">Loading…</p>}
      {rules && !rules.length && <div className="card empty">No rules yet. Example: QC Damage → step "Inspect" done with Result = Damage → new entry in Vendor Debit Note.</div>}
      {rules?.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>When this is done</th>
                  <th>Only if</th>
                  <th>Creates an entry in</th>
                  <th>Values</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const src = byId.get(idOf(r.source.process));
                  const step = r.source.process?.steps?.find((s) => s.key === r.source.step);
                  return (
                    <tr key={r._id} className={r.active ? "" : "inactive"}>
                      <td>
                        <b>{r.name}</b>
                        {!r.active && <span className="tag gray">Off</span>}
                      </td>
                      <td>
                        {r.source.process?.name} → {step?.name || r.source.step}
                      </td>
                      <td className="small">{r.when && src ? describeCondition(r.when, src.fields, src.steps) : <span className="muted">always</span>}</td>
                      <td>
                        <b>{r.target?.name}</b>
                      </td>
                      <td className="muted small">{r.map.length} field(s)</td>
                      <td>
                        {can(user, "fms", "edit") && (
                          <button className="btn ghost small" onClick={() => setForm({ ...r, source: { process: idOf(r.source.process), step: r.source.step }, target: idOf(r.target) })}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {form && (
        <RuleForm
          rule={form}
          processes={processes}
          canDelete={can(user, "fms", "delete")}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}
    </>
  );
}

function RuleForm({ rule, processes, canDelete, onClose, onSaved }) {
  const [r, setR] = useState(rule);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setR((prev) => ({ ...prev, ...patch }));
  const src = processes.find((p) => p._id === r.source.process);
  const stepIndex = src ? src.steps.findIndex((s) => s.key === r.source.step) : -1;
  const step = stepIndex >= 0 ? src.steps[stepIndex] : null;
  const target = processes.find((p) => p._id === r.target);
  const targetFields = (target?.fields || []).filter((f) => !f.formula?.op);
  const mapOf = (key) => r.map.find((m) => m.to === key);

  // A new target: copy values by matching field keys or names
  function pickTarget(id) {
    const t = processes.find((p) => p._id === id);
    const map = [];
    for (const f of (t?.fields || []).filter((x) => !x.formula?.op)) {
      const e = src?.fields.find((x) => x.key === f.key || x.label.toLowerCase() === f.label.toLowerCase());
      const s = step?.fields?.find((x) => x.key === f.key || x.label.toLowerCase() === f.label.toLowerCase());
      if (e) map.push({ to: f.key, from: "entry", key: e.key });
      else if (s) map.push({ to: f.key, from: "step", key: s.key });
    }
    set({ target: id, map });
  }
  function setMap(to, value) {
    const rest = r.map.filter((m) => m.to !== to);
    if (!value) return set({ map: rest });
    const [from, key] = value.split(":");
    set({ map: [...rest, from === "fixed" ? { to, from, value: mapOf(to)?.value || "" } : { to, from, key }] });
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(r._id ? `/fms-rules/auto-complete/${r._id}` : "/fms-rules/auto-complete", { method: r._id ? "PUT" : "POST", body: r });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  async function remove() {
    try {
      await api(`/fms-rules/auto-complete/${r._id}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal card checklist-form" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="row between">
          <h3>{r._id ? "Edit Auto Complete" : "Add Auto Complete"}</h3>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <div className="form-grid mt">
          <label className="span-2">
            Rule name
            <input value={r.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. QC damage → debit note" required autoFocus />
          </label>
          <label>
            When this FMS…
            <select value={r.source.process} onChange={(e) => set({ source: { process: e.target.value, step: "" }, when: undefined, map: [] })} required>
              <option value="">Choose FMS</option>
              {processes.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            …has this step done
            <select value={r.source.step} onChange={(e) => set({ source: { ...r.source, step: e.target.value }, when: undefined })} required disabled={!src}>
              <option value="">Choose step</option>
              {(src?.steps || []).map((s, i) => (
                <option key={s.key} value={s.key}>
                  {i + 1}. {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {step && (
          <ConditionEditor
            value={r.when}
            onChange={(when) => set({ when })}
            fields={src.fields.filter((f) => !["photo"].includes(f.type))}
            steps={src.steps.slice(0, stepIndex + 1)}
            label="Create the entry only if"
          />
        )}
        {step && !r.when && <p className="muted small">No condition: every time the step is done.</p>}

        <div className="form-grid mt">
          <label className="span-2">
            Create an entry in
            <select value={r.target} onChange={(e) => pickTarget(e.target.value)} required disabled={!step}>
              <option value="">Choose FMS</option>
              {processes
                .filter((p) => p._id !== r.source.process)
                .map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                    {p.active ? "" : " (draft)"}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {target && (
          <>
            <h4 className="section-title">Values for the new entry</h4>
            <div className="table-scroll">
              <table className="grid compact">
                <thead>
                  <tr>
                    <th>Field in {target.name}</th>
                    <th>Comes from</th>
                  </tr>
                </thead>
                <tbody>
                  {targetFields.map((f) => {
                    const m = mapOf(f.key);
                    const v = m ? (m.from === "fixed" ? "fixed:" : m.from === "entryNo" ? "entryNo:" : `${m.from}:${m.key}`) : "";
                    return (
                      <tr key={f.key}>
                        <td>
                          {f.label}
                          {f.required && <b className="req"> *</b>}
                        </td>
                        <td>
                          <div className="row">
                            <select value={v} onChange={(e) => setMap(f.key, e.target.value)}>
                              <option value="">— leave empty —</option>
                              <optgroup label={`Entry of ${src.name}`}>
                                {src.fields.map((x) => (
                                  <option key={x.key} value={`entry:${x.key}`}>
                                    {x.label}
                                  </option>
                                ))}
                              </optgroup>
                              {(step.fields || []).length > 0 && (
                                <optgroup label={`Filled in "${step.name}"`}>
                                  {step.fields.map((x) => (
                                    <option key={x.key} value={`step:${x.key}`}>
                                      {x.label}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <option value="entryNo:">{src.name} entry number</option>
                              <option value="fixed:">A fixed value…</option>
                            </select>
                            {m?.from === "fixed" && (
                              <input value={m.value || ""} onChange={(e) => set({ map: r.map.map((x) => (x.to === f.key ? { ...x, value: e.target.value } : x)) })} placeholder="Value" />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!target.active && <p className="warn-text small">{target.name} is a draft: entries are only created once it is active.</p>}
          </>
        )}

        {error && <div className="error">{error}</div>}
        <div className="row wrap between mt">
          <label className="check">
            <input type="checkbox" checked={r.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
          <div className="row">
            {r._id && canDelete && (
              <button type="button" className="btn ghost small danger" onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)}>
                {confirmDelete ? "Yes, delete it" : "Delete"}
              </button>
            )}
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
