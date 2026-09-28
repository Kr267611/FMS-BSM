// Validates a Master FMS sent by the builder and returns the clean definition that is saved.
// Pure: the caller passes the ids of active users and departments.
const { OPS, NO_VALUE_OPS, isGroup } = require("./conditions");
const { START_MODES, PLAN_FROM, FORMULA_OPS, fail } = require("./engine");
const { MODES } = require("../calendar");
const { FIELD_TYPES } = require("../../models/Process");

const STEP_FIELD_TYPES = FIELD_TYPES.filter((t) => t !== "user");
const TAT_UNITS = ["minutes", "hours", "days"];
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const ID_RE = /^[a-f0-9]{24}$/i;

const text = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const idOf = (v) => {
  const s = v && typeof v === "object" && v._id ? String(v._id) : v ? String(v) : "";
  return ID_RE.test(s) ? s : undefined;
};
const isLink = (s) => /^https?:\/\/\S+$/i.test(s);

function slug(label) {
  let s = String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
  if (!s) s = "field";
  if (!/^[a-z]/.test(s)) s = "f_" + s;
  return s;
}

function uniqueKey(wanted, seen) {
  let key = wanted;
  for (let n = 2; seen.has(key); n++) key = `${wanted}_${n}`;
  seen.add(key);
  return key;
}

function cleanOptions(list) {
  const out = [];
  const seen = new Set();
  for (const o of Array.isArray(list) ? list : String(list || "").split(",")) {
    const v = text(o, 120);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.slice(0, 500);
}

function cleanFields(list, types, where) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((f) => f && text(f.label))
    .map((f) => {
      const label = text(f.label, 80);
      const key = uniqueKey(KEY_RE.test(f.key || "") ? f.key : slug(label), seen);
      const type = types.includes(f.type) ? f.type : "text";
      const options = type === "select" || type === "text" ? cleanOptions(f.options) : [];
      if (type === "select" && !options.length) throw fail(`Add the options for "${label}" (${where})`);
      const out = { key, label, type, options, required: Boolean(f.required), help: text(f.help, 300) };
      if (f.formula?.op) out.formula = { op: f.formula.op, a: text(f.formula.a, 40), b: text(f.formula.b, 40) };
      return out;
    });
}

// Auto-calculated entry fields: numbers from earlier fields, or days between two dates
function checkFormulas(fields) {
  fields.forEach((f, i) => {
    if (!f.formula) return;
    const where = `"${f.label}"`;
    if (!FORMULA_OPS.includes(f.formula.op)) throw fail(`Choose a calculation for ${where}`);
    const earlier = new Map(fields.slice(0, i).map((x) => [x.key, x]));
    const wantDates = f.formula.op === "days";
    for (const ref of [f.formula.a, f.formula.b]) {
      if (ref === "@entry" && wantDates) continue;
      const src = earlier.get(ref);
      if (!src) throw fail(`${where} must be calculated from fields above it`);
      const ok = wantDates ? ["date", "datetime"].includes(src.type) : src.type === "number" || src.formula;
      if (!ok) throw fail(`${where} uses "${src.label}", which is not a ${wantDates ? "date" : "number"} field`);
    }
    f.type = "number";
    f.required = false;
    f.options = [];
  });
}

// scope = { where, fieldKeys: Set, steps: Map(key -> { name, fieldKeys: Set }) } – only earlier steps
function cleanCondition(c, scope, depth = 0) {
  if (!c || typeof c !== "object") return undefined;
  if (isGroup(c)) {
    if (depth > 3) throw fail(`The condition of ${scope.where} is nested too deeply`);
    const kind = Array.isArray(c.all) ? "all" : "any";
    const items = c[kind].map((x) => cleanCondition(x, scope, depth + 1)).filter(Boolean);
    return items.length ? { [kind]: items } : undefined;
  }
  if (!OPS.includes(c.op)) throw fail(`Choose a comparison in the condition of ${scope.where}`);
  const value = NO_VALUE_OPS.includes(c.op) ? undefined : typeof c.value === "number" ? c.value : text(c.value, 200);
  if (c.src === "step") {
    const st = scope.steps.get(c.step);
    if (!st) throw fail(`The condition of ${scope.where} must refer to a step that comes before it`);
    if (c.key !== "_status" && !st.fieldKeys.has(c.key)) {
      throw fail(`The condition of ${scope.where} refers to a field that step "${st.name}" does not have`);
    }
    return { src: "step", step: c.step, key: c.key, op: c.op, value };
  }
  if (!scope.fieldKeys.has(c.key)) throw fail(`The condition of ${scope.where} refers to an entry field that does not exist`);
  return { src: "field", key: c.key, op: c.op, value };
}

