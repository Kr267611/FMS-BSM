// FMS Auto Complete: a finished step creates an entry in another FMS.
// Runs after the step is saved; a failure (e.g. the target FMS is a draft) is recorded, never undoes the Done.
// Chains stop after MAX_DEPTH entries, so two rules pointing at each other cannot loop for ever.
const AutoComplete = require("../models/AutoComplete");
const Process = require("../models/Process");
const Job = require("../models/Job");
const Task = require("../models/Task");
const { cleanCondition } = require("./fms/definition");
const { evaluate } = require("./fms/conditions");
const wf = require("./workflow");

const MAX_DEPTH = 3;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function cleanRule(body = {}) {
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) throw fail("Give the rule a name");
  const src = await Process.findById(body.source?.process).lean();
  if (!src) throw fail("Choose the FMS whose step starts it");
  const stepIndex = src.steps.findIndex((s) => s.key === body.source?.step);
  if (stepIndex < 0) throw fail("Choose the step that starts it");
  const target = await Process.findById(body.target).lean();
  if (!target) throw fail("Choose the FMS where the entry is created");
  if (String(target._id) === String(src._id)) throw fail("The new entry must go to a different FMS");

  // the condition may read the entry fields and the steps up to and including this one
  const steps = new Map(src.steps.slice(0, stepIndex + 1).map((s) => [s.key, { name: s.name, fieldKeys: new Set((s.fields || []).map((f) => f.key)) }]));
  const when = cleanCondition(body.when, { where: "this rule", fieldKeys: new Set(src.fields.map((f) => f.key)), steps });

  const step = src.steps[stepIndex];
  const targetKeys = new Set(target.fields.filter((f) => !f.formula?.op).map((f) => f.key));
  const map = [];
  for (const m of Array.isArray(body.map) ? body.map : []) {
    if (!m?.to || !m.from) continue;
    if (!targetKeys.has(m.to)) throw fail(`"${m.to}" is not a field of ${target.name}`);
    if (m.from === "entry" && !src.fields.some((f) => f.key === m.key)) throw fail(`"${m.key}" is not an entry field of ${src.name}`);
    if (m.from === "step" && !(step.fields || []).some((f) => f.key === m.key)) throw fail(`Step "${step.name}" has no field "${m.key}"`);
    if (!["entry", "step", "fixed", "entryNo"].includes(m.from)) throw fail("Choose where each value comes from");
    map.push({ to: m.to, from: m.from, key: m.from === "entry" || m.from === "step" ? m.key : undefined, value: m.from === "fixed" ? String(m.value ?? "").slice(0, 500) : undefined });
  }
  const missing = target.fields.filter((f) => f.required && !f.formula?.op && !map.some((m) => m.to === f.key));
  if (missing.length) throw fail(`Fill these required fields of ${target.name}: ${missing.map((f) => f.label).join(", ")}`);
  return { name, active: body.active !== false, source: { process: src._id, step: step.key }, when, target: target._id, map };
}

// After an FMS step is done: create the entries its rules ask for. Returns what happened, per rule.
async function runFor(task, user, now = new Date()) {
  if (task.kind !== "app" || task.status !== "done") return [];
  const rules = await AutoComplete.find({ active: true, "source.process": task.process, "source.step": task.stepKey }).lean();
  if (!rules.length) return [];
  const job = await Job.findById(task.job).lean();
  if (!job) return [];
  const depth = (job.origin?.depth || 0) + 1;
  if (depth > MAX_DEPTH) return rules.map((r) => ({ rule: r.name, ok: false, error: `stopped: more than ${MAX_DEPTH} linked entries in a row` }));
  const source = await Process.findById(task.process).select("name").lean();
  const tasks = await Task.find({ job: job._id }).lean();
  const ctx = { data: job.data || {}, steps: Object.fromEntries(tasks.map((t) => [t.stepKey, t])) };

  const results = [];
  for (const r of rules) {
    if (r.when && !evaluate(r.when, ctx, true)) continue;
    const data = {};
    for (const m of r.map) {
      const v = m.from === "entry" ? job.data?.[m.key] : m.from === "step" ? task.values?.[m.key] : m.from === "fixed" ? m.value : `${source?.name} #${job.jobNo}`;
      if (v !== undefined && v !== null && v !== "") data[m.to] = v;
    }
    try {
      const made = await wf.createJob({ processId: r.target, data, startDate: now, user, now });
      await Job.updateOne({ _id: made._id }, { origin: { job: job._id, process: task.process, step: task.stepKey, rule: r._id, depth } });
      const target = await Process.findById(r.target).select("name").lean();
      results.push({ rule: r.name, ok: true, process: target?.name, jobNo: made.jobNo, jobId: made._id });
    } catch (err) {
      results.push({ rule: r.name, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { cleanRule, runFor, MAX_DEPTH };
