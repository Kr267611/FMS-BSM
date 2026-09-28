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
          + Naya Process
        </button>
      </div>
      <p className="muted">Har process = ek FMS. Steps me Doer aur TAT fix karein – baaki software khud sambhalega.</p>
      {!list && <p className="muted">Loading…</p>}
      <div className="cards">
        {(list || []).map((p) => (
          <div key={p._id} className={"card process-card" + (p.active ? "" : " inactive")}>
            <div className="row between">
              <h3>{p.name}</h3>
              {!p.active && <span className="tag gray">Band</span>}
            </div>
            {p.description && <p className="muted small">{p.description}</p>}
            <ol className="steps">
              {p.steps.map((s) => (
                <li key={s._id}>
                  <b>{s.name}</b> — {s.doer?.name} · TAT {s.tat} {s.tatUnit === "hours" ? "ghante" : "din"}
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
        <h2>{isNew ? "Naya Process" : `Edit: ${initial.name}`}</h2>
        <div className="row">
          <button type="button" className="btn ghost" onClick={onClose}>
            Wapas
          </button>
          <button className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </div>
      {!isNew && <p className="notice">Steps/TAT ka badlav sirf NAYI entries par lagega. Purani jobs jaisi hain waisi rahengi.</p>}
      {error && <div className="error">{error}</div>}

      <div className="card form-grid">
        <label className="span-2">
          Process ka naam (What)
          <input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="jaise Vendor Payment" required />
        </label>
        <label className="span-2">
          Description (How / When)
          <input value={p.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={p.skipSundays} onChange={(e) => set({ skipSundays: e.target.checked })} />
          Planned date me Sunday skip karein
        </label>
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={p.active} onChange={(e) => set({ active: e.target.checked })} />
            Process chalu hai
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
        <p className="muted small">Step 1 ka Planned = entry date + TAT. Baaki ka Planned = pichhle step ka Actual + TAT.</p>
        <div className="editor">
          {p.steps.map((s, i) => (
            <div key={i} className="editor-row">
              <span className="step-no">{i + 1}</span>
              <input placeholder="Step ka naam" value={s.name} onChange={(e) => setItem("steps", i, { name: e.target.value })} required />
              <DoerSelect value={s.doer} onChange={(v) => setItem("steps", i, { doer: v })} required />
              <input type="number" min="0" step="any" className="tat" value={s.tat} onChange={(e) => setItem("steps", i, { tat: e.target.value })} required />
              <select value={s.tatUnit} onChange={(e) => setItem("steps", i, { tatUnit: e.target.value })}>
                <option value="days">din</option>
                <option value="hours">ghante</option>
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
          <h3>Entry ke fields</h3>
          <button type="button" className="btn ghost small" onClick={() => set({ fields: [...p.fields, { label: "", type: "text", options: [], required: false }] })}>
            + Field
          </button>
        </div>
        <p className="muted small">Sheet ke left side wale columns – Item name, Machine no, Vendor, Amount…</p>
        <div className="editor">
          {p.fields.map((f, i) => (
            <div key={i} className="editor-row">
              <input placeholder="Field ka naam" value={f.label} onChange={(e) => setItem("fields", i, { label: e.target.value })} />
              <select value={f.type} onChange={(e) => setItem("fields", i, { type: e.target.value })}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown</option>
              </select>
              {f.type === "select" && (
                <input
                  placeholder="Options, comma se alag"
                  defaultValue={(f.options || []).join(", ")}
                  onBlur={(e) => setItem("fields", i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                />
              )}
              <label className="check">
                <input type="checkbox" checked={f.required} onChange={(e) => setItem("fields", i, { required: e.target.checked })} />
                Zaroori
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