function cleanDoer(input, { fields, where, activeIds, strict }) {
  // v1 sent the doer's id directly
  const d = typeof input === "string" || (input && input._id && !input.mode) ? { mode: "fixed", user: idOf(input) } : input || {};
  const mode = ["fixed", "field", "map"].includes(d.mode) ? d.mode : "fixed";
  const out = { mode, hint: text(d.hint, 80) || undefined };
  const active = (id) => id && activeIds.has(String(id));
  const user = idOf(d.user);
  const fallback = idOf(d.fallback);

  if (mode === "fixed") {
    if (user && !active(user)) throw fail(`The doer of ${where} is inactive or was deleted`);
    if (!user && strict) throw fail(`Choose a doer for ${where}`);
    out.user = user;
    return out;
  }
  if (fallback && !active(fallback)) throw fail(`The fallback doer of ${where} is inactive or was deleted`);
  if (!fallback && strict) throw fail(`Choose a fallback doer for ${where} (used when no one else matches)`);
  out.fallback = fallback;

  const byKey = new Map(fields.map((f) => [f.key, f]));
  if (mode === "field") {
    const f = byKey.get(d.field);
    if (!f) throw fail(`Choose the entry field that holds the doer of ${where}`);
    out.field = f.key;
    return out;
  }
  const keys = (Array.isArray(d.keys) ? d.keys : []).filter((k) => byKey.has(k)).slice(0, 2);
  if (!keys.length) throw fail(`Choose the entry field(s) to look up the doer of ${where}`);
  out.keys = keys;
  out.map = (Array.isArray(d.map) ? d.map : [])
    .map((r) => ({
      match: keys.map((_, i) => text(r?.match?.[i], 80)),
      name: text(r?.name, 80),
      user: idOf(r?.user),
    }))
    .filter((r) => r.match[0] && (r.name || r.user))
    .slice(0, 3000);
  return out;
}

