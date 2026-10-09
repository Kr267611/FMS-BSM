const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const { auth } = require("../middleware/auth");
const wf = require("../services/workflow");
const other = require("../services/taskActions");
const autoComplete = require("../services/autoComplete");
const { sweepSoon } = require("../services/sweep");
const { todayKey } = require("../services/dates");
const { canSeeUser } = require("../services/scope");
const { audit } = require("../services/audit");

const router = express.Router();

// ?kind=fms|checklist|delegation|sheet narrows the list; FMS steps are stored as kind "app"
const KINDS = { fms: "app", checklist: "checklist", delegation: "delegation", sheet: "sheet" };

// A doer's task list. HOD / PC / admin can pass ?doer= for someone they oversee.
router.get("/", auth, async (req, res) => {
  const doer = req.query.doer || req.user._id;
  if (!mongoose.isValidObjectId(doer)) return res.status(400).json({ message: "Invalid doer" });
  if (String(doer) !== String(req.user._id) && !(await canSeeUser(req.user, doer))) {
    return res.status(403).json({ message: "You can only see tasks of people in your department" });
  }
  await sweepSoon(); // due escalations and today's checklist tasks, so the list is up to date

  const status = req.query.status || "pending";
  const filter = { doer };
  if (status === "pending") filter.status = "pending";
  else if (status === "done") filter.status = { $in: ["done", "na", "expired"] };
  if (KINDS[req.query.kind]) filter.kind = KINDS[req.query.kind];

  const limit = status === "pending" ? 1000 : 200;
  const sort = status === "pending" ? { plannedDay: 1, planned: 1 } : { resolvedAt: -1, actual: -1, updatedAt: -1 };

  const tasks = await Task.find(filter)
    .sort(sort)
    .limit(limit)
    .populate("job", "jobNo data startDate status closeStatus")
    .populate({ path: "process", select: "name fields steps.key steps.name steps.how steps.videoLink steps.fields" })
    .populate("sheetLink", "name tabName spreadsheetId")
    .populate({ path: "checklist", select: "name how videoLink fields frequency group", populate: { path: "group", select: "name" } })
    .populate("assignedBy", "name")
    .select("-log")
    .lean();

  // Attach the step's instructions and fields (what the doer fills) instead of the whole FMS.
  // Populated processes are shared between tasks, so each task gets its own small copy.
  for (const t of tasks) {
    if (t.kind === "delegation") t.formFields = t.proofRequired ? [other.PROOF_FIELD] : [];
    if (t.kind === "checklist") t.formFields = t.checklist?.fields || [];
    if (!t.process) continue;
    const { _id, name, fields, steps = [] } = t.process;
    const key = t.stepKey || `s${(t.stepIndex ?? 0) + 1}`;
    t.step = steps.find((s) => s.key === key) || null;
    t.process = { _id, name, fields };
  }
  res.json({ today: todayKey(), tasks });
});

// FMS steps move the steps after them (workflow.js); checklist and delegation tasks stand alone
async function kindOf(id) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error("Invalid ID");
    err.status = 400;
    throw err;
  }
  const t = await Task.findById(id).select("kind").lean();
  if (!t) {
    const err = new Error("Task not found");
    err.status = 404;
    throw err;
  }
  if (t.kind === "sheet") {
    const err = new Error("This task comes from a Google Sheet. Update it in the sheet.");
    err.status = 400;
    throw err;
  }
  return t.kind;
}

router.post("/:id/done", auth, async (req, res) => {
  const kind = await kindOf(req.params.id);
  const opts = { remarks: req.body?.remarks || "", values: req.body?.values };
  const task = kind === "app" ? await wf.markDone(req.params.id, req.user, opts) : await other.markDone(req.params.id, req.user, opts);
  const status = task.values?.status ? ` (${task.values.status})` : "";
  audit(req, "task.done", { entity: "Task", entityId: task._id, summary: `${task.label}${status}` });
  // FMS Auto Complete: entries in other FMS that this step starts
  const auto = kind === "app" ? await autoComplete.runFor(task, req.user) : [];
  for (const a of auto) audit(req, a.ok ? "job.auto_complete" : "job.auto_complete_failed", { entity: "Job", entityId: a.jobId, summary: a.ok ? `${a.rule}: ${a.process} #${a.jobNo}` : `${a.rule}: ${a.error}` });
  res.json({ ...(task.toObject ? task.toObject() : task), autoComplete: auto });
});

router.post("/:id/not-required", auth, async (req, res) => {
  const kind = await kindOf(req.params.id);
  const remarks = req.body?.remarks || "";
  const task = kind === "app" ? await wf.markNotRequired(req.params.id, req.user, remarks) : await other.markNotRequired(req.params.id, req.user, remarks);
  audit(req, "task.not_required", { entity: "Task", entityId: task._id, summary: `${task.label}: ${task.remarks}` });
  res.json(task);
});

router.post("/:id/reopen", auth, async (req, res) => {
  const kind = await kindOf(req.params.id);
  const task = kind === "app" ? await wf.reopen(req.params.id, req.user) : await other.reopen(req.params.id, req.user, { remarks: req.body?.remarks });
  audit(req, "task.reopen", { entity: "Task", entityId: task._id, summary: task.label });
  res.json(task);
});

module.exports = router;
