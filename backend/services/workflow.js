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

// Nayi job: har step ka Task banta hai. Pehle step ka Planned = start date + TAT,
// baaki steps "waiting" rehte hain jab tak pichhla step Done na ho.
async function createJob({ processId, data = {}, startDate, user }) {
  const found = await Process.findOne({ _id: processId, active: true }).lean();
  if (!found) throw new WorkflowError("Process nahi mila", 404);
  if (!found.steps.length) throw new WorkflowError("Is process me koi step nahi hai");

  for (const f of found.fields) {
    if (f.required && (data[f.key] === undefined || data[f.key] === "")) {
      throw new WorkflowError(`"${f.label}" bharna zaroori hai`);
    }
  }

  const start = startDate ? new Date(startDate) : new Date();
  if (isNaN(start)) throw new WorkflowError("Start date galat hai");

  // Sab sahi hone ke baad hi job number aage badhao (galat entry number na khaye)
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
  if (!task || task.kind !== "app") throw new WorkflowError("Task nahi mila", 404);
  const isOwner = String(task.doer) === String(user._id);
  if (!isOwner && user.role !== "admin") {
    throw new WorkflowError("Ye task aapka nahi hai", 403);
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

// Doer "Done" karta hai: Actual = abhi, agla step Planned = Actual + TAT
async function markDone(taskId, user, remarks = "") {
  const task = await loadAppTask(taskId, user);
  if (task.status !== "pending") throw new WorkflowError("Ye task abhi Done nahi ho sakta");

  task.actual = new Date();
  task.actualDay = dayKey(task.actual);
  task.status = "done";
  task.remarks = remarks;
  task.doneBy = user._id;
  await task.save();

  await activateNext(task, task.actual);
  return task;
}

// "Not Required" - score me nahi gina jata (sheet ke "No Req" jaisa)
async function markNotRequired(taskId, user, remarks = "") {
  const task = await loadAppTask(taskId, user);
  if (task.status !== "pending") throw new WorkflowError("Sirf pending task Not Required ho sakta hai");

  task.status = "na";
  task.remarks = remarks;
  task.doneBy = user._id;
  await task.save();

  await activateNext(task, new Date());
  return task;
}

// Admin galti se Done hua task wapas khol sakta hai (jab tak agla step shuru na hua ho)
async function reopen(taskId, user) {
  if (user.role !== "admin") throw new WorkflowError("Sirf admin task reopen kar sakta hai", 403);
  const task = await loadAppTask(taskId, user);
  if (!["done", "na"].includes(task.status)) throw new WorkflowError("Ye task pehle se khula hai");

  const next = await Task.findOne({ job: task.job, stepIndex: task.stepIndex + 1 });
  if (next && ["done", "na"].includes(next.status)) {
    throw new WorkflowError("Agla step already complete hai - pehle usse reopen karein");
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
