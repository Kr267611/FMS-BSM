// Shared words and helpers for the FMS builder, entries grid and task forms.

export const FIELD_TYPES = [
  ["text", "Text"],
  ["longtext", "Long text"],
  ["number", "Number"],
  ["date", "Date"],
  ["datetime", "Date & time"],
  ["select", "Dropdown"],
  ["yesno", "Yes / No"],
  ["user", "Person"],
  ["link", "Link"],
  ["photo", "Photo"],
];
export const STEP_FIELD_TYPES = FIELD_TYPES.filter(([t]) => t !== "user");
export const typeLabel = (t) => (FIELD_TYPES.find(([k]) => k === t) || [t, t])[1];

export const START_MODES = [
  ["entry", "With the entry"],
  ["afterDone", "After a step is done"],
  ["afterDue", "Escalation: after a step's planned day"],
  ["withStart", "Together with a step"],
];

export const PLAN_FROM = [
  ["entry", "Entry date"],
  ["stepPlanned", "Planned of step"],
  ["stepActual", "Actual of step"],
  ["stepActualOrPlanned", "Actual of step (or its planned)"],
  ["field", "A date field (T − X)"],
  ["now", "When the step starts"],
];

export const OPS = [
  ["=", "is"],
  ["!=", "is not"],
  [">", ">"],
  [">=", "≥"],
  ["<", "<"],
  ["<=", "≤"],
  ["contains", "contains"],
  ["notContains", "does not contain"],
  ["empty", "is empty"],
  ["notEmpty", "is filled"],
  ["in", "is one of"],
  ["notIn", "is none of"],
];
export const NO_VALUE_OPS = ["empty", "notEmpty"];
export const opLabel = (op) => (OPS.find(([k]) => k === op) || [op, op])[1];

export const CALENDAR_MODES = [
  ["working", "Working days & hours (company calendar)"],
  ["calendar_skip", "Calendar days, skip week-offs & holidays"],
  ["calendar", "Calendar days (24 × 7)"],
];

export const TASK_STATUS = [
  ["waiting", "Not started"],
  ["pending", "Pending"],
  ["done", "Done"],
  ["na", "Not required"],
  ["skipped", "Skipped"],
];

export const SKIP_REASONS = {
  condition: "its condition was not met",
  dependency: "the step it depends on did not run",
  closed: "the entry was closed first",
  removed: "the step was removed from the FMS",
  "no date": "the date it counts from is empty",
  cancelled: "it was no longer needed (an earlier step was solved or stopped)",
};

