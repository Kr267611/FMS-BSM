const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/User");
const Job = require("../models/Job");
const Process = require("../models/Process");
const { dayKey, todayKey, addDaysKey } = require("../services/dates");
const Checklist = require("../models/Checklist");
const { isOff } = require("../services/calendar");
const { loadCalendar } = require("../services/workflow");
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
// Overdue buckets of pending tasks (MIDAP widget): planned time ranges relative to now
const DAY = 86400000;
function delayRange(key, now) {
  const ago = (d) => new Date(now.getTime() - d * DAY);
  if (key === "ontime") return { $gte: now };
  if (key === "1-3") return { $lt: now, $gte: ago(3) };
  if (key === "4-7") return { $lt: ago(3), $gte: ago(7) };
  if (key === "8+") return { $lt: ago(7) };
  return null;
}

// ?kind= &doer= &status=pending|overdue|done|all &delay=ontime|1-3|4-7|8+ &from= &to= (planned day) &q= &page=
router.get("/tasks", async (req, res) => {
  const now = new Date();
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

  // summary cards: the same people, type, dates and search, any status
  const base = { ...filter, status: { $in: ["pending", "done", "na", "expired"] } };
  delete base.planned;
  const count = (extra) => Task.countDocuments({ ...base, ...extra });
  const [all, done, pending, ...buckets] = await Promise.all([
    count({}),
    count({ status: "done" }),
    count({ status: "pending" }),
    ...["ontime", "1-3", "4-7", "8+"].map((k) => count({ status: "pending", planned: delayRange(k, now) })),
  ]);
  const summary = { total: all, done, pending, delay: { ontime: buckets[0], "1-3": buckets[1], "4-7": buckets[2], "8+": buckets[3] } };

  const range = delayRange(req.query.delay, now);
  if (range) Object.assign(filter, { status: "pending", planned: range });

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
  res.json({ total, page, pages: Math.max(1, Math.ceil(total / size)), tasks, summary });
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

// ---- List FMS Tasks (MIDAP): FMS steps with FMS / step / field value / status / delay filters ----
const DAY_MS = 86400000;
const BUCKETS = { ontime: [null, 0], "1-2": [1, 2], "3-7": [3, 7], "7+": [8, null] };
// whole days a finished step was late: actual day vs planned day
const doneDelay = (t) => (t.actualDay && t.plannedDay ? Math.max(0, Math.round((Date.parse(t.actualDay) - Date.parse(t.plannedDay)) / DAY_MS)) : 0);

// ?process= &step= &status=pending|overdue|done|all &doer= &delay=ontime|1-2|3-7|7+ &field= &value= &from= &to= &page=
router.get("/fms-tasks", async (req, res) => {
  const now = new Date();
  const visible = await visibleUserIds(req.user);
  const filter = { kind: "app", status: { $in: ["pending", "done"] } };
  if (visible !== null) filter.doer = { $in: visible.map((id) => new mongoose.Types.ObjectId(id)) };
  if (req.query.doer && mongoose.isValidObjectId(req.query.doer)) {
    if (visible !== null && !visible.includes(String(req.query.doer))) throw fail("You can only see tasks of people in your department", 403);
    filter.doer = new mongoose.Types.ObjectId(req.query.doer);
  }
  if (mongoose.isValidObjectId(req.query.process)) filter.process = new mongoose.Types.ObjectId(req.query.process);
  if (req.query.step && filter.process) filter.stepKey = String(req.query.step);
  const status = req.query.status || "pending";
  if (status === "pending") filter.status = "pending";
  else if (status === "overdue") Object.assign(filter, { status: "pending", planned: { $lt: now } });
  else if (status === "done") filter.status = "done";
  if (isDay(req.query.from) || isDay(req.query.to)) {
    filter.plannedDay = {};
    if (isDay(req.query.from)) filter.plannedDay.$gte = req.query.from;
    if (isDay(req.query.to)) filter.plannedDay.$lte = req.query.to;
  }
  // entry field value, e.g. Machine No contains "JET-5"
  if (filter.process && req.query.field && String(req.query.value || "").trim()) {
    const key = String(req.query.field);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) throw fail("Unknown field");
    const jobs = await Job.find({ process: filter.process, [`data.${key}`]: new RegExp(esc(String(req.query.value).trim()), "i") }).select("_id").limit(5000).lean();
    filter.job = { $in: jobs.map((j) => j._id) };
  }

  // tasks per FMS (the widget), for the same people
  const perFms = await Task.aggregate([
    { $match: { kind: "app", status: "pending", ...(visible !== null ? { doer: filter.doer } : {}) } },
    { $group: { _id: "$process", pending: { $sum: 1 }, overdue: { $sum: { $cond: [{ $lt: ["$planned", now] }, 1, 0] } } } },
  ]);
  const names = new Map((await Process.find({ _id: { $in: perFms.map((x) => x._id) } }).select("name").lean()).map((p) => [String(p._id), p.name]));

  let tasks = await Task.find(filter)
    .sort(status === "done" ? { resolvedAt: -1 } : { planned: 1 })
    .limit(5000)
    .select("label stepName stepKey process job doer status planned plannedDay actual actualDay values remarks")
    .populate("doer", "name")
    .populate({ path: "job", select: "jobNo data startDate" })
    .populate("process", "name fields")
    .lean();
  for (const t of tasks) {
    t.delay = t.status === "done" ? doneDelay(t) : t.planned && t.planned < now ? Math.floor((now - t.planned) / DAY_MS) : 0;
    t.late = t.status === "done" ? t.delay > 0 : t.planned < now;
  }
  const b = BUCKETS[req.query.delay];
  if (b) tasks = tasks.filter((t) => (req.query.delay === "ontime" ? !t.late : t.late && t.delay >= b[0] && (b[1] === null || t.delay <= b[1])));
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 100;
  const total = tasks.length;
  // keep only the entry fields worth showing in the list
  const shown = tasks.slice((page - 1) * size, page * size).map((t) => {
    const fields = (t.process?.fields || []).filter((f) => !["photo", "longtext", "link"].includes(f.type)).slice(0, 3);
    return { ...t, process: { _id: t.process?._id, name: t.process?.name }, entry: t.job ? { _id: t.job._id, jobNo: t.job.jobNo, summary: fields.map((f) => [f.label, t.job.data?.[f.key]]).filter(([, v]) => v !== undefined && v !== "") } : null, job: undefined };
  });
  res.json({
    total,
    page,
    pages: Math.max(1, Math.ceil(total / size)),
    tasks: shown,
    perFms: perFms.map((x) => ({ _id: x._id, name: names.get(String(x._id)) || "?", pending: x.pending, overdue: x.overdue })).sort((a, z) => z.pending - a.pending),
  });
});

// Admin only: move the planned date of pending FMS steps (recorded in the audit log)
router.post("/fms-tasks/planned", async (req, res) => {
  if (req.user.role !== "admin") throw fail("Only an admin can change planned dates", 403);
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);
  const planned = new Date(req.body?.planned);
  if (!ids.length) throw fail("Select the tasks first");
  if (isNaN(planned)) throw fail("Enter the new planned date and time");
  const reason = String(req.body?.reason || "").trim().slice(0, 300);
  if (reason.length < 3) throw fail("Write why the planned date is changed");
  const r = await Task.updateMany({ _id: { $in: ids }, kind: "app", status: "pending" }, { $set: { planned, plannedDay: dayKey(planned) }, $inc: { __v: 1 } });
  audit(req, "task.planned_change", { entity: "Task", summary: `${r.modifiedCount} FMS step(s) → ${planned.toISOString()}: ${reason}` });
  res.json({ changed: r.modifiedCount, skipped: ids.length - r.modifiedCount });
});

