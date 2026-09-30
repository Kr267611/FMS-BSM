const express = require("express");
const mongoose = require("mongoose");
const Checklist = require("../models/Checklist");
const Task = require("../models/Task");
const User = require("../models/User");
const TaskGroup = require("../models/TaskGroup");
const { auth, permit } = require("../middleware/auth");
const { can } = require("../services/permissions");
const { visibleUserIds, canSeeUser } = require("../services/scope");
const { audit } = require("../services/audit");
const { todayKey } = require("../services/dates");
const { nextDueDays } = require("../services/recurrence");
const { loadCalendar } = require("../services/workflow");
const cl = require("../services/checklists");

const router = express.Router();
router.use(auth);

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const withNames = (q) => q.populate("doer", "name department").populate("pc", "name").populate("auditor", "name").populate("group", "name");
const activeIds = async () => new Set((await User.find({ active: true }).select("_id").lean()).map((u) => String(u._id)));
async function checkGroup(id) {
  if (id && !(await TaskGroup.exists({ _id: id }))) throw fail("Group not found");
}
async function loadVisible(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const c = await Checklist.findById(req.params.id);
  if (!c) throw fail("Checklist not found", 404);
  if (!(await canSeeUser(req.user, c.doer))) throw fail("This checklist belongs to someone outside your department", 403);
  return c;
}

// ---- groups ----
router.get("/groups", async (req, res) => {
  if (!can(req.user, "checklist", "view") && !can(req.user, "delegation", "view")) throw fail("You don't have permission to do this. Ask your admin.", 403);
  const groups = await TaskGroup.find().sort({ name: 1 }).lean();
  const used = await Checklist.aggregate([{ $match: { group: { $ne: null } } }, { $group: { _id: "$group", n: { $sum: 1 } } }]);
  const count = new Map(used.map((u) => [String(u._id), u.n]));
  res.json(groups.map((g) => ({ ...g, checklists: count.get(String(g._id)) || 0 })));
});

router.post("/groups", permit("checklist", "add"), async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) throw fail("Enter the group name");
  if (await TaskGroup.exists({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) throw fail("This group already exists");
  const g = await TaskGroup.create({ name });
  audit(req, "group.create", { entity: "TaskGroup", entityId: g._id, summary: name });
  res.status(201).json(g);
});

router.delete("/groups/:id", permit("checklist", "delete"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const n = await Checklist.countDocuments({ group: req.params.id });
  if (n) throw fail(`${n} checklist(s) use this group. Move them to another group first.`);
  const g = await TaskGroup.findByIdAndDelete(req.params.id);
  if (g) audit(req, "group.delete", { entity: "TaskGroup", entityId: g._id, summary: g.name });
  res.json({ ok: true });
});

// ---- checklists ----
// ?q= &doer= &group= &active=1|0
router.get("/", permit("checklist", "view"), async (req, res) => {
  const visible = await visibleUserIds(req.user);
  const filter = visible === null ? {} : { doer: { $in: visible } };
  if (req.query.doer && mongoose.isValidObjectId(req.query.doer)) {
    if (visible !== null && !visible.includes(String(req.query.doer))) throw fail("You can only see checklists of people in your department", 403);
    filter.doer = req.query.doer;
  }
  if (req.query.group && mongoose.isValidObjectId(req.query.group)) filter.group = req.query.group;
  if (req.query.active === "1") filter.active = true;
  if (req.query.active === "0") filter.active = false;
  const q = String(req.query.q || "").trim();
  if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const list = await withNames(Checklist.find(filter).select("-fields.options").sort({ active: -1, name: 1 }).limit(2000)).lean();
  const cal = await loadCalendar();
  const today = todayKey();
  res.json(
    list.map((c) => ({
      ...c,
      schedule: cl.describe(c),
      nextDue: c.active ? nextDueDays(c, today, 1, cal)[0] || null : null,
      formCount: c.fields?.length || 0,
      fields: undefined,
    }))
  );
});

