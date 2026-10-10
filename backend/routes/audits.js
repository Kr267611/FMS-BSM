const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const { auth, permit } = require("../middleware/auth");
const { visibleUserIds } = require("../services/scope");
const { audit } = require("../services/audit");
const User = require("../models/User");
const wf = require("../services/workflow");
const { getAuditorSettings, saveAuditorSettings } = require("../services/auditSampling");
const { todayKey } = require("../services/dates");

const router = express.Router();
router.use(auth);

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const KINDS = { checklist: "checklist", delegation: "delegation", fms: "app" };
function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// MIDAP "Audit List": finished tasks waiting for (or given) my audit. An admin sees every auditor's list.
// ?status=pending|done|all &auditor= (admin) &doer= &kind=checklist|delegation|fms &page=
router.get("/", async (req, res) => {
  const filter = { auditor: { $ne: null }, "audit.status": { $exists: true } };
  if (req.user.role === "admin") {
    if (mongoose.isValidObjectId(req.query.auditor)) filter.auditor = oid(req.query.auditor);
  } else filter.auditor = req.user._id;
  if (mongoose.isValidObjectId(req.query.doer)) filter.doer = oid(req.query.doer);
  if (KINDS[req.query.kind]) filter.kind = KINDS[req.query.kind];
  const status = req.query.status || "pending";
  if (status === "pending") filter["audit.status"] = "pending";
  else if (status === "done") filter["audit.status"] = { $in: ["ok", "notok"] };

  const page = Math.max(1, Number(req.query.page) || 1);
  const [total, pendingCount, tasks] = await Promise.all([
    Task.countDocuments(filter),
    Task.countDocuments({ ...filter, "audit.status": "pending" }),
    Task.find(filter)
      .sort(status === "done" ? { "audit.at": -1 } : { actual: -1 })
      .skip((page - 1) * 100)
      .limit(100)
      .select("kind label stepName stepIndex job process doer auditor assignedBy priority planned plannedDay actual actualDay values remarks audit checklist details proofRequired")
      .populate("job", "jobNo")
      .populate("process", "name")
      .populate("doer", "name")
      .populate("auditor", "name")
      .populate("assignedBy", "name")
      .populate({ path: "checklist", select: "fields how" })
      .lean(),
  ]);
  res.json({ total, pending: pendingCount, page, pages: Math.max(1, Math.ceil(total / 100)), tasks, today: todayKey() });
});

// MIDAP "Auditor Settings": per auditor the share (%) of checklist / delegation / FMS tasks to audit and the Audit TAT
router.get("/settings", permit("settings", "edit"), async (req, res) => {
  const users = await User.find({ active: true }).select("name role department").populate("department", "name").sort({ name: 1 }).lean();
  res.json({ settings: await getAuditorSettings(), users: users.map((u) => ({ _id: u._id, name: u.name, role: u.role, department: u.department?.name || "" })) });
});

