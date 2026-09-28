// Step run conditions, e.g. "(Repeat Frq > 2 OR Rate > 3000) AND Step 3 Status != Permanent Solved".
//
// A condition is a group { all: [...] } or { any: [...] }; each item is a rule or another group.
//   { src: "field", key: "repeat_frq", op: ">", value: 2 }                     – an entry field
//   { src: "step", step: "s3", key: "status", op: "!=", value: "Permanent Solved" } – a value a doer filled in a step
//   { src: "step", step: "s3", key: "_status", op: "=", value: "done" }        – the step's own status
// Text compares ignore case and extra spaces, so " Permenant Solved" and "permenant solved" match.

const OPS = ["=", "!=", ">", ">=", "<", "<=", "contains", "notContains", "empty", "notEmpty", "in", "notIn"];
const NO_VALUE_OPS = ["empty", "notEmpty"];
const RESOLVED = ["done", "na", "skipped"];

const norm = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
const num = (v) => (typeof v === "number" ? v : isBlank(v) ? NaN : Number(String(v).replace(/,/g, "")));
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map(norm).filter(Boolean);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v ?? ""));

function compare(left, op, right) {
  switch (op) {
    case "empty":
      return isBlank(left);
    case "notEmpty":
      return !isBlank(left);
    case "=":
    case "!=": {
      const a = num(left);
      const b = num(right);
      const same = !isNaN(a) && !isNaN(b) ? a === b : norm(left) === norm(right);
      return op === "=" ? same : !same;
    }
    case ">":
    case ">=":
    case "<":
    case "<=": {
      let a = num(left);
      let b = num(right);
      if (isNaN(a) || isNaN(b)) {
        if (!(isDay(left) && isDay(right))) return false; // "2026-09-10" dates compare as text
        a = String(left).slice(0, 10);
        b = String(right).slice(0, 10);
      }
      if (op === ">") return a > b;
      if (op === ">=") return a >= b;
      if (op === "<") return a < b;
      return a <= b;
    }
    case "contains":
      return norm(left).includes(norm(right));
    case "notContains":
      return !norm(left).includes(norm(right));
    case "in":
      return list(right).includes(norm(left));
    case "notIn":
      return !list(right).includes(norm(left));
    default:
      return false;
  }
}

const isGroup = (c) => c && (Array.isArray(c.all) || Array.isArray(c.any));

// ctx = { data: entry values, steps: { [stepKey]: { status, values } } }
// final = true : answer with what is known now (used when the step is due to start).
// final = false: null while the answer can still change, i.e. the rule reads a step that is not finished.
function evaluate(cond, ctx, final = true) {
  if (!cond) return true;
  if (isGroup(cond)) {
    const items = cond.all || cond.any;
    if (!items.length) return true;
    const results = items.map((c) => evaluate(c, ctx, final));
    if (cond.all) {
      if (results.includes(false)) return false;
      return results.includes(null) ? null : true;
    }
    if (results.includes(true)) return true;
    return results.includes(null) ? null : false;
  }
  let left;
  if (cond.src === "step") {
    const t = ctx.steps?.[cond.step];
    if (!final && !(t && RESOLVED.includes(t.status))) return null;
    left = cond.key === "_status" ? t?.status : t?.values?.[cond.key];
  } else {
    left = ctx.data?.[cond.key];
  }
  return compare(left, cond.op, cond.value);
}

// Step keys a condition reads (for validation and reopen)
function stepRefs(cond, out = new Set()) {
  if (!cond) return out;
  if (isGroup(cond)) (cond.all || cond.any).forEach((c) => stepRefs(c, out));
  else if (cond.src === "step" && cond.step) out.add(cond.step);
  return out;
}

module.exports = { OPS, NO_VALUE_OPS, evaluate, compare, stepRefs, isGroup, norm, num, isBlank };
