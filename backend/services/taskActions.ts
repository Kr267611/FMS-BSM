// Done / Not Required / Reopen for checklist and delegation tasks.
// FMS steps go through workflow.js instead, because finishing a step moves the steps after it.
import mongoose = require("mongoose");
import Task = require("../models/Task");
import Checklist = require("../models/Checklist");
import datesLib = require("./dates");
const { dayKey } = datesLib;
import auditSamplingLib = require("./auditSampling");
const { auditFor, getAuditorSettings } = auditSamplingLib;
import permissionsLib = require("./permissions");
const { can } = permissionsLib;
import scopeLib = require("./scope");
const { canSeeUser } = scopeLib;
import engineLib = require("./fms/engine");
const { cleanValues } = engineLib;
import delegations = require("./delegations");

const PROOF_FIELD = { key: "proof", label: "Proof (photo)", type: "photo", required: true };

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function load(taskId) {
  if (!mongoose.isValidObjectId(taskId)) throw fail("Invalid ID");
  const task = await Task.findById(taskId).lean<any>();
  if (!task) throw fail("Task not found", 404);
  return task;
}

// The doer, or someone who oversees the doer (checklists) / manages the delegation
async function checkCanAct(task, user) {
  if (String(task.doer) === String(user._id)) return;
  const ok =
    task.kind === "delegation"
      ? await delegations.canManage(task, user)
      : can(user, "checklist", "edit") && (await canSeeUser(user, task.doer));
  if (!ok) throw fail("This task is assigned to someone else", 403);
}

// What the doer fills when marking it done
async function formFields(task) {
  if (task.kind === "delegation") return task.proofRequired ? [PROOF_FIELD] : [];
  const c = task.checklist ? await Checklist.findById(task.checklist).select("fields").lean<any>() : null;
  return c?.fields || [];
}

async function markDone(taskId, user, { remarks = "", values, now = new Date() }: any = {}) {
  const task = await load(taskId);
  // a help ticket: Done = solved, the remarks are what was done (the ticket closes the task)
  if (task.kind === "ticket") {
    await require("./tickets").solve(user, task.ticket, { solution: remarks, now });
    return Task.findById(task._id);
  }
  await checkCanAct(task, user);
  if (task.status !== "pending") throw fail(task.status === "expired" ? "This task was auto-closed as not done" : "This task is already finished");
  const clean = cleanValues(await formFields(task), values);
  const set: Record<string, any> = {
    status: "done",
    actual: now,
    actualDay: dayKey(now),
    resolvedAt: now,
    doneBy: user._id,
    remarks: String(remarks || "").trim().slice(0, 1000),
  };
  if (Object.keys(clean).length) set.values = clean;
  // goes to the auditor's Audit List when it is in the auditor's sample; a task sent back by the auditor always does
  const picked = auditFor(task, task.auditor, await getAuditorSettings(), now) || (task.audit?.status === "notok" ? { status: "pending", rating: null, remarks: "" } : null);
  if (picked) for (const [k, v] of Object.entries<any>(picked)) set[`audit.${k}`] = v;
  const update: Record<string, any> = { $set: set, $inc: { __v: 1 } }; // bumps the version so a stale edit elsewhere fails instead of overwriting
  if (task.kind === "delegation") update.$push = { log: { $each: [{ at: now, by: user._id, action: "done", note: set.remarks }], $slice: -60 } };
  const done = await Task.findOneAndUpdate({ _id: task._id, status: "pending" }, update, { returnDocument: "after" });
  if (!done) throw fail("This task was just finished by someone else");
  return done;
}

async function markNotRequired(taskId, user, remarks = "", { now = new Date() }: any = {}) {
  const task = await load(taskId);
  if (task.kind === "delegation") throw fail("A delegation cannot be marked Not Required. Ask the person who assigned it to cancel it.");
  if (task.kind === "ticket") throw fail("A help ticket cannot be marked Not Required. Cancel it from the ticket.");
  await checkCanAct(task, user);
  const why = String(remarks || "").trim().slice(0, 1000);
  if (why.length < 3) throw fail("Write why it is not required");
  const done = await Task.findOneAndUpdate(
    { _id: task._id, status: "pending" },
    { $set: { status: "na", resolvedAt: now, remarks: why, doneBy: user._id }, $inc: { __v: 1 } },
    { returnDocument: "after" }
  );
  if (!done) throw fail("Only a pending task can be marked Not Required");
  return done;
}

async function reopen(taskId, user, { remarks }: any = {}) {
  const task = await load(taskId);
  if (task.kind === "delegation") return delegations.reopenDelegation(taskId, user, { remarks });
  if (task.kind === "ticket") throw fail("Reopen it from the ticket (Help Ticket)");
  if (!(can(user, "checklist", "edit") && (await canSeeUser(user, task.doer)))) throw fail("You don't have permission to reopen tasks", 403);
  if (!["done", "na", "expired"].includes(task.status)) throw fail("This task is already open");
  return Task.findOneAndUpdate(
    { _id: task._id, status: task.status },
    { $set: { status: "pending" }, $unset: { actual: 1, actualDay: 1, resolvedAt: 1, doneBy: 1, values: 1, closeAt: 1 }, $inc: { __v: 1 } },
    { returnDocument: "after" }
  );
}

export = { markDone, markNotRequired, reopen, formFields, PROOF_FIELD };
