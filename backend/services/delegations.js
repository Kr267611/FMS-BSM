// Delegations: one-time tasks with a deadline, assigned by one person to another.
// Rules that keep the score honest:
//  - the doer may ask for a new deadline only before the deadline passes, at most MAX_REVISIONS times;
//    the assigner approves or rejects it
//  - once the deadline has passed, the doer and deadline cannot be changed and the task cannot be deleted (admin excepted)
//  - a reopened task keeps its deadline, so finishing it again counts as late
const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/User");
const { dayKey } = require("./dates");
const { can } = require("./permissions");
const { canSeeUser } = require("./scope");

const { PRIORITIES } = Task;
const MAX_REVISIONS = 2;
const LOG_LIMIT = 60;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const idStr = (v) => (v && v._id ? String(v._id) : v ? String(v) : "");
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const show = (d) => fmt.format(new Date(d));

async function activeUser(id, label, required) {
  if (!id) {
    if (required) throw fail(`Choose the ${label}`);
    return undefined;
  }
  if (!mongoose.isValidObjectId(id) || !(await User.exists({ _id: id, active: true }))) throw fail(`The ${label} must be an active user`);
  return String(id);
}

function parseDeadline(body) {
  const raw = body.planned ?? (body.date ? `${body.date}T${body.time || "18:00"}:00+05:30` : null);
  const d = raw ? new Date(raw) : null;
  if (!d || isNaN(d)) throw fail("Enter the deadline (date and time)");
  return d;
}

function addLog(task, by, action, note, now) {
  task.log = [...(task.log || []), { at: now, by, action, note }].slice(-LOG_LIMIT);
}

// The assigner, an admin, or a HOD / PC with edit rights over the doer
async function canManage(task, user) {
  if (user.role === "admin" || idStr(task.assignedBy) === String(user._id)) return true;
  return can(user, "delegation", "edit") && (await canSeeUser(user, task.doer));
}

async function load(taskId) {
  if (!mongoose.isValidObjectId(taskId)) throw fail("Invalid ID");
  const task = await Task.findById(taskId);
  if (!task || task.kind !== "delegation") throw fail("Delegation not found", 404);
  return task;
}

async function createDelegation(user, body = {}, { now = new Date() } = {}) {
  const title = text(body.title, 200);
  if (title.length < 3) throw fail("Write what has to be done");
  const planned = parseDeadline(body);
  if (planned.getTime() < now.getTime() - 60 * 1000) throw fail("The deadline is in the past");
  const priority = PRIORITIES.includes(body.priority) ? body.priority : "normal";
  const task = await Task.create({
    kind: "delegation",
    label: title,
    details: text(body.details, 4000),
    doer: await activeUser(body.doer, "doer", true),
    assignedBy: user._id,
    pc: await activeUser(body.pc, "PC"),
    auditor: await activeUser(body.auditor, "auditor"),
    priority,
    proofRequired: Boolean(body.proofRequired),
    status: "pending",
    planned,
    plannedDay: dayKey(planned),
    activatedAt: now,
    remarks: "",
    log: [{ at: now, by: user._id, action: "created", note: `Deadline ${show(planned)}` }],
  });
  return task;
}

async function updateDelegation(taskId, user, body = {}, { now = new Date() } = {}) {
  const task = await load(taskId);
  if (!(await canManage(task, user))) throw fail("Only the person who assigned this task can change it", 403);
  if (task.status !== "pending") throw fail("Only a pending task can be changed. Reopen it first.");
  const overdue = now > task.planned && user.role !== "admin";
  const notes = [];

  if (body.title !== undefined) {
    const title = text(body.title, 200);
    if (title.length < 3) throw fail("Write what has to be done");
    if (title !== task.label) notes.push("task name");
    task.label = title;
  }
  if (body.details !== undefined) {
    const details = text(body.details, 4000);
    if (details !== (task.details || "")) notes.push("details");
    task.details = details;
  }
  if (body.priority !== undefined && PRIORITIES.includes(body.priority) && body.priority !== task.priority) {
    notes.push(`priority ${body.priority}`);
    task.priority = body.priority;
  }
  if (body.proofRequired !== undefined) task.proofRequired = Boolean(body.proofRequired);
  if (body.pc !== undefined) task.pc = await activeUser(body.pc, "PC");
  if (body.auditor !== undefined) task.auditor = await activeUser(body.auditor, "auditor");

  if (body.doer !== undefined && idStr(body.doer) !== idStr(task.doer)) {
    if (overdue) throw fail("The deadline has passed, so the doer can no longer be changed");
    task.doer = await activeUser(body.doer, "doer", true);
    const u = await User.findById(task.doer).select("name").lean();
    notes.push(`doer → ${u?.name}`);
  }
  if (body.planned !== undefined || body.date !== undefined) {
    const planned = parseDeadline(body);
    if (planned.getTime() !== task.planned.getTime()) {
      if (overdue) throw fail("The deadline has passed, so it can no longer be moved");
      if (planned < now) throw fail("The new deadline is in the past");
      notes.push(`deadline ${show(task.planned)} → ${show(planned)}`);
      task.planned = planned;
      task.plannedDay = dayKey(planned);
    }
  }
  if (notes.length) addLog(task, user._id, "changed", notes.join("; "), now);
  await task.save();
  return { task, notes };
}

