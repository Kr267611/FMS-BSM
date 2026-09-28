// FMS engine v2 – pure functions over plain objects (no database), so every rule is unit-tested.
//
// An entry (job) has one task per step. A step starts in one of four ways:
//   entry     – when the entry is made
//   afterDone – when step X is done (a normal sequence)
//   afterDue  – when step X's planned day has passed (an escalation, like =IF(TODAY()-P8>0, ...) in the sheet)
//   withStart – together with step X (a parallel step)
// When it is due to start, its condition is checked: true -> the task becomes pending with a planned
// date and a doer; false -> it is skipped (not scored). Steps that depend on a skipped step are skipped too.
const { dayKey, addDaysKey } = require("../dates");
const { addTatCal, startOfDay, normalizeCalendar } = require("../calendar");
const { evaluate, stepRefs, isBlank, num, norm } = require("./conditions");

const START_MODES = ["entry", "afterDone", "afterDue", "withStart"];
const PLAN_FROM = ["entry", "stepPlanned", "stepActual", "stepActualOrPlanned", "field", "now"];
const RESOLVED = new Set(["done", "na", "skipped"]);
const DAY_MS = 24 * 60 * 60 * 1000;

const time = (d) => (d ? new Date(d).getTime() : NaN);

function defaultPlan(step) {
  const s = step.start || {};
  if (s.mode === "afterDone") return { from: "stepActual", step: s.step };
  if (s.mode === "afterDue") return { from: "stepActualOrPlanned", step: s.step };
  if (s.mode === "withStart") return { from: "stepPlanned", step: s.step };
  return { from: "entry" };
}

