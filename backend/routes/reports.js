const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/User");
const { auth, permit } = require("../middleware/auth");
const { visibleUserIds, canSeeUser } = require("../services/scope");
const { audit } = require("../services/audit");

const router = express.Router();
router.use(auth, permit("reports", "view"));

const KINDS = { fms: "app", checklist: "checklist", delegation: "delegation", sheet: "sheet" };
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MANAGERS = ["admin", "hod", "pc", "tl"];

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// PC report "List Doer Tasks": every task of the people this user may see.
// ?kind= &doer= &status=pending|overdue|done|all &from= &to= (planned day) &q= &page=
router.get("/tasks", async (req, res) => {
  const visible = await visibleUserIds(req.user);
  const filter = { status: { $in: ["pending", "done", "na", "expired"] } };
  if (visible !== null) filter.doer = { $in: visible.map((id) => new mongoose.Types.ObjectId(id)) };
  if (req.query.doer && mongoose.isValidObjectId(req.query.doer)) {
    if (visible !== null && !visible.includes(String(req.query.doer))) throw fail("You can only see tasks of people in your department", 403);
    filter.doer = new mongoose.Types.ObjectId(req.query.doer);
  }
  if (KINDS[req.query.kind]) filter.kind = KINDS[req.query.kind];
  const status = req.query.status || "pending";
  if (status === "pending") filter.status = "pending";
  else if (status === "overdue") Object.assign(filter, { status: "pending", planned: { $lt: new Date() } });
  else if (status === "done") filter.status = { $in: ["done", "na", "expired"] };
  if (isDay(req.query.from) || isDay(req.query.to)) {
    filter.plannedDay = {};
    if (isDay(req.query.from)) filter.plannedDay.$gte = req.query.from;
    if (isDay(req.query.to)) filter.plannedDay.$lte = req.query.to;
  }
  const q = String(req.query.q || "").trim();
  if (q) filter.label = new RegExp(esc(q), "i");

  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 100;
  const [total, tasks] = await Promise.all([
    Task.countDocuments(filter),
    Task.find(filter)
      .sort(status === "done" ? { resolvedAt: -1 } : { planned: 1 })
      .skip((page - 1) * size)
      .limit(size)
      .select("kind label doer assignedBy job status planned plannedDay actual actualDay activatedAt createdAt remarks priority")
      .populate("doer", "name")
      .populate("assignedBy", "name")
      .populate("job", "jobNo")
      .lean(),
  ]);
  res.json({ total, page, pages: Math.max(1, Math.ceil(total / size)), tasks });
});

// Give pending tasks to someone else. A task whose planned time has passed keeps its doer (its late / pending
// stays in that doer's score) – only an admin can move it, and that is recorded.
router.post("/tasks/switch", async (req, res) => {
  if (!MANAGERS.includes(req.user.role)) throw fail("Only an admin, HOD, PC or Team Leader can switch doers", 403);
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);
  const to = req.body?.doer;
  if (!ids.length) throw fail("Select the tasks first");
  if (!mongoose.isValidObjectId(to)) throw fail("Choose the new doer");
  const doer = await User.findOne({ _id: to, active: true }).select("name").lean();
  if (!doer) throw fail("The new doer must be an active user");
  if (!(await canSeeUser(req.user, to))) throw fail("You can only give tasks to people in your department", 403);

  const now = new Date();
  const tasks = await Task.find({ _id: { $in: ids } }).select("kind label doer status planned").lean();
  const results = [];
  for (const t of tasks) {
    let error = null;
    if (t.kind === "sheet") error = "comes from a Google Sheet";
    else if (t.status !== "pending") error = "is not pending";
    else if (String(t.doer) === String(to)) error = "already belongs to this doer";
    else if (!(await canSeeUser(req.user, t.doer))) error = "belongs to someone outside your department";
    else if (t.planned && t.planned < now && req.user.role !== "admin") error = "is overdue (only an admin can move it)";
    if (!error) {
      const update = { $set: { doer: doer._id }, $inc: { __v: 1 } };
      if (t.kind === "delegation") update.$push = { log: { $each: [{ at: now, by: req.user._id, action: "switched the doer", note: `→ ${doer.name}` }], $slice: -60 } };
      await Task.updateOne({ _id: t._id, status: "pending" }, update);
    }
    results.push({ id: t._id, label: t.label, ok: !error, error });
  }
  const moved = results.filter((r) => r.ok).length;
  if (moved) audit(req, "task.switch_doer", { entity: "Task", summary: `${moved} task(s) → ${doer.name}` });
  res.json({ moved, results });
});

// Admin only: remove checklist / delegation tasks (an FMS step goes with its entry)
router.post("/tasks/delete", async (req, res) => {
  if (req.user.role !== "admin") throw fail("Only an admin can delete tasks", 403);
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);
  if (!ids.length) throw fail("Select the tasks first");
  const r = await Task.deleteMany({ _id: { $in: ids }, kind: { $in: ["checklist", "delegation"] } });
  audit(req, "task.delete", { entity: "Task", summary: `${r.deletedCount} checklist / delegation task(s) deleted` });
  res.json({ deleted: r.deletedCount, skipped: ids.length - r.deletedCount });
});

module.exports = router;