// ---- List Effort Time (MIDAP): how much work each doer had and did, in hours ----
// Effort per task: a checklist's and an FMS step's effort time (from their master, so older tasks count too);
// a delegation's own estimate. ?from= &to= &basis=planned|actual &group=doer|department
router.get("/effort", async (req, res) => {
  const today = todayKey();
  const to = isDay(req.query.to) ? req.query.to : today;
  const from = isDay(req.query.from) ? req.query.from : to.slice(0, 8) + "01";
  const byActual = req.query.basis === "actual";
  const byDept = req.query.group === "department";
  const visible = await visibleUserIds(req.user);
  const match = byActual ? { status: "done", actualDay: { $gte: from, $lte: to } } : { status: { $in: ["pending", "done", "expired"] }, plannedDay: { $gte: from, $lte: to } };
  if (visible !== null) match.doer = { $in: visible.map((id) => new mongoose.Types.ObjectId(id)) };

  const groups = await Task.aggregate([
    { $match: { ...match, kind: { $in: ["checklist", "delegation", "app"] } } },
    {
      $group: {
        _id: { doer: "$doer", kind: "$kind", checklist: "$checklist", process: "$process", step: "$stepKey" },
        tasks: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
        own: { $sum: { $ifNull: ["$effortMinutes", 0] } },
        ownDone: { $sum: { $cond: [{ $eq: ["$status", "done"] }, { $ifNull: ["$effortMinutes", 0] }, 0] } },
      },
    },
  ]);
  const checklistIds = [...new Set(groups.filter((g) => g._id.checklist).map((g) => String(g._id.checklist)))];
  const processIds = [...new Set(groups.filter((g) => g._id.process).map((g) => String(g._id.process)))];
  const [checklists, processes, users, cal] = await Promise.all([
    Checklist.find({ _id: { $in: checklistIds } }).select("effortMinutes").lean(),
    Process.find({ _id: { $in: processIds } }).select("steps.key steps.effortMinutes").lean(),
    User.find({ _id: { $in: [...new Set(groups.map((g) => String(g._id.doer)))] } }).select("name department").populate("department", "name").lean(),
    loadCalendar(),
  ]);
  const clEffort = new Map(checklists.map((c) => [String(c._id), c.effortMinutes || 0]));
  const stepEffort = new Map(processes.flatMap((p) => p.steps.map((st) => [`${p._id}|${st.key}`, st.effortMinutes || 0])));
  const userOf = new Map(users.map((u) => [String(u._id), u]));

  // working days in the range (week-offs and holidays of the company calendar left out)
  let workingDays = 0;
  for (let d = from, i = 0; d <= to && i < 400; d = addDaysKey(d, 1), i++) if (!isOff(d, cal)) workingDays++;

  const TYPE = { checklist: "checklist", delegation: "delegation", app: "fms" };
  const blank = () => ({ tasks: 0, done: 0, plannedMin: 0, doneMin: 0, byType: { checklist: 0, delegation: 0, fms: 0 }, noEffort: 0 });
  const rows = new Map();
  for (const g of groups) {
    const u = userOf.get(String(g._id.doer));
    const key = byDept ? u?.department?.name || "No department" : String(g._id.doer);
    if (!rows.has(key)) rows.set(key, { key, name: byDept ? key : u?.name || "?", department: byDept ? "" : u?.department?.name || "", people: new Set(), ...blank() });
    const r = rows.get(key);
    r.people.add(String(g._id.doer));
    const each = g._id.kind === "checklist" ? clEffort.get(String(g._id.checklist)) || 0 : g._id.kind === "app" ? stepEffort.get(`${g._id.process}|${g._id.step}`) || 0 : null;
    const planned = each === null ? g.own : each * g.tasks;
    const done = each === null ? g.ownDone : each * g.done;
    r.tasks += g.tasks;
    r.done += g.done;
    r.plannedMin += planned;
    r.doneMin += done;
    r.byType[TYPE[g._id.kind]] += planned;
    if (!planned) r.noEffort += g.tasks;
  }
  const total = blank();
  const out = [...rows.values()].map((r) => {
    for (const k of ["tasks", "done", "plannedMin", "doneMin", "noEffort"]) total[k] += r[k];
    for (const k of Object.keys(total.byType)) total.byType[k] += r.byType[k];
    return { ...r, people: r.people.size, avgPerDayMin: workingDays ? Math.round(r.doneMin / workingDays) : 0 };
  });
  out.sort((a, b) => b.plannedMin - a.plannedMin);
  res.json({ from, to, basis: byActual ? "actual" : "planned", group: byDept ? "department" : "doer", workingDays, rows: out, total: { ...total, avgPerDayMin: workingDays ? Math.round(total.doneMin / workingDays) : 0 } });
});

module.exports = router;
