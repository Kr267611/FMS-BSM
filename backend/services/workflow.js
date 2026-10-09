// FMS entries and their steps in the database. The rules live in fms/engine.js (pure, unit-tested);
// this file loads an entry, applies one change and lets the engine move the other steps – all in one transaction.
const Process = require("../models/Process");
const Job = require("../models/Job");
const Task = require("../models/Task");
const User = require("../models/User");
const Setting = require("../models/Setting");
const { dayKey } = require("./dates");
const { normalizeCalendar, DEFAULT_CALENDAR } = require("./calendar");
const { withTransaction } = require("./tx");
const { can } = require("./permissions");
const { canSeeUser } = require("./scope");
const engine = require("./fms/engine");
const { resolveDoer, directory } = require("./fms/doers");

class WorkflowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function loadCalendar() {
  const s = await Setting.findOne({ key: "calendar" }).lean();
  return normalizeCalendar({ ...DEFAULT_CALENDAR, ...(s?.value || {}) });
}

async function loadDirectory(session) {
  const users = await User.find({ active: true }).select("name active").session(session || null).lean();
  return directory(users);
}

const stepKeyOf = (t) => t.stepKey || `s${(t.stepIndex ?? 0) + 1}`;
const labelOf = (process, step) => `${process.name} – ${step.name}`;

// Lower-case text of an entry's values, for the search box
function searchTextOf(values) {
  return Object.values(values || {})
    .flat()
    .filter((v) => typeof v === "string" || typeof v === "number")
    .join(" ")
    .toLowerCase()
    .slice(0, 2000);
}

// Entry values typed by a user -> clean values with the auto-calculated fields filled in
async function entryValues(process, data, startDate) {
  const values = engine.cleanValues(process.fields, data);
  for (const f of process.fields) {
    if (f.type === "user" && values[f.key] && !(await User.exists({ _id: values[f.key], active: true }))) {
      throw new WorkflowError(`"${f.label}" must be an active user`);
    }
  }
  return engine.computeFields(process.fields, values, startDate);
}

// Let the engine move the entry's steps at `now`, then save whatever changed
async function settle({ job, process, tasks, touched, session, now }) {
  const steps = new Map(process.steps.map((s) => [s.key, s]));
  for (const [k, t] of Object.entries(tasks)) {
    if (!steps.has(k) && t.status === "waiting") {
      Object.assign(t, { status: "skipped", skipReason: "removed", resolvedAt: now, triggerAt: null });
      touched.add(k);
    }
  }
  if (!job.closeStatus) job.status = "open";

  const [calendar, dir] = await Promise.all([loadCalendar(), loadDirectory(session)]);
  const changed = engine.advance({
    process,
    job,
    tasks,
    now,
    calendar,
    doerOf: (step, data) => resolveDoer(step.doer, data, dir),
    fallbackDoer: process.pc || job.createdBy,
  });
  for (const k of changed) {
    touched.add(k);
    const t = tasks[k];
    if (t.status === "pending" && steps.has(k)) {
      t.stepName = steps.get(k).name;
      t.label = labelOf(process, steps.get(k));
    }
  }
  if (engine.allResolved(tasks)) job.status = "closed";

  for (const k of touched) {
    const t = tasks[k];
    if (t.isNew) continue;
    if (t.isModified()) await t.save({ session });
  }
  if (job.isModified()) await job.save({ session });
}

// Load one entry, run fn, then settle – inside a transaction. Retried if two people change the entry at once.
async function withJob(jobId, fn, { now = new Date() } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction(async (session) => {
        const job = await Job.findById(jobId).session(session || null);
        if (!job) throw new WorkflowError("Entry not found", 404);
        const process = await Process.findById(job.process).session(session || null).lean();
        if (!process) throw new WorkflowError("FMS not found", 404);
        const tasks = {};
        for (const t of await Task.find({ job: job._id }).session(session || null)) tasks[stepKeyOf(t)] = t;
        const touched = new Set();
        const result = await fn({ job, process, tasks, touched, session, now });
        await settle({ job, process, tasks, touched, session, now });
        return result;
      });
    } catch (err) {
      if (err.name === "VersionError" && attempt < 2) continue;
      throw err;
    }
  }
}