// "YYYY-MM-DD" (IST) for a stored date field, a Date or an ISO date-time
function dayOf(v) {
  if (isBlank(v)) return null;
  if (v instanceof Date) return dayKey(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return dayKey(new Date(s));
}

// A date field used as a planning base (T field): the start of that day, or the exact date-time
function fieldDate(v) {
  if (isBlank(v)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return startOfDay(String(v));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

// ---------- entry fields ----------

const FORMULA_OPS = ["days", "add", "subtract", "multiply", "divide"];

// Auto-calculated fields, e.g. Days in Diff = entry date - Last issue date. "@entry" = the entry date.
function computeFields(fields, data, startDate) {
  const out = { ...(data || {}) };
  for (const f of fields || []) {
    if (!f.formula?.op) continue;
    const get = (ref) => (ref === "@entry" ? startDate : out[ref]);
    const a = get(f.formula.a);
    const b = get(f.formula.b);
    let v;
    if (f.formula.op === "days") {
      const da = dayOf(a);
      const db = dayOf(b);
      v = da && db ? Math.round((Date.parse(db) - Date.parse(da)) / DAY_MS) : undefined;
    } else {
      const x = num(a);
      const y = num(b);
      if (!isNaN(x) && !isNaN(y)) {
        if (f.formula.op === "add") v = x + y;
        else if (f.formula.op === "subtract") v = x - y;
        else if (f.formula.op === "multiply") v = x * y;
        else if (f.formula.op === "divide") v = y ? x / y : undefined;
      }
    }
    if (v === undefined || !isFinite(v)) delete out[f.key];
    else out[f.key] = Math.round(v * 100) / 100;
  }
  return out;
}

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function cleanValue(f, raw) {
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return undefined;
  switch (f.type) {
    case "number": {
      const n = num(raw);
      if (isNaN(n)) throw fail(`"${f.label}" must be a number`);
      return n;
    }
    case "date": {
      const s = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw fail(`"${f.label}" must be a date`);
      return s;
    }
    case "datetime": {
      const d = new Date(raw);
      if (isNaN(d)) throw fail(`"${f.label}" must be a date and time`);
      return d.toISOString();
    }
    case "select": {
      const opt = (f.options || []).find((o) => norm(o) === norm(raw));
      if (!opt) throw fail(`Choose one of the options for "${f.label}"`);
      return opt;
    }
    case "yesno": {
      const v = norm(raw);
      if (["yes", "y", "true", "1"].includes(v)) return "Yes";
      if (["no", "n", "false", "0"].includes(v)) return "No";
      throw fail(`Answer Yes or No for "${f.label}"`);
    }
    case "user":
      if (!OBJECT_ID.test(String(raw))) throw fail(`Choose a person for "${f.label}"`);
      return String(raw);
    case "link": {
      const s = String(raw).trim();
      if (!/^https?:\/\/\S+$/i.test(s)) throw fail(`"${f.label}" must be a link starting with http:// or https://`);
      return s.slice(0, 1000);
    }
    case "photo": {
      const ids = (Array.isArray(raw) ? raw : [raw]).map(String).filter((x) => OBJECT_ID.test(x));
      return ids.length ? ids.slice(0, 6) : undefined;
    }
    case "longtext":
      return String(raw).trim().slice(0, 4000);
    default:
      return String(raw).trim().slice(0, 500);
  }
}

// Validate what a user typed against field definitions. Computed fields are ignored (the server fills them).
function cleanValues(defs, input, { requireAll = true } = {}) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const f of defs || []) {
    if (f.formula?.op) continue;
    const v = cleanValue(f, src[f.key]);
    if (v === undefined) {
      if (f.required && requireAll) throw fail(`"${f.label}" is required`);
      continue;
    }
    out[f.key] = v;
  }
  return out;
}

// ---------- steps ----------

function planBase(plan, tasks, job, at) {
  const t = plan.step ? tasks[plan.step] : null;
  switch (plan.from) {
    case "entry":
      return job.startDate ? new Date(job.startDate) : null;
    case "now":
      return at ? new Date(at) : null;
    case "stepPlanned":
      return t?.planned ? new Date(t.planned) : null;
    case "stepActual": {
      const d = t?.actual || t?.resolvedAt || t?.planned;
      return d ? new Date(d) : null;
    }
    case "stepActualOrPlanned": {
      const d = t?.actual || t?.planned;
      return d ? new Date(d) : null;
    }
    case "field":
      return fieldDate(job.data?.[plan.field]);
    default:
      return null;
  }
}

// TAT override (MIDAP "Override TAT"): the first matching rule wins
function pickTat(step, ctx) {
  for (const o of step.tatOverrides || []) {
    if (evaluate(o.when, ctx, true)) return { tat: Number(o.tat) || 0, unit: o.unit || step.tatUnit || "days" };
  }
  return { tat: Number(step.tat) || 0, unit: step.tatUnit || "days" };
}

// When is this waiting step due to start?
// -> { state: "go", at } | { state: "wait", at? } | { state: "skip", reason }
function triggerOf(step, tasks, job, now) {
  const s = step.start || { mode: "entry" };
  if (!s.mode || s.mode === "entry") return { state: "go", at: new Date(job.startDate) };
  const src = tasks[s.step];
  if (!src) return { state: "skip", reason: "dependency" };
  if (s.mode === "afterDone") {
    if (src.status === "done") return { state: "go", at: new Date(src.actual) };
    if (src.status === "na" || src.status === "skipped") return { state: "go", at: new Date(src.resolvedAt || now) };
    return { state: "wait" };
  }
  if (s.mode === "afterDue") {
    if (src.status === "na" || src.status === "skipped") return { state: "skip", reason: "dependency" };
    if (!src.plannedDay) return { state: "wait" };
    const at = startOfDay(addDaysKey(src.plannedDay, 1)); // the day after the planned day
    return at.getTime() <= now.getTime() ? { state: "go", at } : { state: "wait", at };
  }
  if (s.mode === "withStart") {
    if (src.status === "skipped") return { state: "skip", reason: "dependency" };
    if (src.activatedAt) return { state: "go", at: new Date(src.activatedAt) };
    return { state: "wait" };
  }
  return { state: "skip", reason: "dependency" };
}

function skipTask(t, reason, now) {
  Object.assign(t, { status: "skipped", skipReason: reason, resolvedAt: now, triggerAt: null });
}

// Bring every waiting step of one entry up to date at time `now`. Mutates `tasks`, returns the changed keys.
//   process : { name, steps, calendar: { mode } }
//   job     : { startDate, data, closeStatus } – closeStatus set = closed by the PC
//   tasks   : { [stepKey]: task }
//   calendar: normalizeCalendar(...)
//   doerOf  : (step, data) -> user id | null
function advance({ process, job, tasks, now = new Date(), calendar = normalizeCalendar(), doerOf = () => null, fallbackDoer = null }) {
  const changed = new Set();
  const ctx = { data: job.data || {}, steps: tasks };
  const mode = process.calendar?.mode || "working";

  for (const step of process.steps || []) {
    const t = tasks[step.key];
    if (!t) continue;

    // A started step that is no longer needed stops, like the sheet where Step 3's Planned goes blank
    // once Step 2 says "Permanent Solved": its condition is now false for good, or the step it started
    // with (parallel / escalation) was stopped. It is not scored.
    if (t.status === "pending") {
      const src = step.start?.step ? tasks[step.start.step] : null;
      const srcStopped = src?.status === "skipped" && ["withStart", "afterDue"].includes(step.start.mode);
      if (srcStopped || (step.when && evaluate(step.when, ctx, false) === false)) {
        Object.assign(t, { status: "skipped", skipReason: "cancelled", resolvedAt: now, triggerAt: null });
        changed.add(step.key);
      }
      continue;
    }
    if (t.status !== "waiting") continue;
    if (job.closeStatus) {
      skipTask(t, "closed", now);
      changed.add(step.key);
      continue;
    }

    const tr = triggerOf(step, tasks, job, now);
    if (tr.state === "skip") {
      skipTask(t, tr.reason, now);
      changed.add(step.key);
      continue;
    }
    if (tr.state === "wait") {
      // Skip early when nothing can make the condition true any more
      if (step.when && evaluate(step.when, ctx, false) === false) {
        skipTask(t, "condition", now);
        changed.add(step.key);
        continue;
      }
      const at = tr.at || null;
      if (time(t.triggerAt) !== time(at) && !(isNaN(time(t.triggerAt)) && !at)) {
        t.triggerAt = at;
        changed.add(step.key);
      }
      continue;
    }

    if (step.when && !evaluate(step.when, ctx, true)) {
      skipTask(t, "condition", now);
      changed.add(step.key);
      continue;
    }
    const plan = step.plan?.from ? step.plan : defaultPlan(step);
    const base = planBase(plan, tasks, job, tr.at);
    if (!base) {
      skipTask(t, "no date", now);
      changed.add(step.key);
      continue;
    }
    const { tat, unit } = pickTat(step, ctx);
    const planned = addTatCal(base, tat, unit, calendar, mode);
    Object.assign(t, {
      status: "pending",
      planned,
      plannedDay: dayKey(planned),
      activatedAt: tr.at,
      triggerAt: null,
      tat,
      tatUnit: unit,
      doer: doerOf(step, job.data || {}) || fallbackDoer || t.doer || null,
    });
    changed.add(step.key);
  }
  return changed;
}

const allResolved = (tasks) => Object.values(tasks).every((t) => RESOLVED.has(t.status));

// Step keys that depend on `key`, directly or through other steps (start, planning base or condition)
function dependentsOf(steps, key) {
  const deps = new Set();
  const hit = (k) => k === key || deps.has(k);
  for (const s of steps || []) {
    if (s.key === key) continue;
    const refs = [s.start?.step, s.plan?.step, ...stepRefs(s.when), ...(s.tatOverrides || []).flatMap((o) => [...stepRefs(o.when)])];
    if (refs.some((k) => k && hit(k))) deps.add(s.key);
  }
  return deps;
}

function resetTask(t) {
  Object.assign(t, {
    status: "waiting",
    planned: null,
    plannedDay: null,
    actual: null,
    actualDay: null,
    activatedAt: null,
    resolvedAt: null,
    triggerAt: null,
    skipReason: null,
    autoClosed: false,
  });
}

// PC closes the entry (the "Status by PC" column): open tasks count as done now, the rest are skipped
function closeEntry(tasks, now) {
  const changed = new Set();
  for (const [key, t] of Object.entries(tasks)) {
    if (t.status === "pending") {
      Object.assign(t, { status: "done", actual: now, actualDay: dayKey(now), resolvedAt: now, autoClosed: true });
      changed.add(key);
    } else if (t.status === "waiting") {
      skipTask(t, "closed", now);
      changed.add(key);
    }
  }
  return changed;
}

// Undo closeEntry
function reopenEntry(tasks) {
  const changed = new Set();
  for (const [key, t] of Object.entries(tasks)) {
    if (t.status === "done" && t.autoClosed) {
      Object.assign(t, { status: "pending", actual: null, actualDay: null, resolvedAt: null, autoClosed: false });
      changed.add(key);
    } else if (t.status === "skipped" && t.skipReason === "closed") {
      resetTask(t);
      changed.add(key);
    }
  }
  return changed;
}

module.exports = {
  START_MODES,
  PLAN_FROM,
  FORMULA_OPS,
  RESOLVED,
  advance,
  allResolved,
  closeEntry,
  reopenEntry,
  dependentsOf,
  resetTask,
  computeFields,
  cleanValues,
  cleanValue,
  defaultPlan,
  triggerOf,
  fail,
};
