const express = require("express");
const mongoose = require("mongoose");
const Job = require("../models/Job");
const Task = require("../models/Task");
const Process = require("../models/Process");
const AuditLog = require("../models/AuditLog");
const { auth, permit } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { todayKey, dayKey } = require("../services/dates");
const { startOfDay } = require("../services/calendar");
const wf = require("../services/workflow");
const { sweepSoon } = require("../services/sweep");
const { importEntries } = require("../services/entryImport");

const router = express.Router();
router.use(auth);

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function jobFilter(q) {
  if (!mongoose.isValidObjectId(q.process)) {
    const err = new Error("Choose an FMS");
    err.status = 400;
    throw err;
  }
  const filter = { process: q.process };
  if (q.status === "open" || q.status === "closed") filter.status = q.status;
  const text = String(q.q || "").trim().toLowerCase();
  if (text) filter.$or = [{ jobNo: text.replace(/^#/, "") }, { searchText: { $regex: escapeRe(text) } }];
  if (isDay(q.from) || isDay(q.to)) {
    filter.startDate = {};
    if (isDay(q.from)) filter.startDate.$gte = startOfDay(q.from);
    if (isDay(q.to)) filter.startDate.$lt = new Date(startOfDay(q.to).getTime() + 24 * 60 * 60 * 1000);
  }
  return filter;
}

async function withTasks(jobs) {
  const tasks = await Task.find({ job: { $in: jobs.map((j) => j._id) } })
    .select("-label -process -kind -__v")
    .populate("doer", "name")
    .populate("doneBy", "name")
    .sort({ stepIndex: 1 })
    .lean();
  const byJob = new Map();
  for (const t of tasks) {
    const id = String(t.job);
    if (!byJob.has(id)) byJob.set(id, []);
    byJob.get(id).push(t);
  }
  return jobs.map((j) => ({ ...j, tasks: byJob.get(String(j._id)) || [] }));
}

// The FMS as a sheet: each entry with all of its steps
router.get("/", permit("fmsEntries", "view"), async (req, res) => {
  await sweepSoon();
  const filter = jobFilter(req.query);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const [total, open, jobs] = await Promise.all([
    Job.countDocuments(filter),
    Job.countDocuments({ ...filter, status: "open" }),
    Job.find(filter)
      .sort({ startDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("createdBy", "name")
      .populate("closedBy", "name")
      .lean(),
  ]);
  res.json({ total, open, page, limit, today: todayKey(), jobs: await withTasks(jobs) });
});

// ---- CSV export (opens in Excel) ----
const dtFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const showDay = (k) => (k ? k.split("-").reverse().join("/") : "");
const showDt = (d) => (d ? dtFmt.format(new Date(d)).replace(",", "") : "");
function cell(v) {
  let s = Array.isArray(v) ? v.join(" ") : v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // no formulas from user text
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const STATUS_TEXT = { waiting: "Not started", pending: "Pending", done: "Done", na: "Not required", skipped: "Skipped" };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

router.get("/export", permit("fmsEntries", "view"), async (req, res) => {
  const filter = jobFilter(req.query);
  const process = await Process.findById(req.query.process).lean();
  if (!process) return res.status(404).json({ message: "FMS not found" });
  const jobs = await withTasks(await Job.find(filter).sort({ startDate: -1 }).limit(5000).lean());
  const today = todayKey();

  const head = ["Entry No", "Entry date", ...process.fields.map((f) => f.label)];
  for (const s of process.steps) {
    head.push(`${s.name} – Doer`, `${s.name} – Planned`, `${s.name} – Actual`, `${s.name} – Delay (days)`, `${s.name} – Status`);
    for (const f of s.fields || []) if (f.type !== "photo") head.push(`${s.name} – ${f.label}`);
    head.push(`${s.name} – Remarks`);
  }
  head.push(process.closure?.label || "Status by PC", "Closed on");

  const lines = [head.map(cell).join(",")];
  for (const j of jobs) {
    const row = [j.jobNo, showDt(j.startDate), ...process.fields.map((f) => (f.type === "date" ? showDay(j.data?.[f.key]) : j.data?.[f.key]))];
    for (const s of process.steps) {
      const t = j.tasks.find((x) => (x.stepKey || `s${(x.stepIndex ?? 0) + 1}`) === s.key) || {};
      const delay = t.plannedDay && (t.actualDay || t.status === "pending") ? Math.max(0, days(t.plannedDay, t.actualDay || today)) : "";
      row.push(t.doer?.name, showDt(t.planned), showDt(t.actual), delay, t.autoClosed ? "Closed by PC" : STATUS_TEXT[t.status] || "");
      for (const f of s.fields || []) if (f.type !== "photo") row.push(t.values?.[f.key]);
      row.push(t.remarks);
    }
    row.push(j.closeStatus, showDt(j.closedAt));
    lines.push(row.map(cell).join(","));
  }
  const name = `${process.name} ${today}.csv`.replace(/[^\w.\- ]+/g, "_");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send("﻿" + lines.join("\r\n"));
});

// Who gets each step and what is calculated, before the entry is saved
router.post("/preview", permit("fmsEntries", "add"), async (req, res) => {
  const { process: processId, data, startDate } = req.body || {};
  res.json(await wf.previewJob({ processId, data, startDate }));
});

// Bulk Delete / Download: how many entries match (FMS, open / closed, entry date range)
router.get("/count", permit("fmsEntries", "view"), async (req, res) => {
  res.json({ count: await Job.countDocuments(jobFilter(req.query)) });
});

router.get("/:id", permit("fmsEntries", "view"), async (req, res) => {
  await sweepSoon();
  const job = await Job.findById(req.params.id).populate("createdBy", "name").populate("closedBy", "name").lean();
  if (!job) return res.status(404).json({ message: "Entry not found" });
  const [withT] = await withTasks([job]);
  const history = await AuditLog.find({
    $or: [{ entity: "Job", entityId: job._id }, { entity: "Task", entityId: { $in: withT.tasks.map((t) => t._id) } }],
  })
    .sort({ at: -1 })
    .limit(60)
    .select("at actorName action summary")
    .lean();
  res.json({ ...withT, today: todayKey(), history });
});

router.post("/", permit("fmsEntries", "add"), async (req, res) => {
  const { process: processId, data, startDate } = req.body || {};
  const job = await wf.createJob({ processId, data, startDate, user: req.user });
  audit(req, "job.create", { entity: "Job", entityId: job._id, summary: `Entry #${job.jobNo}` });
  res.status(201).json(job);
});

// CSV rows -> entries, sent in chunks by the Import page: { process, rows, dryRun, uniqueField, firstLine }
router.post("/import", permit("fmsEntries", "add"), async (req, res) => {
  const { process: processId, rows, dryRun, uniqueField, firstLine } = req.body || {};
  if (!mongoose.isValidObjectId(processId)) return res.status(400).json({ message: "Choose the FMS" });
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ message: "The file has no rows" });
  if (rows.length > 500) return res.status(400).json({ message: "Send at most 500 rows at a time" });
  const r = await importEntries({ processId, rows, dryRun: dryRun !== false, uniqueField: uniqueField || null, firstLine: Number(firstLine) || 2, user: req.user });
  const made = r.results.filter((x) => x.ok).length;
  if (dryRun === false && made) audit(req, "job.import", { entity: "Process", entityId: processId, summary: `${made} entries imported, ${r.results.length - made} skipped` });
  res.json(r);
});

router.put("/:id", permit("fmsEntries", "edit"), async (req, res) => {
  const job = await wf.updateJobData(req.params.id, req.user, req.body?.data || {});
  audit(req, "job.update", { entity: "Job", entityId: job._id, summary: `Entry #${job.jobNo}: values corrected` });
  res.json(job);
});

router.post("/:id/close", permit("fmsEntries", "edit"), async (req, res) => {
  const job = await wf.closeJob(req.params.id, req.user, req.body || {});
  audit(req, "job.close", { entity: "Job", entityId: job._id, summary: `Entry #${job.jobNo}: ${job.closeStatus}${job.closeRemarks ? ` – ${job.closeRemarks}` : ""}` });
  res.json(job);
});

router.post("/:id/reopen", permit("fmsEntries", "edit"), async (req, res) => {
  const job = await wf.reopenJob(req.params.id, req.user);
  audit(req, "job.reopen", { entity: "Job", entityId: job._id, summary: `Entry #${job.jobNo}` });
  res.json(job);
});

// Admin only; the body must say confirm: "DELETE". Entries and all their steps go, and leave the MIS.
router.post("/bulk-delete", async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Only an admin can delete entries in bulk" });
  if (req.body?.confirm !== "DELETE") return res.status(400).json({ message: 'Type DELETE to confirm' });
  const filter = jobFilter(req.body);
  const process = await Process.findById(req.body.process).select("name").lean();
  const ids = (await Job.find(filter).select("_id").limit(20000).lean()).map((j) => j._id);
  const tasks = await Task.deleteMany({ job: { $in: ids } });
  const jobs = await Job.deleteMany({ _id: { $in: ids } });
  audit(req, "job.bulk_delete", { entity: "Process", entityId: req.body.process, summary: `${process?.name}: ${jobs.deletedCount} entries and ${tasks.deletedCount} steps deleted (${req.body.status || "all"}, ${req.body.from || "…"} – ${req.body.to || "…"})` });
  res.json({ entries: jobs.deletedCount, steps: tasks.deletedCount });
});

router.delete("/:id", permit("fmsEntries", "delete"), async (req, res) => {
  const job = await Job.findByIdAndDelete(req.params.id);
  if (!job) return res.status(404).json({ message: "Entry not found" });
  await Task.deleteMany({ job: job._id });
  audit(req, "job.delete", { entity: "Job", entityId: job._id, summary: `Entry #${job.jobNo} (${dayKey(job.startDate)})` });
  res.json({ message: "Entry deleted" });
});

module.exports = router;
