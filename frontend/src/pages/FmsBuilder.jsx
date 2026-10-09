import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import DoerSelect, { useUsers } from "../components/DoerSelect";
import ConditionEditor from "../components/ConditionEditor";
import DoerRuleEditor from "../components/DoerRuleEditor";
import FieldsEditor, { OptionsInput, QUICK_FIELDS } from "../components/FieldsEditor";
import EffortInput from "../components/EffortInput";
import {
  CALENDAR_MODES,
  FIELD_TYPES,
  PLAN_FROM,
  START_MODES,
  STEP_FIELD_TYPES,
  defaultPlanFrom,
  describeCondition,
  describeDoer,
  describePlan,
  describeStart,
  nextStepKey,
} from "../fms";

const idOf = (v) => (v && typeof v === "object" ? v._id : v) || "";

// The server returns people as { _id, name }; the builder works with ids
function fromServer(d) {
  return {
    ...d,
    pc: idOf(d.pc),
    department: idOf(d.department),
    calendar: d.calendar || { mode: "working" },
    closure: d.closure || { enabled: true, label: "Status by PC", options: ["Closed"] },
    fields: (d.fields || []).map((f) => ({ ...f, options: f.options || [] })),
    steps: (d.steps || []).map((s) => ({
      ...s,
      doer: { ...(s.doer || { mode: "fixed" }), user: idOf(s.doer?.user), fallback: idOf(s.doer?.fallback), map: (s.doer?.map || []).map((r) => ({ ...r, user: idOf(r.user) })) },
      tatOverrides: s.tatOverrides || [],
      fields: (s.fields || []).map((f) => ({ ...f, options: f.options || [] })),
    })),
  };
}

const newStep = (steps) => ({
  key: nextStepKey(steps),
  name: "",
  how: "",
  doer: { mode: "fixed" },
  start: steps.length ? { mode: "afterDone", step: steps[steps.length - 1].key } : { mode: "entry" },
  tat: 1,
  tatUnit: "days",
  tatOverrides: [],
  fields: [{ key: "remarks", label: "Remarks", type: "text", options: [], required: false }],
});

const blank = () => ({
  name: "",
  description: "",
  sopLink: "",
  calendar: { mode: "working" },
  closure: { enabled: true, label: "Status by PC", options: ["Closed"] },
  active: true,
  fields: [{ key: "", label: "", type: "text", options: [], required: false }],
  steps: [newStep([])],
});

