const express = require("express");
const mongoose = require("mongoose");
const Leave = require("../models/Leave");
const User = require("../models/User");
const { auth, permit } = require("../middleware/auth");
const { visibleUserIds, canSeeUser } = require("../services/scope");
const { audit } = require("../services/audit");
const { loadCalendar } = require("../services/workflow");
const { applyLeave, checkLeave } = require("../services/doerCalendar");

// MIDAP "Doer Holiday": days a person is away. Adding one frees their checklist tasks on those days and moves
// their FMS steps and delegations due then to the first working day after.
const router = express.Router();
router.use(auth);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

async function checkBody(req) {
  const { user, from, to } = req.body || {};
  if (!mongoose.isValidObjectId(user) || !(await User.exists({ _id: user, active: true }))) throw fail("Choose the person");
  if (!(await canSeeUser(req.user, user))) throw fail("You can only add leave for people in your department", 403);
  checkLeave(from, to);
  return { user: String(user), from, to, reason: String(req.body.reason || "").trim().slice(0, 200) };
}

// ?user= &from= &to= (leaves touching these days)
router.get("/", permit("users", "view"), async (req, res) => {
  const filter = {};
  const visible = await visibleUserIds(req.user);
  if (visible !== null) filter.user = { $in: visible };
  if (mongoose.isValidObjectId(req.query.user)) {
    if (visible !== null && !visible.includes(String(req.query.user))) throw fail("You can only see people in your department", 403);
    filter.user = req.query.user;
  }
  if (isDay(req.query.from)) filter.to = { $gte: req.query.from };
  if (isDay(req.query.to)) filter.from = { $lte: req.query.to };
  const leaves = await Leave.find(filter).sort({ from: -1 }).limit(500).populate("user", "name department").populate("createdBy", "name").lean();
  res.json(leaves);
});

// What adding it would change, before saving
router.post("/preview", permit("users", "edit"), async (req, res) => {
  const b = await checkBody(req);
  res.json(await applyLeave(b, await loadCalendar(), { dryRun: true }));
});

router.post("/", permit("users", "edit"), async (req, res) => {
  const b = await checkBody(req);
  const clash = await Leave.findOne({ user: b.user, from: { $lte: b.to }, to: { $gte: b.from } }).lean();
  if (clash) throw fail(`This person already has leave from ${clash.from} to ${clash.to}. Change the days or remove that one first.`);
  const leave = await Leave.create({ ...b, createdBy: req.user._id });
  const applied = await applyLeave(b, await loadCalendar(), { by: req.user._id });
  await Leave.updateOne({ _id: leave._id }, { applied });
  const who = await User.findById(b.user).select("name").lean();
  audit(req, "leave.create", { entity: "Leave", entityId: leave._id, summary: `${who?.name}: ${b.from} to ${b.to}${b.reason ? ` (${b.reason})` : ""} – ${applied.notRequired} checklist task(s) not required, ${applied.moved} task(s) moved` });
  res.status(201).json({ ...leave.toObject(), applied });
});

// Removing a leave stops it for new tasks; what it already changed stays (and is in the audit log)
router.delete("/:id", permit("users", "edit"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const leave = await Leave.findById(req.params.id).populate("user", "name").lean();
  if (!leave) throw fail("Leave not found", 404);
  if (!(await canSeeUser(req.user, leave.user._id))) throw fail("You can only change people in your department", 403);
  await Leave.deleteOne({ _id: leave._id });
  audit(req, "leave.delete", { entity: "Leave", entityId: leave._id, summary: `${leave.user.name}: ${leave.from} to ${leave.to} removed` });
  res.json({ message: "Leave removed" });
});

module.exports = router;