router.put("/settings", permit("settings", "edit"), async (req, res) => {
  try {
    const value = await saveAuditorSettings(req.body?.settings);
    audit(req, "settings.auditors", { entity: "Setting", summary: `Auditor settings for ${Object.keys(value).length} auditor(s)` });
    res.json({ settings: value });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// Audit one task: { result: ok|notok, rating: 1-5, remarks }. Not OK sends the task back to the doer with its
// original planned date, so finishing it again counts as late.
router.post("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const t = await Task.findById(req.params.id).lean();
  if (!t || !t.audit) throw fail("This task is not waiting for an audit", 404);
  if (String(t.auditor) !== String(req.user._id) && req.user.role !== "admin") throw fail("Only the auditor of this task can audit it", 403);
  if (t.audit.status !== "pending") throw fail("This task is already audited");
  const result = req.body?.result;
  if (!["ok", "notok"].includes(result)) throw fail("Choose OK or Not OK");
  const rating = Math.round(Number(req.body?.rating));
  if (!(rating >= 1 && rating <= 5)) throw fail("Give a rating from 1 to 5");
  const remarks = String(req.body?.remarks || "").trim().slice(0, 500);
  if (result === "notok" && remarks.length < 3) throw fail("Write what is wrong, so the doer can fix it");

  const now = new Date();
  const record = { status: result, rating, remarks, by: req.user._id, at: now, rounds: (t.audit.rounds || 0) + 1, dueDay: t.audit.dueDay };
  const update = { $set: { audit: record }, $inc: { __v: 1 } };
  if (result === "notok" && t.kind === "app") {
    // an FMS step goes back through the FMS engine, so the steps after it are worked out again
    try {
      await wf.reopenForAudit(t._id, { now });
    } catch (err) {
      throw fail(`Not OK cannot send this step back: ${err.message}`);
    }
    update.$inc.reopenCount = 1;
  } else if (result === "notok") {
    Object.assign(update.$set, { status: "pending" });
    update.$unset = { actual: 1, actualDay: 1, resolvedAt: 1, doneBy: 1 };
    update.$inc.reopenCount = 1;
    if (t.kind === "delegation") update.$push = { log: { $each: [{ at: now, by: req.user._id, action: "audit: not OK, sent back", note: remarks }], $slice: -60 } };
  }
  const saved = await Task.findOneAndUpdate({ _id: t._id, "audit.status": "pending" }, update, { returnDocument: "after" });
  if (!saved) throw fail("This task was just audited by someone else");
  audit(req, result === "ok" ? "task.audit_ok" : "task.audit_notok", { entity: "Task", entityId: t._id, summary: `${t.label}: ${result === "ok" ? "OK" : "Not OK"}, rating ${rating}${remarks ? ` – ${remarks}` : ""}` });
  res.json(saved);
});

// MIDAP "Auditor Report": per auditor and doer – tasks for audit, audited, pending, OK / Not OK, average rating
// ?from= &to= (planned day) &group=auditor|doer
router.get("/report", permit("reports", "view"), async (req, res) => {
  const match = { auditor: { $ne: null }, status: { $in: ["pending", "done"] } };
  const visible = await visibleUserIds(req.user);
  if (visible !== null) match.$or = [{ doer: { $in: visible.map(oid) } }, { auditor: req.user._id }];
  if (isDay(req.query.from) || isDay(req.query.to)) {
    match.plannedDay = {};
    if (isDay(req.query.from)) match.plannedDay.$gte = req.query.from;
    if (isDay(req.query.to)) match.plannedDay.$lte = req.query.to;
  }
  const byDoer = req.query.group === "doer";
  const today = todayKey();
  const rows = await Task.aggregate([
    { $match: match },
    {
      $group: {
        _id: { auditor: "$auditor", doer: "$doer" },
        tasks: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
        // in the auditor's sample (Auditor Settings); late = still waiting after the Audit TAT
        sampled: { $sum: { $cond: [{ $ifNull: ["$audit.status", false] }, 1, 0] } },
        waiting: { $sum: { $cond: [{ $eq: ["$audit.status", "pending"] }, 1, 0] } },
        late: { $sum: { $cond: [{ $and: [{ $eq: ["$audit.status", "pending"] }, { $lt: [{ $ifNull: ["$audit.dueDay", "9999"] }, today] }] }, 1, 0] } },
        ok: { $sum: { $cond: [{ $eq: ["$audit.status", "ok"] }, 1, 0] } },
        notOk: { $sum: { $cond: [{ $eq: ["$audit.status", "notok"] }, 1, 0] } },
        ratingSum: { $sum: { $ifNull: ["$audit.rating", 0] } },
        rated: { $sum: { $cond: [{ $gt: ["$audit.rating", 0] }, 1, 0] } },
        sentBack: { $sum: { $ifNull: ["$reopenCount", 0] } },
      },
    },
    { $lookup: { from: "users", localField: "_id.auditor", foreignField: "_id", as: "a", pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: "users", localField: "_id.doer", foreignField: "_id", as: "d", pipeline: [{ $project: { name: 1 } }] } },
  ]);
  // roll up to one row per auditor (or per doer), with the other side as detail rows
  const groups = new Map();
  for (const r of rows) {
    const key = String(byDoer ? r._id.doer : r._id.auditor);
    const name = (byDoer ? r.d[0] : r.a[0])?.name || "?";
    if (!groups.has(key)) groups.set(key, { key, name, total: blank(), rows: [] });
    const g = groups.get(key);
    const row = { name: (byDoer ? r.a[0] : r.d[0])?.name || "?", ...pick(r) };
    g.rows.push(finish(row));
    add(g.total, row);
  }
  const out = [...groups.values()].map((g) => ({ ...g, total: finish(g.total), rows: g.rows.sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ group: byDoer ? "doer" : "auditor", rows: out });
});

const FIELDS = ["tasks", "done", "sampled", "waiting", "late", "ok", "notOk", "ratingSum", "rated", "sentBack"];
const blank = () => Object.fromEntries(FIELDS.map((k) => [k, 0]));
const pick = (r) => Object.fromEntries(FIELDS.map((k) => [k, r[k] || 0]));
function add(a, b) {
  for (const k of FIELDS) a[k] += b[k];
}
function finish(r) {
  const audited = r.ok + r.notOk;
  return { ...r, audited, avgRating: r.rated ? Math.round((r.ratingSum / r.rated) * 10) / 10 : null, okPct: audited ? Math.round((100 * r.ok) / audited) : null };
}

module.exports = router;