async function createJob({ processId, data = {}, startDate, user, now = new Date() }) {
  const process = await Process.findById(processId).lean();
  if (!process) throw new WorkflowError("FMS not found", 404);
  if (!process.active) throw new WorkflowError("This FMS is a draft or inactive. Activate it in Master FMS first.");
  if (!process.steps.length) throw new WorkflowError("This FMS has no steps");

  const start = startDate ? new Date(startDate) : now;
  if (isNaN(start)) throw new WorkflowError("Invalid entry date");
  const values = await entryValues(process, data, start);

  return withTransaction(async (session) => {
    // Take the next entry number only once the entry is valid, so rejected entries leave no gaps
    const p = await Process.findByIdAndUpdate(process._id, { $inc: { jobCounter: 1 } }, { returnDocument: "after", session });
    const [job] = await Job.create(
      [{ process: p._id, jobNo: String(p.jobCounter), startDate: start, data: values, createdBy: user?._id, searchText: searchTextOf(values) }],
      { session }
    );
    const tasks = {};
    process.steps.forEach((step, i) => {
      tasks[step.key] = new Task({
        kind: "app",
        label: labelOf(process, step),
        process: process._id,
        job: job._id,
        stepIndex: i,
        stepKey: step.key,
        stepName: step.name,
        status: "waiting",
      });
    });
    const touched = new Set();
    await settle({ job, process, tasks, touched, session, now });
    await Task.insertMany(Object.values(tasks), { session });
    return job;
  });
}

// The doer, or someone allowed to edit entries for that doer (admin, or HOD / PC of their department)
async function checkCanAct(task, user) {
  if (!task || task.kind !== "app") throw new WorkflowError("Task not found", 404);
  const isOwner = String(task.doer) === String(user._id);
  if (!isOwner && !(can(user, "fmsEntries", "edit") && task.doer && (await canSeeUser(user, task.doer)))) {
    throw new WorkflowError("This task is assigned to someone else", 403);
  }
}

async function onTask(taskId, user, fn, opts) {
  const pre = await Task.findById(taskId).lean();
  await checkCanAct(pre, user);
  return withJob(
    pre.job,
    async (ctx) => {
      const task = ctx.tasks[stepKeyOf(pre)];
      if (!task) throw new WorkflowError("Task not found", 404);
      const step = ctx.process.steps.find((s) => s.key === stepKeyOf(pre));
      const result = await fn({ ...ctx, task, step });
      ctx.touched.add(stepKeyOf(pre));
      return result;
    },
    opts
  );
}

// Done: Actual = now with the step's fields (Status, Action Taken…); the engine starts what comes next
async function markDone(taskId, user, { remarks = "", values, now } = {}) {
  return onTask(
    taskId,
    user,
    async ({ task, step, now: at }) => {
      if (task.status !== "pending") throw new WorkflowError("This task cannot be marked done right now");
      const clean = engine.cleanValues(step?.fields || [], values);
      Object.assign(task, {
        status: "done",
        actual: at,
        actualDay: dayKey(at),
        resolvedAt: at,
        values: Object.keys(clean).length ? clean : undefined,
        remarks: String(remarks || "").trim().slice(0, 1000),
        doneBy: user._id,
      });
      task.markModified("values");
      return task;
    },
    { now: now || new Date() }
  );
}

// Not Required: excluded from the score, like "No Req" in the sheets
async function markNotRequired(taskId, user, remarks = "", { now } = {}) {
  return onTask(
    taskId,
    user,
    async ({ task, now: at }) => {
      if (task.status !== "pending") throw new WorkflowError("Only a pending task can be marked Not Required");
      Object.assign(task, { status: "na", resolvedAt: at, remarks: String(remarks || "").trim().slice(0, 1000), doneBy: user._id });
      return task;
    },
    { now: now || new Date() }
  );
}

// Reopen a finished step. Steps that followed from it are worked out again,
// so this is refused once one of them has been completed.
async function reopen(taskId, user) {
  if (!can(user, "fmsEntries", "edit")) throw new WorkflowError("You don't have permission to reopen tasks", 403);
  return onTask(taskId, user, async ({ task, job, process, tasks, touched }) => {
    if (!["done", "na"].includes(task.status)) throw new WorkflowError("This task is already open");
    if (job.closeStatus) throw new WorkflowError("This entry was closed by the PC. Reopen the entry first.");
    const deps = engine.dependentsOf(process.steps, stepKeyOf(task));
    for (const k of deps) {
      if (tasks[k] && ["done", "na"].includes(tasks[k].status)) {
        throw new WorkflowError(`"${tasks[k].stepName}" is already complete. Reopen that step first.`);
      }
    }
    for (const k of deps) {
      if (tasks[k] && tasks[k].status !== "waiting") {
        engine.resetTask(tasks[k]);
        touched.add(k);
      }
    }
    Object.assign(task, { status: "pending", actual: null, actualDay: null, resolvedAt: null, doneBy: null });
    return task;
  });
}

