const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const Job = require("../models/Job");
const Process = require("../models/Process");
const AuditLog = require("../models/AuditLog");
const { auth } = require("../middleware/auth");
const { visibleUserIds } = require("../services/scope");
const { todayKey, addDaysKey } = require("../services/dates");
const { startOfDay } = require("../services/calendar");
const { misReport, score } = require("../services/scoring");
const { sweepSoon } = require("../services/sweep");

const router = express.Router();
router.use(auth);

const ACTIVITY = ["task.done", "task.not_required", "task.reopen", "job.create", "job.close", "job.import", "delegation.create", "delegation.revision_request", "delegation.revision_approve", "checklist.create"];

// Monday of this week (IST)
function weekStartKey(today) {
  const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
  return addDaysKey(today, -dow);
}

// Overview: counts, FMS health, recent activity and the oldest overdue tasks.
// Admin / auditor see everyone; HOD / PC / Team Leader their people; a doer only themselves.
router.get("/", async (req, res) => {
  await sweepSoon();
  const now = new Date();
  const today = todayKey();
  const week = weekStartKey(today);
  const weekStart = startOfDay(week);
  // ?scope=me: only my own tasks; otherwise everyone this user may see (a doer only ever sees themselves)
  const visible = req.query.scope === "me" ? [String(req.user._id)] : await visibleUserIds(req.user);
  const ids = visible === null ? null : visible.map((id) => new mongoose.Types.ObjectId(id));
  const mine = ids ? { doer: { $in: ids } } : {};

  const [pending, overdue, dueToday, doneWeek, byKind, oldest, openByProc, addedWeek, processes] = await Promise.all([
    Task.countDocuments({ ...mine, status: "pending" }),
    Task.countDocuments({ ...mine, status: "pending", planned: { $lt: now } }),
    Task.countDocuments({ ...mine, status: "pending", plannedDay: today }),
    Task.countDocuments({ ...mine, status: "done", resolvedAt: { $gte: weekStart } }),
    Task.aggregate([{ $match: { ...mine, status: "pending" } }, { $group: { _id: "$kind", n: { $sum: 1 }, late: { $sum: { $cond: [{ $lt: ["$planned", now] }, 1, 0] } } } }]),
    Task.find({ ...mine, status: "pending", planned: { $lt: now } }).sort({ planned: 1 }).limit(6).select("label kind planned plannedDay doer job").populate("doer", "name").populate("job", "jobNo").lean(),
    Job.aggregate([{ $match: { status: "open" } }, { $group: { _id: "$process", n: { $sum: 1 } } }]),
    Job.countDocuments({ createdAt: { $gte: weekStart } }),
    Process.find({ active: true }).select("name steps.name").sort({ name: 1 }).lean(),
  ]);

  // Per FMS: open entries, overdue steps, and how far the open entries have got (done ÷ started steps)
  const stepAgg = await Task.aggregate([
    { $match: { kind: "app", status: { $in: ["pending", "done"] } } },
    { $lookup: { from: "jobs", localField: "job", foreignField: "_id", as: "j", pipeline: [{ $project: { status: 1 } }] } },
    { $match: { "j.status": "open" } },
    {
      $group: {
        _id: "$process",
        done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
        late: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$planned", now] }] }, 1, 0] } },
      },
    },
  ]);
  const open = new Map(openByProc.map((x) => [String(x._id), x.n]));
  const steps = new Map(stepAgg.map((x) => [String(x._id), x]));
  const workflows = processes.map((p) => {
    const s = steps.get(String(p._id)) || { done: 0, pending: 0, late: 0 };
    return { _id: p._id, name: p.name, steps: p.steps.length, open: open.get(String(p._id)) || 0, overdue: s.late, progress: s.done + s.pending ? Math.round((100 * s.done) / (s.done + s.pending)) : 0 };
  });

  const activity = await AuditLog.find({ action: { $in: ACTIVITY }, ...(ids ? { actor: { $in: ids } } : {}) })
    .sort({ at: -1 })
    .limit(8)
    .select("at actorName action summary")
    .lean();

  const mis = await misReport({ from: week, to: today, doerId: req.user._id });

  // MIDAP "Week Score": this week and last week, for the same people
  const weekRow = async (from, to) => {
    const r = await misReport({ from, to, doerIds: visible });
    const t = r.doers.reduce((a, d) => ({ planned: a.planned + d.total.planned, done: a.done + d.total.actual, onTime: a.onTime + d.total.onTime, late: a.late + d.total.late, pending: a.pending + d.total.pending, autoClosed: a.autoClosed + (d.total.autoClosed || 0) }), { planned: 0, done: 0, onTime: 0, late: 0, pending: 0, autoClosed: 0 });
    const pct = (n) => (t.planned ? Math.round((-100 * n) / t.planned * 10) / 10 + 0 : 0);
    return { from: r.from, to: r.to, ...t, notDonePct: pct(t.pending), notOnTimePct: pct(t.late + t.pending), score: score(t) };
  };
  const [thisWeek, lastWeek] = await Promise.all([weekRow(week, today), weekRow(addDaysKey(week, -7), addDaysKey(week, -1))]);

  // MIDAP "Weekly Task Chart": planned and done for each day of this week
  const days = await Task.aggregate([
    { $match: { ...mine, plannedDay: { $gte: week, $lte: addDaysKey(week, 6) }, status: { $in: ["pending", "done", "expired"] } } },
    { $group: { _id: "$plannedDay", planned: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } }, onTime: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "done"] }, { $lte: ["$actualDay", "$plannedDay"] }] }, 1, 0] } } } },
  ]);
  const byDay = new Map(days.map((d) => [d._id, d]));
  const chart = Array.from({ length: 7 }, (_, i) => {
    const day = addDaysKey(week, i);
    const d = byDay.get(day) || {};
    return { day, planned: d.planned || 0, done: d.done || 0, onTime: d.onTime || 0 };
  });

  // MIDAP "Checklist Tasks": today's checklist tasks
  const checklistToday = await Task.find({ ...mine, kind: "checklist", plannedDay: today, status: { $in: ["pending", "done", "na", "expired"] } })
    .sort({ planned: 1 })
    .limit(30)
    .select("label status planned actual doer priority")
    .populate("doer", "name")
    .lean();
  const kinds = Object.fromEntries(byKind.map((k) => [k._id, { pending: k.n, overdue: k.late }]));
  // tasks waiting for my audit (the Auditor bucket of the Pending Task card)
  kinds.audit = { pending: await Task.countDocuments({ auditor: req.user._id, "audit.status": "pending" }), overdue: 0 };

  res.json({
    today,
    weekStart: week,
    stats: { openEntries: [...open.values()].reduce((a, b) => a + b, 0), addedWeek, pending, overdue, dueToday, doneWeek },
    kinds,
    workflows,
    overdueList: oldest,
    activity,
    myScore: mis.doers[0]?.total || null,
    scope: req.query.scope === "me" ? "me" : visible === null || visible.length > 1 ? "team" : "me",
    week: { thisWeek, lastWeek },
    chart,
    checklistToday,
  });
});

module.exports = router;
