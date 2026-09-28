import { NO_VALUE_OPS, OPS, TASK_STATUS } from "../fms";

const isGroup = (c) => c && (Array.isArray(c.all) || Array.isArray(c.any));

// Source <-> select value: "field:rate", "step:s3:status", "step:s3:_status"
const srcValue = (r) => (r.src === "step" ? `step:${r.step}:${r.key}` : `field:${r.key}`);
function parseSrc(v) {
  const [src, a, b] = v.split(":");
  return src === "step" ? { src: "step", step: a, key: b } : { src: "field", key: a };
}

function sourceField(rule, fields, steps) {
  if (rule.src === "step") {
    if (rule.key === "_status") return { type: "select", options: TASK_STATUS.map(([k]) => k), labels: Object.fromEntries(TASK_STATUS) };
    return steps.find((s) => s.key === rule.step)?.fields?.find((f) => f.key === rule.key);
  }
  return fields.find((f) => f.key === rule.key);
}

function ValueInput({ rule, field, onChange }) {
  if (NO_VALUE_OPS.includes(rule.op)) return <span className="cond-novalue" />;
  const list = rule.op === "in" || rule.op === "notIn";
  const options = field?.type === "yesno" ? ["Yes", "No"] : field?.type === "select" ? field.options || [] : null;
  if (options && !list) {
    return (
      <select value={rule.value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {field.labels?.[o] || o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={field?.type === "number" && !list ? "number" : field?.type === "date" && !list ? "date" : "text"}
      step="any"
      placeholder={list ? "values, comma-separated" : "value"}
      value={rule.value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function RuleRow({ rule, fields, steps, onChange, onRemove }) {
  const field = sourceField(rule, fields, steps);
  const numeric = field?.type === "number" || field?.type === "date";
  const ops = OPS.filter(([op]) => numeric || !["<", "<=", ">", ">="].includes(op));
  return (
    <div className="cond-rule">
      <select value={srcValue(rule)} onChange={(e) => onChange({ ...parseSrc(e.target.value), op: rule.op, value: "" })}>
        <optgroup label="Entry fields">
          {fields.map((f) => (
            <option key={f.key} value={`field:${f.key}`}>
              {f.label}
            </option>
          ))}
        </optgroup>
        {steps.map((s, i) => (
          <optgroup key={s.key} label={`Step ${s.index ?? i + 1} – ${s.name || "untitled"}`}>
            <option value={`step:${s.key}:_status`}>Step {s.index ?? i + 1} status</option>
            {(s.fields || []).map((f) => (
              <option key={f.key} value={`step:${s.key}:${f.key}`}>
                Step {s.index ?? i + 1} · {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value })}>
        {ops.map(([op, label]) => (
          <option key={op} value={op}>
            {label}
          </option>
        ))}
      </select>
      <ValueInput rule={rule} field={field} onChange={(value) => onChange({ ...rule, value })} />
      <button type="button" className="btn ghost small" onClick={onRemove} aria-label="Remove rule">
        ✕
      </button>
    </div>
  );
}

// Edits { all: [...] } / { any: [...] } with rules and one level of nested groups.
// fields: entry fields; steps: the steps before this one ({ key, name, fields, index })
export default function ConditionEditor({ value, onChange, fields, steps, depth = 0 }) {
  const kind = value?.any ? "any" : "all";
  const items = value?.[kind] || [];
  const set = (next) => onChange(next.length ? { [kind]: next } : undefined);
  const newRule = () =>
    fields[0] ? { src: "field", key: fields[0].key, op: "=", value: "" } : steps[0] ? { src: "step", step: steps[0].key, key: "_status", op: "=", value: "done" } : null;

  return (
    <div className={depth ? "cond cond-nested" : "cond"}>
      <div className="cond-head small">
        {depth ? "Group:" : "Run this step only if"}
        <select value={kind} onChange={(e) => onChange(items.length ? { [e.target.value]: items } : undefined)}>
          <option value="all">all of these are true</option>
          <option value="any">any of these is true</option>
        </select>
      </div>
      {items.map((item, i) =>
        isGroup(item) ? (
          <div key={i} className="cond-group-row">
            <ConditionEditor
              value={item}
              fields={fields}
              steps={steps}
              depth={depth + 1}
              onChange={(g) => set(g ? items.map((x, j) => (j === i ? g : x)) : items.filter((_, j) => j !== i))}
            />
          </div>
        ) : (
          <RuleRow
            key={i}
            rule={item}
            fields={fields}
            steps={steps}
            onChange={(r) => set(items.map((x, j) => (j === i ? r : x)))}
            onRemove={() => set(items.filter((_, j) => j !== i))}
          />
        )
      )}
      <div className="row wrap">
        <button type="button" className="btn ghost small" disabled={!newRule()} onClick={() => set([...items, newRule()])}>
          + Rule
        </button>
        {depth === 0 && (
          <button type="button" className="btn ghost small" disabled={!newRule()} onClick={() => set([...items, { [kind === "all" ? "any" : "all"]: [newRule()] }])}>
            + Group ({kind === "all" ? "any of" : "all of"})
          </button>
        )}
      </div>
    </div>
  );
}
