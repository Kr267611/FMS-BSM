import { useEffect, useState } from "react";
import { api } from "../api";
import DoerSelect from "../components/DoerSelect";

const blank = () => ({
  name: "",
  description: "",
  skipSundays: false,
  active: true,
  fields: [{ label: "", type: "text", options: [], required: false }],
  steps: [{ name: "", doer: "", tat: 1, tatUnit: "days", how: "" }],
});

export default function Processes() {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api("/processes", { query: { all: 1 } }).then(setList);
  useEffect(() => {
    load();
  }, []);

  if (editing) {
    return (
      <ProcessForm
        initial={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h2>FMS Builder</h2>
        <button className="btn primary" onClick={() => setEditing(blank())}>
          + New Process
        </button>
      </div>
      <p className="muted">Each process is one FMS. Set the doer and TAT for every step, and the software handles the rest.</p>
      {!list && <p className="muted">Loading…</p>}
      <div className="cards">
        {(list || []).map((p) => (
          <div key={p._id} className={"card process-card" + (p.active ? "" : " inactive")}>
            <div className="row between">
              <h3>{p.name}</h3>
              {!p.active && <span className="tag gray">Inactive</span>}
            </div>
            {p.description && <p className="muted small">{p.description}</p>}
            <ol className="steps">
              {p.steps.map((s) => (
                <li key={s._id}>
                  <b>{s.name}</b> — {s.doer?.name} · TAT {s.tat} {s.tatUnit === "hours" ? (s.tat === 1 ? "hour" : "hours") : s.tat === 1 ? "day" : "days"}
                </li>
              ))}
            </ol>
            <div className="row between">
              <span className="muted small">
                {p.jobCounter} jobs {p.skipSundays ? "· Sunday skip" : ""}
              </span>
              <button
                className="btn ghost small"
                onClick={() =>
                  setEditing({
                    ...p,
                    steps: p.steps.map((s) => ({ ...s, doer: s.doer?._id || s.doer })),
                  })
                }
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ProcessForm({ initial, onClose, onSaved }) {
  const [p, setP] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = !initial._id;

  const set = (patch) => setP({ ...p, ...patch });
  const setItem = (key, i, patch) => set({ [key]: p[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const removeItem = (key, i) => set({ [key]: p[key].filter((_, j) => j !== i) });
  const move = (key, i, d) => {
    const arr = [...p[key]];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set({ [key]: arr });
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(isNew ? "/processes" : `/processes/${p._id}`, { method: isNew ? "POST" : "PUT", body: p });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div className="page-head">
        <h2>{isNew ? "New Process" : `Edit: ${initial.name}`}</h2>
        <div className="row">
          <button type="button" className="btn ghost" onClick={onClose}>
            Back
          </button>
          <button className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </div>
      {!isNew && <p className="notice">Changes to steps and TAT apply to new entries only. Existing jobs keep their current steps.</p>}
      {error && <div className="error">{error}</div>}

      <div className="card form-grid">
        <label className="span-2">
          Process name (What)
          <input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Vendor Payment" required />
        </label>
        <label className="span-2">
          Description (How / When)
          <input value={p.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={p.skipSundays} onChange={(e) => set({ skipSundays: e.target.checked })} />
          Skip Sundays when calculating planned dates
        </label>
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={p.active} onChange={(e) => set({ active: e.target.checked })} />
            Process is active
          </label>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <h3>Steps (Who / TAT)</h3>
          <button type="button" className="btn ghost small" onClick={() => set({ steps: [...p.steps, { name: "", doer: "", tat: 1, tatUnit: "days", how: "" }] })}>
            + Step
          </button>
        </div>
        <p className="muted small">Step 1 is planned at entry date + TAT. Each later step is planned at the previous step's actual + TAT.</p>
        <div className="editor">
          {p.steps.map((s, i) => (
            <div key={i} className="editor-row">
              <span className="step-no">{i + 1}</span>
              <input placeholder="Step name" value={s.name} onChange={(e) => setItem("steps", i, { name: e.target.value })} required />
              <DoerSelect value={s.doer} onChange={(v) => setItem("steps", i, { doer: v })} required />
              <input type="number" min="0" step="any" className="tat" value={s.tat} onChange={(e) => setItem("steps", i, { tat: e.target.value })} required />
              <select value={s.tatUnit} onChange={(e) => setItem("steps", i, { tatUnit: e.target.value })}>
                <option value="days">days</option>
                <option value="hours">hours</option>
              </select>
              <span className="row-tools">
                <button type="button" className="btn ghost small" onClick={() => move("steps", i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn ghost small" onClick={() => move("steps", i, 1)}>
                  ↓
                </button>
                <button type="button" className="btn ghost small" disabled={p.steps.length < 2} onClick={() => removeItem("steps", i)}>
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h3>Entry fields</h3>
          <button type="button" className="btn ghost small" onClick={() => set({ fields: [...p.fields, { label: "", type: "text", options: [], required: false }] })}>
            + Field
          </button>
        </div>
        <p className="muted small">The columns on the left of the sheet – item name, machine no., vendor, amount…</p>
        <div className="editor">
          {p.fields.map((f, i) => (
            <div key={i} className="editor-row">
              <input placeholder="Field name" value={f.label} onChange={(e) => setItem("fields", i, { label: e.target.value })} />
              <select value={f.type} onChange={(e) => setItem("fields", i, { type: e.target.value })}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown</option>
              </select>
              {f.type === "select" && (
                <input
                  placeholder="Options, comma-separated"
                  defaultValue={(f.options || []).join(", ")}
                  onBlur={(e) => setItem("fields", i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                />
              )}
              <label className="check">
                <input type="checkbox" checked={f.required} onChange={(e) => setItem("fields", i, { required: e.target.checked })} />
                Required
              </label>
              <span className="row-tools">
                <button type="button" className="btn ghost small" onClick={() => move("fields", i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn ghost small" onClick={() => move("fields", i, 1)}>
                  ↓
                </button>
                <button type="button" className="btn ghost small" onClick={() => removeItem("fields", i)}>
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </form>
  );
}