async function deleteDelegation(taskId, user, { now = new Date() } = {}) {
  const task = await load(taskId);
  if (!(await canManage(task, user))) throw fail("Only the person who assigned this task can delete it", 403);
  if (user.role !== "admin") {
    if (task.status !== "pending") throw fail("A finished task stays in the MIS and cannot be deleted");
    if (now > task.planned) throw fail("This task is already overdue, so it stays in the MIS. Only an admin can delete it.");
  }
  await Task.deleteOne({ _id: task._id });
  return task;
}

// The doer asks for more time, before the deadline
async function requestRevision(taskId, user, body = {}, { now = new Date() } = {}) {
  const task = await load(taskId);
  if (idStr(task.doer) !== String(user._id)) throw fail("Only the doer can ask for a new deadline", 403);
  if (task.status !== "pending") throw fail("This task is not pending");
  if (now > task.planned) throw fail("The deadline has already passed. A new deadline can only be asked for before it.");
  const revisions = task.revisions || [];
  if (revisions.some((r) => r.status === "pending")) throw fail("A request for a new deadline is already waiting for approval");
  if (revisions.filter((r) => r.status === "approved").length >= MAX_REVISIONS) {
    throw fail(`The deadline has already been moved ${MAX_REVISIONS} times`);
  }
  const to = parseDeadline(body);
  if (to <= task.planned) throw fail("The new deadline must be after the current one");
  const reason = text(body.reason, 500);
  if (reason.length < 3) throw fail("Write why more time is needed");
  task.revisions = [...revisions, { from: task.planned, to, reason, by: user._id, at: now, status: "pending" }];
  addLog(task, user._id, "asked for a new deadline", `${show(to)} – ${reason}`, now);
  await task.save();
  return task;
}

async function decideRevision(taskId, user, approve, body = {}, { now = new Date() } = {}) {
  const task = await load(taskId);
  if (!(await canManage(task, user))) throw fail("Only the person who assigned this task can decide", 403);
  const i = (task.revisions || []).findIndex((r) => r.status === "pending");
  if (i < 0) throw fail("There is no request waiting");
  const r = task.revisions[i];
  if (idStr(r.by) === String(user._id) && user.role !== "admin") throw fail("Someone else has to approve your own request", 403);
  const note = text(body.note, 500);
  Object.assign(r, { status: approve ? "approved" : "rejected", decidedBy: user._id, decidedAt: now, note });
  if (approve) {
    task.planned = r.to;
    task.plannedDay = dayKey(r.to);
  }
  task.markModified("revisions");
  addLog(task, user._id, approve ? "approved the new deadline" : "rejected the new deadline", `${show(r.to)}${note ? ` – ${note}` : ""}`, now);
  await task.save();
  return task;
}

// Not done properly: back to pending with the same deadline
async function reopenDelegation(taskId, user, body = {}, { now = new Date() } = {}) {
  const task = await load(taskId);
  if (!(await canManage(task, user))) throw fail("Only the person who assigned this task can reopen it", 403);
  if (task.status !== "done") throw fail("Only a finished task can be reopened");
  const remarks = text(body.remarks, 500);
  Object.assign(task, { status: "pending", actual: null, actualDay: null, resolvedAt: null, doneBy: null, values: undefined, reopenCount: (task.reopenCount || 0) + 1 });
  addLog(task, user._id, "reopened", remarks, now);
  await task.save();
  return task;
}

module.exports = { createDelegation, updateDelegation, deleteDelegation, requestRevision, decideRevision, reopenDelegation, canManage, addLog, MAX_REVISIONS };
