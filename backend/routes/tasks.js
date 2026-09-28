const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const { auth } = require("../middleware/auth");
const { markDone, markNotRequired, reopen } = require("../services/workflow");
const { todayKey } = require("../services/dates");

const router = express.Router();

// A doer's task list. Admins can pass ?doer= to see anyone's.
router.get("/", auth, async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const doer = isAdmin && req.query.doer ? req.query.doer : req.user._id;
  if (!mongoose.isValidObjectId(doer)) return res.status(400).json({ message: "Invalid doer" });

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
  res.json(await markDone(req.params.id, req.user, req.body?.remarks || ""));
});

router.post("/:id/not-required", auth, async (req, res) => {
  res.json(await markNotRequired(req.params.id, req.user, req.body?.remarks || ""));
});

router.post("/:id/reopen", auth, async (req, res) => {
  res.json(await reopen(req.params.id, req.user));
});

module.exports = router;