// PC closes the entry with a status ("Status by PC"): open steps count as done now, the rest are skipped
async function closeJob(jobId, user, { status, remarks = "" } = {}) {
  if (!can(user, "fmsEntries", "edit")) throw new WorkflowError("You don't have permission to close entries", 403);
  return withJob(jobId, async ({ job, process, tasks, touched, now }) => {
    if (job.closeStatus) throw new WorkflowError("This entry is already closed");
    const options = process.closure?.options || [];
    const chosen = options.find((o) => o.toLowerCase() === String(status || "").trim().toLowerCase());
    if (options.length && !chosen) throw new WorkflowError(`Choose a ${process.closure?.label || "status"}`);
    Object.assign(job, {
      closeStatus: chosen || String(status || "Closed").trim().slice(0, 120),
      closeRemarks: String(remarks || "").trim().slice(0, 1000),
      closedBy: user._id,
      closedAt: now,
      status: "closed",
    });
    for (const k of engine.closeEntry(tasks, now)) touched.add(k);
    return job;
  });
}

async function reopenJob(jobId, user) {
  if (!can(user, "fmsEntries", "edit")) throw new WorkflowError("You don't have permission to reopen entries", 403);
  return withJob(jobId, async ({ job, tasks, touched }) => {
    if (!job.closeStatus) throw new WorkflowError("This entry was not closed by the PC");
    Object.assign(job, { closeStatus: null, closeRemarks: null, closedBy: null, closedAt: null, status: "open" });
    for (const k of engine.reopenEntry(tasks)) touched.add(k);
    return job;
  });
}

// Correct an entry's values. Steps skipped because of a condition are checked again with the new values.
async function updateJobData(jobId, user, data) {
  if (!can(user, "fmsEntries", "edit")) throw new WorkflowError("You don't have permission to edit entries", 403);
  return withJob(jobId, async ({ job, process, tasks, touched }) => {
    const values = await entryValues(process, data, job.startDate);
    job.data = values;
    job.markModified("data");
    job.searchText = searchTextOf(values);
    for (const s of process.steps) {
      const t = tasks[s.key];
      if (t?.status === "skipped" && ["condition", "dependency", "no date", "cancelled"].includes(t.skipReason)) {
        engine.resetTask(t);
        touched.add(s.key);
      }
    }
    return job;
  });
}

// Bring one entry up to date at `now` (used by the demo data and the sweep)
const touchJob = (jobId, now = new Date()) => withJob(jobId, async () => {}, { now });

// Start escalation steps whose time has come. Runs from the scheduler, from cron and before lists are shown.
async function sweepDue(now = new Date()) {
  const jobIds = await Task.distinct("job", { status: "waiting", triggerAt: { $ne: null, $lte: now } });
  let moved = 0;
  for (const id of jobIds) {
    try {
      await touchJob(id, now);
      moved++;
    } catch (err) {
      console.error("FMS sweep:", err.message);
    }
  }
  return moved;
}

// What would happen to a new entry: calculated fields, and who gets each step that starts at once
async function previewJob({ processId, data = {}, startDate, now = new Date() }) {
  const process = await Process.findById(processId).lean();
  if (!process) throw new WorkflowError("FMS not found", 404);
  const start = startDate ? new Date(startDate) : now;
  if (isNaN(start)) throw new WorkflowError("Invalid entry date");
  let values;
  try {
    values = engine.computeFields(process.fields, engine.cleanValues(process.fields, data, { requireAll: false }), start);
  } catch {
    values = engine.computeFields(process.fields, {}, start);
  }
  const [calendar, dir] = await Promise.all([loadCalendar(), loadDirectory()]);
  const job = { startDate: start, data: values };
  const tasks = Object.fromEntries(process.steps.map((s) => [s.key, { status: "waiting" }]));
  const doerOf = (step, d) => resolveDoer(step.doer, d, dir);
  engine.advance({ process, job, tasks, now: start, calendar, doerOf, fallbackDoer: process.pc });
  const ids = process.steps.map((s) => tasks[s.key].doer || doerOf(s, values)).filter(Boolean);
  const names = new Map((await User.find({ _id: { $in: ids } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  return {
    values,
    steps: process.steps.map((s) => {
      const t = tasks[s.key];
      const doer = t.doer || doerOf(s, values);
      return {
        key: s.key,
        name: s.name,
        status: t.status,
        planned: t.planned || null,
        skipReason: t.skipReason || null,
        doer: doer ? { _id: String(doer), name: names.get(String(doer)) || "?" } : null,
      };
    }),
  };
}

module.exports = {
  entryValues,
  createJob,
  markDone,
  markNotRequired,
  reopen,
  closeJob,
  reopenJob,
  updateJobData,
  sweepDue,
  touchJob,
  previewJob,
  loadCalendar,
  WorkflowError,
};
