import { useState } from "react";
import { api } from "../api";
import FieldInput from "./FieldInput";

const filled = (v) => !(v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length));

// What the doer fills when marking a step done: the step's fields (Status, Action Taken, photos…) and a remark
// (fields: a checklist's form or a delegation's proof, instead of an FMS step's fields)
export default function StepForm({ task, step, fields: given, onDone, onCancel }) {
  const fields = given || step?.fields || [];
  const hasRemarksField = fields.some((f) => f.key === "remarks");
  const [values, setValues] = useState({});
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const missing = fields.filter((f) => f.required && !filled(values[f.key]));

  async function submit(e) {
    e.preventDefault();
    if (missing.length) {
      setError(`Fill in: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/tasks/${task._id}/done`, { method: "POST", body: { values, remarks: hasRemarksField ? values.remarks || "" : remarks } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="step-form" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.key} className={f.type === "longtext" || f.type === "photo" ? "wide" : ""}>
          <span>
            {f.label}
            {f.required && <b className="req"> *</b>}
          </span>
          <FieldInput field={f} value={values[f.key]} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} />
        </label>
      ))}
      {!hasRemarksField && (
        <label className="wide">
          <span>Remark</span>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
        </label>
      )}
      {error && <div className="error wide">{error}</div>}
      <div className="row wide">
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : "Mark done"}
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
