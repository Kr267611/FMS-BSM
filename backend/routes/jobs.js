const express = require("express");
const mongoose = require("mongoose");
const Job = require("../models/Job");
const Task = require("../models/Task");
const { auth, permit } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { createJob } = require("../services/workflow");

const router = express.Router();

// Sheet-like view: each job with all of its steps
router.get("/", auth, permit("fmsEntries", "view"), async (req, res) => {
  const { process: processId, status } = req.query;
  if (!mongoose.isValidObjectId(processId)) return res.status(400).json({ message: "Choose a process" });

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const filter = { process: processId };
  if (status === "open" || status === "closed") filter.status = status;

  const [total, jobs] = await Promise.all([
    Job.countDocuments(filter),
    Job.find(filter).sort({ startDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate("createdBy", "name").lean(),
  ]);
  const tasks = await Task.find({ job: { $in: jobs.map((j) => j._id) } })
    .populate("doer", "name")
    .sort({ stepIndex: 1 })
    .lean();

  const byJob = new Map();
  for (const t of tasks) {
    const id = String(t.job);
    if (!byJob.has(id)) byJob.set(id, []);
    byJob.get(id).push(t);
  }
  res.json({ total, page, limit, jobs: jobs.map((j) => ({ ...j, tasks: byJob.get(String(j._id)) || [] })) });
});

router.post("/", auth, permit("fmsEntries", "add"), async (req, res) => {
  const { process: processId, data, startDate } = req.body || {};
  const job = await createJob({ processId, data, startDate, user: req.user });
  audit(req, "job.create", { entity: "Job", entityId: job._id, summary: `Job #${job.jobNo}` });
  res.status(201).json(job);
});

router.delete("/:id", auth, permit("fmsEntries", "delete"), async (req, res) => {
  const job = await Job.findByIdAndDelete(req.params.id);
  if (!job) return res.status(404).json({ message: "Job not found" });
  await Task.deleteMany({ job: job._id });
  audit(req, "job.delete", { entity: "Job", entityId: job._id, summary: `Job #${job.jobNo}` });
  res.json({ message: "Job deleted" });
});

module.exports = router;