function StepEditor({ step, index, steps, fields, calendarMode, open, onToggle, onChange, onRemove, onMove, userName }) {
  const set = (patch) => onChange({ ...step, ...patch });
  const earlier = steps.slice(0, index).map((s, i) => ({ ...s, index: i + 1 }));
  const dateFields = fields.filter((f) => ["date", "datetime"].includes(f.type) && f.key);
  const planFrom = step.plan?.from || defaultPlanFrom(step);
  const planStep = step.plan?.from ? step.plan.step : step.start?.step;
  const condFields = fields.filter((f) => f.key && f.label);

  function setStart(mode) {
    const ref = mode === "entry" ? undefined : step.start?.step && earlier.some((s) => s.key === step.start.step) ? step.start.step : earlier.at(-1)?.key;
    set({ start: { mode, step: ref }, plan: undefined });
  }

  return (
    <div id={`step-${step.key}`} className={"card step-card" + (open ? " open" : "")}>
      <div className="step-top">
        <span className="step-no">{index + 1}</span>
        <input className="step-name" placeholder="Step name, e.g. Escalate to Paresh bhai" value={step.name} onChange={(e) => set({ name: e.target.value })} />
        <span className="row-tools">
          <button type="button" className="btn ghost small" onClick={() => onMove(-1)} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="btn ghost small" onClick={() => onMove(1)} aria-label="Move down">
            ↓
          </button>
          <button type="button" className="btn ghost small" onClick={onRemove} disabled={steps.length < 2} aria-label="Remove step">
            ✕
          </button>
          <button type="button" className="btn ghost small" onClick={onToggle}>
            {open ? "Close" : "Edit"}
          </button>
        </span>
      </div>
      <div className="step-summary small">
        <span className={`badge start-${step.start?.mode || "entry"}`}>{describeStart(step, steps)}</span>
        {step.when && <span className="badge cond">Only if {describeCondition(step.when, fields, steps)}</span>}
        <span className="muted">{describePlan(step, steps, fields, calendarMode)}</span>
        <span className="muted">· {describeDoer(step.doer, userName)}</span>
      </div>

      {open && (
        <div className="step-body">
          <section>
            <h4>Who does it</h4>
            <DoerRuleEditor value={step.doer} onChange={(doer) => set({ doer })} fields={condFields} />
          </section>

          <section>
            <h4>When it starts</h4>
            <div className="row wrap">
              <select value={step.start?.mode || "entry"} onChange={(e) => setStart(e.target.value)} disabled={index === 0}>
                {START_MODES.map(([m, label]) => (
                  <option key={m} value={m} disabled={index === 0 && m !== "entry"}>
                    {label}
                  </option>
                ))}
              </select>
              {step.start?.mode && step.start.mode !== "entry" && (
                <select value={step.start.step || ""} onChange={(e) => set({ start: { ...step.start, step: e.target.value }, plan: undefined })}>
                  {earlier.map((s) => (
                    <option key={s.key} value={s.key}>
                      Step {s.index} – {s.name || "untitled"}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {step.start?.mode === "afterDue" && <p className="small muted">Like the sheet's =IF(TODAY()-P8&gt;0, …): the day after that step's planned day, whether or not it was done.</p>}
            {step.when ? (
              <>
                <ConditionEditor value={step.when} onChange={(when) => set({ when })} fields={condFields} steps={earlier} />
                <p className="small muted">If this is false when the step is due to start, the step is skipped and not scored.</p>
              </>
            ) : (
              <div className="row small">
                <span className="muted">Always runs.</span>
                <button type="button" className="btn ghost small" onClick={() => set({ when: { all: [] } })}>
                  + Add a condition
                </button>
              </div>
            )}
          </section>

          <section>
            <h4>Effort time</h4>
            <div className="row wrap">
              <EffortInput value={step.effortMinutes} onChange={(m) => set({ effortMinutes: m })} />
              <span className="small muted">How long the work of this step takes (H:MM) – used in the Effort Time report</span>
            </div>
          </section>

          <section>
            <h4>Planned date (TAT)</h4>
            <div className="row wrap">
              <input type="number" step="any" className="tat" value={step.tat} onChange={(e) => set({ tat: e.target.value })} />
              <select value={step.tatUnit || "days"} onChange={(e) => set({ tatUnit: e.target.value })}>
                <option value="days">days</option>
                <option value="hours">hours</option>
                <option value="minutes">minutes</option>
              </select>
              <span className="small muted">counted from</span>
              <select
                value={planFrom}
                onChange={(e) => {
                  const from = e.target.value;
                  set({ plan: { from, step: from.startsWith("step") ? planStep || earlier.at(-1)?.key : undefined, field: from === "field" ? dateFields[0]?.key : undefined } });
                }}
              >
                {PLAN_FROM.filter(([f]) => (f.startsWith("step") ? earlier.length : f === "field" ? dateFields.length : true)).map(([f, label]) => (
                  <option key={f} value={f}>
                    {label}
                  </option>
                ))}
              </select>
              {planFrom.startsWith("step") && (
                <select value={planStep || ""} onChange={(e) => set({ plan: { from: planFrom, step: e.target.value } })}>
                  {earlier.map((s) => (
                    <option key={s.key} value={s.key}>
                      Step {s.index} – {s.name || "untitled"}
                    </option>
                  ))}
                </select>
              )}
              {planFrom === "field" && (
                <select value={step.plan?.field || ""} onChange={(e) => set({ plan: { from: "field", field: e.target.value } })}>
                  {dateFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {planFrom === "field" && <p className="small muted">Use a negative TAT for "T − X", e.g. −2 days = two days before that date.</p>}
            {(step.tatOverrides || []).map((o, i) => (
              <div key={i} className="override">
                <ConditionEditor
                  value={o.when}
                  onChange={(when) => set({ tatOverrides: step.tatOverrides.map((x, j) => (j === i ? { ...x, when } : x)) })}
                  fields={condFields}
                  steps={earlier}
                />
                <div className="row small">
                  then TAT
                  <input type="number" step="any" className="tat" value={o.tat} onChange={(e) => set({ tatOverrides: step.tatOverrides.map((x, j) => (j === i ? { ...x, tat: e.target.value } : x)) })} />
                  <select value={o.unit || step.tatUnit || "days"} onChange={(e) => set({ tatOverrides: step.tatOverrides.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })}>
                    <option value="days">days</option>
                    <option value="hours">hours</option>
                    <option value="minutes">minutes</option>
                  </select>
                  <button type="button" className="btn ghost small" onClick={() => set({ tatOverrides: step.tatOverrides.filter((_, j) => j !== i) })}>
                    Remove rule
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn ghost small"
              disabled={!condFields.length && !earlier.length}
              onClick={() => set({ tatOverrides: [...(step.tatOverrides || []), { when: { all: [] }, tat: step.tat, unit: step.tatUnit }] })}
            >
              + Different TAT when…
            </button>
          </section>

          <section>
            <h4>What the doer fills when marking it done</h4>
            <FieldsEditor fields={step.fields || []} onChange={(f) => set({ fields: f })} types={STEP_FIELD_TYPES} quick={QUICK_FIELDS} />
          </section>

          <section>
            <h4>How (instructions shown to the doer)</h4>
            <textarea rows={3} value={step.how || ""} onChange={(e) => set({ how: e.target.value })} placeholder="What exactly to do, what to check, what to attach" />
            <input className="mt" placeholder="Instruction video link (optional)" value={step.videoLink || ""} onChange={(e) => set({ videoLink: e.target.value })} />
          </section>
        </div>
      )}
    </div>
  );
}

export default function FmsBuilder() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const users = useUsers();
  const [p, setP] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [open, setOpen] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = !id || id === "new"; // /processes/new has no :id

  useEffect(() => {
    api("/org/departments").then(setDepartments).catch(() => {});
    const template = params.get("template");
    const load = isNew ? (template ? api(`/processes/templates/${template}`) : Promise.resolve(blank())) : api(`/processes/${id}`);
    load
      .then((d) => {
        const clean = fromServer(d);
        if (clean.existingId) clean.originalName = clean.name;
        if (clean.existingId) clean.name = `${clean.name} (new)`;
        setP(clean);
        // ?step=s2 (from the Doer conditions / Override TAT lists) opens that step
        const want = params.get("step");
        if (want && clean.steps.some((s) => s.key === want)) {
          setOpen({ [want]: true });
          setTimeout(() => document.getElementById(`step-${want}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
        } else if (clean.steps.length <= 3) setOpen({ [clean.steps[0]?.key]: true });
      })
      .catch((e) => setError(e.message));
  }, [id, isNew, params]);

  const nameOf = useMemo(() => {
    const m = new Map(users.map((u) => [u._id, u.name]));
    return (uid) => (uid ? m.get(String(uid)) : "");
  }, [users]);

  if (!p) return error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>;

  const set = (patch) => setP({ ...p, ...patch });
  const setStep = (i, s) => set({ steps: p.steps.map((x, j) => (j === i ? s : x)) });
  function moveStep(i, d) {
    const j = i + d;
    if (j < 0 || j >= p.steps.length) return;
    const next = [...p.steps];
    [next[i], next[j]] = [next[j], next[i]];
    next[0] = { ...next[0], start: { mode: "entry" } };
    set({ steps: next });
  }
  const missingDoers = p.steps.filter((s) => (s.doer?.mode === "fixed" ? !s.doer.user : !s.doer?.fallback));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { ...p, fields: p.fields.filter((f) => f.label?.trim()) };
      await api(isNew ? "/processes" : `/processes/${id}`, { method: isNew ? "POST" : "PUT", body });
      navigate("/processes");
    } catch (err) {
      setError(err.message);
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <form onSubmit={save} className="builder">
      <div className="page-head">
        <div>
          <h2>{isNew ? (p.template ? `New FMS from template` : "New FMS") : `Edit: ${p.name}`}</h2>
          <div className="muted small">Master FMS · What / Who / When / How</div>
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={p.active} onChange={(e) => set({ active: e.target.checked })} />
            Active
          </label>
          <button type="button" className="btn ghost" onClick={() => navigate("/processes")}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : p.active ? "Save" : "Save as draft"}
          </button>
        </div>
      </div>
      {!isNew && <p className="notice">Rule changes apply to steps that have not started yet. Steps already running keep their planned date and doer.</p>}
      {p.template && (
        <p className="notice">
          Built from the sheet “Repeat Spare part DAILY FMS”: 6 steps, TAT 1 / 2 / 2 / 2 / 3 / 3, escalation rules from its formulas (bugs fixed), machine-wise doer for step 2.
          {missingDoers.length > 0 && ` Choose the doers marked "Not chosen" (or save as a draft and finish later).`}
        </p>
      )}
      {p.existingId && isNew && (
        <p className="notice">
          An FMS named “{p.originalName}” already exists, so this one is named “{p.name}”. To keep the old name, first open{" "}
          <Link to={`/processes/${p.existingId}`}>the old FMS</Link>, rename it (e.g. “{p.originalName} (old)”) and untick Active; then rename this one.
        </p>
      )}
      {error && <div className="error">{error}</div>}

      <div className="card form-grid">
        <label className="span-2">
          FMS name (What)
          <input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Repeat Spare Part" required />
        </label>
        <label className="span-2">
          SOP / reference link
          <input value={p.sopLink || ""} onChange={(e) => set({ sopLink: e.target.value })} placeholder="https://…" />
        </label>
        <label className="span-all">
          Description (When / purpose)
          <textarea rows={2} value={p.description || ""} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label>
          PC (follows up, closes entries)
          <DoerSelect value={p.pc} onChange={(pc) => set({ pc })} placeholder="—" />
        </label>
        <label>
          Department
          <select value={p.department || ""} onChange={(e) => set({ department: e.target.value })}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Count TAT in
          <select value={p.calendar?.mode || "working"} onChange={(e) => set({ calendar: { mode: e.target.value } })}>
            {CALENDAR_MODES.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <h3>Entry form</h3>
        <p className="muted small">The columns on the left of the sheet: item, machine, rate, dates… An auto-calculated field works like a sheet formula (e.g. Days in Diff = entry date − Last issue date).</p>
        <FieldsEditor fields={p.fields} onChange={(fields) => set({ fields })} types={FIELD_TYPES} allowFormula />
      </div>

      <div className="row between steps-head">
        <h3>Steps</h3>
        <div className="row">
          <button type="button" className="btn ghost small" onClick={() => setOpen(Object.fromEntries(p.steps.map((s) => [s.key, true])))}>
            Open all
          </button>
          <button type="button" className="btn ghost small" onClick={() => setOpen({})}>
            Close all
          </button>
        </div>
      </div>
      {p.steps.map((s, i) => (
        <StepEditor
          key={s.key}
          step={s}
          index={i}
          steps={p.steps}
          fields={p.fields}
          calendarMode={p.calendar?.mode}
          userName={nameOf}
          open={Boolean(open[s.key])}
          onToggle={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}
          onChange={(next) => setStep(i, next)}
          onMove={(d) => moveStep(i, d)}
          onRemove={() => {
            if (p.steps.some((x) => x.start?.step === s.key || x.plan?.step === s.key)) {
              setError(`Other steps start from or count from "${s.name || `Step ${i + 1}`}". Change them first.`);
              return;
            }
            set({ steps: p.steps.filter((_, j) => j !== i) });
          }}
        />
      ))}
      <button
        type="button"
        className="btn ghost add-step"
        onClick={() => {
          const st = newStep(p.steps);
          set({ steps: [...p.steps, st] });
          setOpen((o) => ({ ...o, [st.key]: true }));
        }}
      >
        + Add step
      </button>

      <div className="card form-grid">
        <label className="check span-all">
          <input type="checkbox" checked={p.closure?.enabled !== false} onChange={(e) => set({ closure: { ...p.closure, enabled: e.target.checked } })} />
          PC can close an entry with a status (open steps count as done at that moment, the rest are skipped)
        </label>
        {p.closure?.enabled !== false && (
          <>
            <label>
              Column name
              <input value={p.closure?.label || ""} onChange={(e) => set({ closure: { ...p.closure, label: e.target.value } })} />
            </label>
            <label className="span-3">
              Status options
              <OptionsInput value={p.closure?.options} onChange={(options) => set({ closure: { ...p.closure, options } })} placeholder="e.g. Problem Solved, Permanent Solved" />
            </label>
          </>
        )}
      </div>
    </form>
  );
}
