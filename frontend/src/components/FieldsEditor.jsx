import { useEffect, useState } from "react";
import { slug, uniqueKey } from "../fms";

export const QUICK_FIELDS = [
  ["Status", { key: "status", label: "Status", type: "select", options: ["Done"], required: true }],
  ["Remarks", { key: "remarks", label: "Remarks", type: "text", options: [], required: false }],
  ["Action Taken", { key: "action_taken", label: "Action Taken", type: "longtext", options: [], required: true }],
  ["Yes / No", { key: "", label: "Checked", type: "yesno", options: [], required: true }],
  ["Photo", { key: "", label: "Photo", type: "photo", options: [], required: false }],
];

export function OptionsInput({ value, onChange, placeholder }) {
  const [text, setText] = useState((value || []).join(", "));
  useEffect(() => setText((value || []).join(", ")), [value]);
  return (
    <input
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split(",").map((x) => x.trim()).filter(Boolean))}
    />
  );
}

// Entry fields (with auto-calculation) or the fields a doer fills in a step
export default function FieldsEditor({ fields, onChange, types, allowFormula, quick }) {
  const set = (i, patch) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const keyed = (f, i) => (f.key ? f : { ...f, key: uniqueKey(slug(f.label), fields.filter((_, j) => j !== i).map((x) => x.key)) });
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (f) => {
    const taken = fields.map((x) => x.key);
    const key = f.key && !taken.includes(f.key) ? f.key : f.label ? uniqueKey(slug(f.label), taken) : "";
    onChange([...fields, { ...f, key }]);
  };
  return (
    <div className="editor">
      {fields.map((f, i) => {
        const before = fields.slice(0, i).filter((x) => x.key);
        const calc = allowFormula && f.formula?.op;
        return (
          <div key={i} className="editor-row field-row">
            <input placeholder="Field name" value={f.label} onChange={(e) => set(i, { label: e.target.value })} onBlur={() => f.label && !f.key && onChange(fields.map((x, j) => (j === i ? keyed(x, i) : x)))} />
            <select value={calc ? "formula" : f.type} onChange={(e) => (e.target.value === "formula" ? set(i, { type: "number", formula: { op: "days", a: "", b: "@entry" } }) : set(i, { type: e.target.value, formula: undefined }))}>
              {types.map(([t, label]) => (
                <option key={t} value={t}>
                  {label}
                </option>
              ))}
              {allowFormula && <option value="formula">Auto-calculated</option>}
            </select>
            {(f.type === "select" || (f.type === "text" && !calc)) && (
              <OptionsInput value={f.options} onChange={(options) => set(i, { options })} placeholder={f.type === "select" ? "Options, comma-separated" : "Suggestions (optional)"} />
            )}
            {calc && (
              <span className="formula">
                <select value={f.formula.op} onChange={(e) => set(i, { formula: { ...f.formula, op: e.target.value, b: e.target.value === "days" ? "@entry" : "" } })}>
                  <option value="days">Days between</option>
                  <option value="add">Add</option>
                  <option value="subtract">Subtract</option>
                  <option value="multiply">Multiply</option>
                  <option value="divide">Divide</option>
                </select>
                {["a", "b"].map((side) => (
                  <select key={side} value={f.formula[side] || ""} onChange={(e) => set(i, { formula: { ...f.formula, [side]: e.target.value } })}>
                    <option value="">—</option>
                    {f.formula.op === "days" && <option value="@entry">Entry date</option>}
                    {before
                      .filter((x) => (f.formula.op === "days" ? ["date", "datetime"].includes(x.type) : x.type === "number"))
                      .map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.label}
                        </option>
                      ))}
                  </select>
                ))}
              </span>
            )}
            {!calc && (
              <label className="check small">
                <input type="checkbox" checked={Boolean(f.required)} onChange={(e) => set(i, { required: e.target.checked })} />
                Required
              </label>
            )}
            <span className="row-tools">
              <button type="button" className="btn ghost small" onClick={() => move(i, -1)} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="btn ghost small" onClick={() => move(i, 1)} aria-label="Move down">
                ↓
              </button>
              <button type="button" className="btn ghost small" onClick={() => onChange(fields.filter((_, j) => j !== i))} aria-label="Remove field">
                ✕
              </button>
            </span>
          </div>
        );
      })}
      <div className="row wrap">
        <button type="button" className="btn ghost small" onClick={() => add({ key: "", label: "", type: "text", options: [], required: false })}>
          + Field
        </button>
        {(quick || [])
          .filter(([, f]) => !f.key || !fields.some((x) => x.key === f.key))
          .map(([label, f]) => (
            <button key={label} type="button" className="btn ghost small" onClick={() => add(f)}>
              + {label}
            </button>
          ))}
      </div>
    </div>
  );
}
