const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const { auth } = require("../middleware/auth");
const { markDone, markNotRequired, reopen } = require("../services/workflow");
const { todayKey } = require("../services/dates");
const { canSeeUser } = require("../services/scope");
const { audit } = require("../services/audit");

const router = express.Router();

// A doer's task list. HOD / PC / admin can pass ?doer= for someone they oversee.
router.get("/", auth, async (req, res) => {
  const doer = req.query.doer || req.user._id;
  if (!mongoose.isValidObjectId(doer)) return res.status(400).json({ message: "Invalid doer" });
  if (String(doer) !== String(req.user._id) && !(await canSeeUser(req.user, doer))) {
    return res.status(403).json({ message: "You can only see tasks of people in your department" });
  }

  const status = req.query.status || "pending";
  const filter = { doer };
  if (status === "pending") filter.status = "pending";
  else if (status === "done") filter.status = { $in: ["done", "na"] };

  const limit = status === "pending" ? 1000 : 200;
  const sort = status === "pending" ? { plannedDay: 1, planned: 1 } : { actual: -1, updatedAt: -1 };

  const tasks = await Task.find(filter)
    .sort(sort)
    .limit(limit)
    .populate("job", "jobNo data startDate")
    .populate("process", "name fields")
    .populate("sheetLink", "name tabName spreadsheetId")
    .lean();

  res.json({ today: todayKey(), tasks });
});

router.post("/:id/done", auth, async (req, res) => {
  const task = await markDone(req.params.id, req.user, req.body?.remarks || "");
  audit(req, "task.done", { entity: "Task", entityId: task._id, summary: task.label });
  res.json(task);
});

router.post("/:id/not-required", auth, async (req, res) => {
  const task = await markNotRequired(req.params.id, req.user, req.body?.remarks || "");
  audit(req, "task.not_required", { entity: "Task", entityId: task._id, summary: `${task.label}: ${task.remarks}` });
  res.json(task);
});

router.post("/:id/reopen", auth, async (req, res) => {
  const task = await reopen(req.params.id, req.user);
  audit(req, "task.reopen", { entity: "Task", entityId: task._id, summary: task.label });
  res.json(task);
});

module.exports = router;
