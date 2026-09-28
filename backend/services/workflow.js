const Process = require("../models/Process");
const Job = require("../models/Job");
const Task = require("../models/Task");
const { dayKey, addTat } = require("./dates");

class WorkflowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function setPlanned(task, base) {
  task.planned = addTat(base, task.tat, task.tatUnit, task.skipSundays);
  task.plannedDay = dayKey(task.planned);
  task.status = "pending";
}

// A new job creates one Task per step. Step 1 is planned at start date + TAT;
// later steps stay "waiting" until the previous step is done.
async function createJob({ processId, data = {}, startDate, user }) {
  const found = await Process.findOne({ _id: processId, active: true }).lean();
  if (!found) throw new WorkflowError("Process not found", 404);
  if (!found.steps.length) throw new WorkflowError("This process has no steps");

  for (const f of found.fields) {
    if (f.required && (data[f.key] === undefined || data[f.key] === "")) {
      throw new WorkflowError(`"${f.label}" is required`);
    }
  }

  const start = startDate ? new Date(startDate) : new Date();
  if (isNaN(start)) throw new WorkflowError("Invalid start date");

  // Take the next job number only once the entry is valid, so rejected entries leave no gaps
  const process = await Process.findByIdAndUpdate(found._id, { $inc: { jobCounter: 1 } }, { new: true });

  const job = await Job.create({
    process: process._id,
    jobNo: String(process.jobCounter),
    startDate: start,
    data,
    createdBy: user?._id,
  });

  const tasks = process.steps.map((step, i) => {
    const task = new Task({
      kind: "app",
      label: `${process.name} – ${step.name}`,
      doer: step.doer,
      process: process._id,
      job: job._id,
      stepIndex: i,
      stepName: step.name,
      tat: step.tat,
      tatUnit: step.tatUnit,
      skipSundays: process.skipSundays,
      status: "waiting",
    });
    if (i === 0) setPlanned(task, start);
    return task;
  });
  await Task.insertMany(tasks);

  return job;
}

async function loadAppTask(taskId, user) {
  const task = await Task.findById(taskId);
  if (!task || task.kind !== "app") throw new WorkflowError("Task not found", 404);
  const isOwner = String(task.doer) === String(user._id);
  if (!isOwner && user.role !== "admin") {
    throw new WorkflowError("This task is assigned to someone else", 403);
  }
  return task;
}

async function activateNext(task, base) {
  const next = await Task.findOne({ job: task.job, stepIndex: task.stepIndex + 1 });
  if (!next) {
    await Job.updateOne({ _id: task.job }, { status: "closed" });
    return null;
  }
  setPlanned(next, base);
  await next.save();
  return next;
}

// Done: Actual = now, and the next step is planned at Actual + its TAT
async function markDone(taskId, user, remarks = "") {
  const task = await loadAppTask(taskId, user);
  if (task.status !== "pending") throw new WorkflowError("This task cannot be marked done right now");

  task.actual = new Date();
  task.actualDay = dayKey(task.actual);
  task.status = "done";
  task.remarks = remarks;
  task.doneBy = user._id;
  await task.save();

  await activateNext(task, task.actual);
  return task;
}

// Not Required: excluded from the score, like "No Req" in the sheets
async function markNotRequired(taskId, user, remarks = "") {
  const task = await loadAppTask(taskId, user);
  if (task.status !== "pending") throw new WorkflowError("Only a pending task can be marked Not Required");

  task.status = "na";
  task.remarks = remarks;
  task.doneBy = user._id;
  await task.save();

  await activateNext(task, new Date());
  return task;
}

// An admin can reopen a completed task, as long as the next step has not been completed
async function reopen(taskId, user) {
  if (user.role !== "admin") throw new WorkflowError("Only an admin can reopen a task", 403);
  const task = await loadAppTask(taskId, user);
  if (!["done", "na"].includes(task.status)) throw new WorkflowError("This task is already open");

  const next = await Task.findOne({ job: task.job, stepIndex: task.stepIndex + 1 });
  if (next && ["done", "na"].includes(next.status)) {
    throw new WorkflowError("The next step is already complete. Reopen that step first.");
  }
  if (next) {
    next.status = "waiting";
    next.planned = undefined;
    next.plannedDay = undefined;
    await next.save();
  }

  task.status = "pending";
  task.actual = undefined;
  task.actualDay = undefined;
  task.doneBy = undefined;
  await task.save();
  await Job.updateOne({ _id: task.job }, { status: "open" });
  return task;
}

module.exports = { createJob, markDone, markNotRequired, reopen, WorkflowError };
