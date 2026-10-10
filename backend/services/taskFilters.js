// The MIDAP list filters, shared by List Doer Tasks, List FMS Tasks and the Audit List:
//   priority, checklist group, assigned by, PC, auditor, department, branch, and the detailed status
//   (done on time / done late / pending / pending late / not required / auto-closed).
// Each one narrows `filter` (a Task query); people filters stay inside what the user may see.
const mongoose = require("mongoose");
const User = require("../models/User");
const Checklist = require("../models/Checklist");
const Process = require("../models/Process");
const Task = require("../models/Task");

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isId = (v) => mongoose.isValidObjectId(v);

// Detailed status: pending_late = its planned time has passed; done_late = done after its planned day
const STATUS = {
  pending: () => ({ status: "pending" }),
  pending_ontime: (now) => ({ status: "pending", planned: { $gte: now } }),
  pending_late: (now) => ({ status: "pending", planned: { $lt: now } }),
  done: () => ({ status: "done" }),
  done_ontime: () => ({ status: "done", $expr: { $lte: ["$actualDay", "$plannedDay"] } }),
  done_late: () => ({ status: "done", $expr: { $gt: ["$actualDay", "$plannedDay"] } }),
  na: () => ({ status: "na" }),
  expired: () => ({ status: "expired" }),
};

// Keep only the doers in `ids` (and in what the filter already allows)
function narrowDoers(filter, ids) {
  const want = new Set(ids.map(String));
  const cur = filter.doer;
  let allowed;
  if (!cur) allowed = [...want];
  else if (cur.$in) allowed = cur.$in.map(String).filter((x) => want.has(x));
  else allowed = want.has(String(cur)) ? [String(cur)] : [];
  filter.doer = { $in: allowed.map(oid) };
}

function and(filter, cond) {
  filter.$and = [...(filter.$and || []), cond];
}

async function applyTaskFilters(filter, q, { now = new Date() } = {}) {
  if (STATUS[q.status]) {
    const s = STATUS[q.status](now);
    if (s.$expr) and(filter, { $expr: s.$expr });
    Object.assign(filter, { status: s.status, ...(s.planned ? { planned: s.planned } : {}) });
  }
  if (Task.PRIORITIES.includes(q.priority)) filter.priority = q.priority === "normal" ? { $in: ["normal", null] } : q.priority;
  if (isId(q.assignedBy)) filter.assignedBy = oid(q.assignedBy);
  if (isId(q.auditor)) filter.auditor = oid(q.auditor);
  if (isId(q.group)) {
    const ids = await Checklist.find({ group: q.group }).distinct("_id");
    filter.checklist = { $in: ids };
  }
  // PC: the task's own PC, or the PC of its FMS
  if (isId(q.pc)) {
    const fms = await Process.find({ pc: q.pc }).distinct("_id");
    and(filter, { $or: [{ pc: oid(q.pc) }, { process: { $in: fms } }] });
  }
  if (isId(q.department) || isId(q.branch)) {
    const who = {};
    if (isId(q.department)) who.department = q.department;
    if (isId(q.branch)) who.branch = q.branch;
    narrowDoers(filter, await User.find(who).distinct("_id"));
  }
  return filter;
}

module.exports = { applyTaskFilters, STATUS, narrowDoers };