// body: what the builder sends. opts: { activeIds: Set of active user ids }
function normalizeProcess(body, { activeIds = new Set() } = {}) {
  const b = body || {};
  const name = text(b.name, 120);
  if (!name) throw fail("Enter a name for the FMS");
  const active = b.active === undefined ? true : Boolean(b.active);
  const strict = active; // a draft (inactive) FMS may be saved before every doer is known

  const fields = cleanFields(b.fields, FIELD_TYPES, "entry form");
  checkFormulas(fields);
  const fieldKeys = new Set(fields.map((f) => f.key));
  const dateFields = new Set(fields.filter((f) => ["date", "datetime"].includes(f.type)).map((f) => f.key));

  const rawSteps = Array.isArray(b.steps) ? b.steps : [];
  if (!rawSteps.length) throw fail("Add at least one step");
  if (rawSteps.length > 40) throw fail("An FMS can have at most 40 steps");

  // Keys first, so conditions can refer to steps by key
  const keySeen = new Set();
  const keys = rawSteps.map((s) => (KEY_RE.test(s?.key || "") && !keySeen.has(s.key) ? (keySeen.add(s.key), s.key) : null));
  let n = 1;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]) continue;
    while (keySeen.has(`s${n}`)) n++;
    keys[i] = `s${n}`;
    keySeen.add(keys[i]);
  }

  const earlier = new Map(); // key -> { name, fieldKeys }
  const steps = rawSteps.map((s, i) => {
    const stepName = text(s?.name, 120);
    if (!stepName) throw fail(`Enter a name for step ${i + 1}`);
    const where = `step ${i + 1} "${stepName}"`;
    const key = keys[i];

    // How it starts. v1 steps had no start: a plain sequence.
    let start;
    if (i === 0) start = { mode: "entry" };
    else if (!s.start?.mode) start = { mode: "afterDone", step: keys[i - 1] };
    else {
      if (!START_MODES.includes(s.start.mode)) throw fail(`Choose how ${where} starts`);
      start = { mode: s.start.mode };
      if (start.mode !== "entry") {
        if (!earlier.has(s.start.step)) throw fail(`${where} must start from a step that comes before it`);
        start.step = s.start.step;
      }
    }

    const scope = { where, fieldKeys, steps: earlier };
    const when = cleanCondition(s.when, scope);

    let plan;
    if (s.plan?.from) {
      if (!PLAN_FROM.includes(s.plan.from)) throw fail(`Choose what the planned date of ${where} counts from`);
      plan = { from: s.plan.from };
      if (plan.from.startsWith("step")) {
        if (!earlier.has(s.plan.step)) throw fail(`The planned date of ${where} must count from a step that comes before it`);
        plan.step = s.plan.step;
      }
      if (plan.from === "field") {
        if (!dateFields.has(s.plan.field)) throw fail(`Choose the date field the planned date of ${where} counts from`);
        plan.field = s.plan.field;
      }
    }

    const tat = Number(s.tat);
    if (!isFinite(tat)) throw fail(`Enter a valid TAT for ${where}`);
    if (tat < 0 && plan?.from !== "field") throw fail(`TAT of ${where} can be negative only when counting from a date field (T − X)`);
    const tatUnit = TAT_UNITS.includes(s.tatUnit) ? s.tatUnit : "days";

    const tatOverrides = (Array.isArray(s.tatOverrides) ? s.tatOverrides : [])
      .map((o) => {
        const w = cleanCondition(o?.when, { ...scope, where: `a TAT rule of ${where}` });
        if (!w) return null;
        const t = Number(o.tat);
        if (!isFinite(t) || (t < 0 && plan?.from !== "field")) throw fail(`Enter a valid TAT in the TAT rules of ${where}`);
        return { when: w, tat: t, unit: TAT_UNITS.includes(o.unit) ? o.unit : tatUnit };
      })
      .filter(Boolean)
      .slice(0, 20);

    const stepFields = cleanFields(s.fields, STEP_FIELD_TYPES, where);
    for (const f of stepFields) delete f.formula;

    const videoLink = text(s.videoLink, 500);
    if (videoLink && !isLink(videoLink)) throw fail(`The video link of ${where} must start with http:// or https://`);

    const out = {
      _id: idOf(s._id),
      key,
      name: stepName,
      how: text(s.how, 2000),
      videoLink,
      doer: cleanDoer(s.doer, { fields, where, activeIds, strict }),
      start,
      when,
      plan,
      tat,
      tatUnit,
      tatOverrides,
      fields: stepFields,
    };
    earlier.set(key, { name: stepName, fieldKeys: new Set(stepFields.map((f) => f.key)) });
    return out;
  });

  const sopLink = text(b.sopLink, 500);
  if (sopLink && !isLink(sopLink)) throw fail("The SOP link must start with http:// or https://");
  const pc = idOf(b.pc);
  if (pc && !activeIds.has(pc)) throw fail("The PC must be an active user");

  const closure = {
    enabled: b.closure?.enabled === undefined ? true : Boolean(b.closure.enabled),
    label: text(b.closure?.label, 60) || "Status by PC",
    options: cleanOptions(b.closure?.options).slice(0, 20),
  };
  if (closure.enabled && !closure.options.length) closure.options = ["Closed"];

  return {
    name,
    description: text(b.description, 2000),
    sopLink,
    pc,
    department: idOf(b.department),
    calendar: { mode: MODES.includes(b.calendar?.mode) ? b.calendar.mode : b.skipSundays ? "calendar_skip" : "working" },
    fields,
    steps,
    closure,
    active,
    version: 2,
  };
}

module.exports = { normalizeProcess, cleanCondition, slug, STEP_FIELD_TYPES };