// Next due days for a schedule that is being typed in the form
router.post("/preview", permit("checklist", "view"), async (req, res) => {
  const c = cl.cleanChecklist(req.body, { preview: true });
  res.json({ schedule: cl.describe(c), days: await cl.preview(c, 8) });
});

// rows: [{ task, doer, frequency, days, dates, every, start, end, due_time, create_before, if_holiday, auto_close_days, priority, group, pc, auditor, proof, how }]
router.post("/bulk", permit("checklist", "add"), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
  if (!rows.length) throw fail("The file has no rows");
  const dryRun = req.body?.dryRun !== false;
  const results = await cl.importRows(rows, { user: req.user, dryRun });
  const ok = results.filter((r) => r.ok).length;
  if (!dryRun) audit(req, "checklist.bulk_upload", { entity: "Checklist", summary: `${ok} created, ${results.length - ok} failed` });
  res.json({ dryRun, ok, failed: results.length - ok, results });
});

router.get("/:id", permit("checklist", "view"), async (req, res) => {
  const c = await loadVisible(req);
  const full = await withNames(Checklist.findById(c._id)).lean();
  const recent = await Task.find({ checklist: c._id, plannedDay: { $lte: todayKey() } })
    .sort({ plannedDay: -1 })
    .limit(14)
    .select("plannedDay status actual actualDay remarks doer")
    .populate("doer", "name")
    .lean();
  res.json({ ...full, schedule: cl.describe(full), days: await cl.preview(full, 8), recent });
});

router.post("/", permit("checklist", "add"), async (req, res) => {
  const data = cl.cleanChecklist(req.body, { activeIds: await activeIds() });
  await checkGroup(data.group);
  if (!(await canSeeUser(req.user, data.doer))) throw fail("You can only give checklists to people in your department", 403);
  const c = await Checklist.create({ ...data, createdBy: req.user._id });
  const created = await cl.generateChecklist(c.toObject());
  audit(req, "checklist.create", { entity: "Checklist", entityId: c._id, summary: `${c.name} (${cl.describe(c)}), ${created} task(s) made` });
  res.status(201).json(c);
});

// Later days are made again with the new rules; tasks up to today keep their doer and time
router.put("/:id", permit("checklist", "edit"), async (req, res) => {
  const c = await loadVisible(req);
  const before = c.toObject();
  const data = cl.cleanChecklist(req.body, { activeIds: await activeIds() });
  await checkGroup(data.group);
  if (!(await canSeeUser(req.user, data.doer))) throw fail("You can only give checklists to people in your department", 403);
  Object.assign(c, data);
  if (!data.end) c.end = undefined;
  await c.save();
  await cl.afterChange(c.toObject(), before);
  const notes = [before.active !== c.active && (c.active ? "switched on" : "switched off"), String(before.doer) !== String(c.doer) && "doer changed", cl.describe(before) !== cl.describe(c) && `now ${cl.describe(c)}`].filter(Boolean);
  audit(req, "checklist.update", { entity: "Checklist", entityId: c._id, summary: `${c.name}${notes.length ? ": " + notes.join(", ") : ""}` });
  res.json(c);
});

// Only a checklist that never came due can be deleted; otherwise switch it off so its history stays in the MIS
router.delete("/:id", permit("checklist", "delete"), async (req, res) => {
  const c = await loadVisible(req);
  if (await Task.exists({ checklist: c._id, plannedDay: { $lte: todayKey() } })) {
    throw fail("This checklist already has tasks in the MIS. Switch it off (untick Active) instead.");
  }
  await Task.deleteMany({ checklist: c._id });
  await Checklist.deleteOne({ _id: c._id });
  audit(req, "checklist.delete", { entity: "Checklist", entityId: c._id, summary: c.name });
  res.json({ ok: true });
});

module.exports = router;