// ---- keys ----
export function slug(label) {
  let s = String(label || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
  if (!s) s = "field";
  if (!/^[a-z]/.test(s)) s = "f_" + s;
  return s;
}
export function uniqueKey(wanted, taken) {
  let key = wanted;
  for (let n = 2; taken.includes(key); n++) key = `${wanted}_${n}`;
  return key;
}
export function nextStepKey(steps) {
  const taken = steps.map((s) => s.key);
  let n = steps.length + 1;
  while (taken.includes(`s${n}`)) n++;
  return `s${n}`;
}

// ---- words ----
const stepNo = (steps, key) => {
  const i = steps.findIndex((s) => s.key === key);
  return i < 0 ? "a removed step" : `Step ${i + 1}`;
};

export function describeStart(step, steps) {
  const s = step.start || { mode: "entry" };
  if (!s.mode || s.mode === "entry") return "Starts with the entry";
  const name = stepNo(steps, s.step);
  if (s.mode === "afterDone") return `Starts after ${name} is done`;
  if (s.mode === "afterDue") return `Escalates the day after ${name}'s planned day`;
  if (s.mode === "withStart") return `Starts together with ${name}`;
  return "";
}

const unitWord = (n, unit, mode) => {
  const one = Math.abs(n) === 1;
  if (unit === "minutes") return one ? "minute" : "minutes";
  if (unit === "hours") return mode === "working" ? (one ? "working hour" : "working hours") : one ? "hour" : "hours";
  return mode === "working" ? (one ? "working day" : "working days") : one ? "day" : "days";
};

export function defaultPlanFrom(step) {
  const m = step.start?.mode;
  if (m === "afterDone") return "stepActual";
  if (m === "afterDue") return "stepActualOrPlanned";
  if (m === "withStart") return "stepPlanned";
  return "entry";
}

export function describePlan(step, steps, fields, mode = "working") {
  const from = step.plan?.from || defaultPlanFrom(step);
  const ref = step.plan?.from ? step.plan.step : step.start?.step;
  let base;
  if (from === "entry") base = "the entry date";
  else if (from === "now") base = "when it starts";
  else if (from === "field") base = `"${fields.find((f) => f.key === step.plan?.field)?.label || "?"}"`;
  else if (from === "stepPlanned") base = `${stepNo(steps, ref)} planned`;
  else if (from === "stepActual") base = `${stepNo(steps, ref)} actual`;
  else base = `${stepNo(steps, ref)} actual (or planned)`;
  const tat = Number(step.tat) || 0;
  const sign = tat < 0 ? "before" : "after";
  return `TAT ${Math.abs(tat)} ${unitWord(tat, step.tatUnit, mode)} ${sign} ${base}`;
}

export function describeDoer(doer, userName) {
  if (!doer) return "No doer";
  if (doer.mode === "map") {
    const rows = doer.map?.length ?? doer.rows ?? 0;
    const fb = userName(doer.fallback);
    return `Lookup table${rows ? ` (${rows} rows)` : ""}${fb ? ` · else ${fb}` : ""}`;
  }
  if (doer.mode === "field") return `Person in the entry field${userName(doer.fallback) ? ` · else ${userName(doer.fallback)}` : ""}`;
  return userName(doer.user) || (doer.hint ? `Not chosen (sheet: ${doer.hint})` : "Not chosen");
}

// "Repeat Frq > 2 or Rate > 3000, and Step 3 Status is not Permanent Solved"
export function describeCondition(cond, fields, steps) {
  if (!cond) return "";
  const items = cond.all || cond.any;
  if (items) {
    const parts = items.map((c) => {
      const t = describeCondition(c, fields, steps);
      return c.all || c.any ? `(${t})` : t;
    });
    return parts.join(cond.all ? " and " : " or ");
  }
  let left;
  if (cond.src === "step") {
    const i = steps.findIndex((s) => s.key === cond.step);
    const st = steps[i];
    const f = st?.fields?.find((x) => x.key === cond.key);
    left = `Step ${i + 1} ${cond.key === "_status" ? "status" : f?.label || cond.key}`;
  } else {
    left = fields.find((f) => f.key === cond.key)?.label || cond.key;
  }
  return NO_VALUE_OPS.includes(cond.op) ? `${left} ${opLabel(cond.op)}` : `${left} ${opLabel(cond.op)} ${cond.value}`;
}

export const stepKeyOf = (t) => t.stepKey || `s${(t.stepIndex ?? 0) + 1}`;

// Steps that follow from `key` (start, planning base or condition), directly or through other steps –
// the same rule the server uses before it lets a step be reopened
export function dependentsOf(steps, key) {
  const refs = (cond, out = new Set()) => {
    if (!cond) return out;
    const items = cond.all || cond.any;
    if (items) items.forEach((c) => refs(c, out));
    else if (cond.src === "step" && cond.step) out.add(cond.step);
    return out;
  };
  const deps = new Set();
  for (const s of steps) {
    if (s.key === key) continue;
    const r = [s.start?.step, s.plan?.step, ...refs(s.when), ...(s.tatOverrides || []).flatMap((o) => [...refs(o.when)])];
    if (r.some((k) => k && (k === key || deps.has(k)))) deps.add(s.key);
  }
  return deps;
}

// Whole days between two "YYYY-MM-DD" keys
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

// How a step looks in the grid
export function taskState(task, today) {
  if (!task || task.status === "waiting") return { cls: "cell-wait", text: task?.triggerAt ? "Waiting" : "" };
  if (task.status === "skipped") return { cls: "cell-skip", text: "Skipped" };
  if (task.status === "na") return { cls: "cell-na", text: "Not required" };
  const end = task.actualDay || today;
  const delay = task.plannedDay ? daysBetween(task.plannedDay, end) : 0;
  if (task.status === "done") return { cls: delay > 0 ? "cell-late" : "cell-ok", delay, text: task.autoClosed ? "Closed by PC" : delay > 0 ? `${delay}d late` : "On time" };
  return { cls: delay > 0 ? "cell-overdue" : delay === 0 ? "cell-today" : "cell-pending", delay, text: delay > 0 ? `${delay}d overdue` : delay === 0 ? "Due today" : "Pending" };
}

// The value shown for a step in the grid: its Status if it has one, else the first filled value
export function headlineValue(step, task) {
  const v = task?.values || {};
  const f = (step?.fields || []).find((x) => x.key === "status") || (step?.fields || []).find((x) => x.type === "select" || x.type === "yesno");
  return f ? v[f.key] : undefined;
}
