import express = require("express");
import mongoose = require("mongoose");
import Process = require("../models/Process");
import Job = require("../models/Job");
import Task = require("../models/Task");
import AutoComplete = require("../models/AutoComplete");
import FmsReminder = require("../models/FmsReminder");
import User = require("../models/User");
import OrgLib = require("../models/Org");
const { Department } = OrgLib;
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;
import permissionsLib = require("../services/permissions");
const { can } = permissionsLib;
import auditLib = require("../services/audit");
const { audit } = auditLib;
import definitionLib = require("../services/fms/definition");
const { normalizeProcess } = definitionLib;
import doersLib = require("../services/fms/doers");
const { directory } = doersLib;
import templates = require("../templates");
import sheetSync = require("../services/fmsSheetSync");
import sheetSyncLib = require("../services/sheetSync");

const router = express.Router();

const withNames = (q) =>
  q.populate("steps.doer.user", "name active").populate("steps.doer.fallback", "name active").populate("pc", "name").populate("department", "name");

async function clean(body) {
  const active = await User.find({ active: true }).select("_id").lean<any>();
  const data = normalizeProcess(body, { activeIds: new Set<any>(active.map((u) => String(u._id))) });
  if (data.department && !(await Department.exists({ _id: data.department }))) {
    const err = new Error("Department not found");
    err.status = 400;
    throw err;
  }
  return data;
}

// Ready-made FMS (e.g. the Repeat Spare Part sheet), with doers matched to users by name
router.get("/templates", auth, permit("fms", "add"), (req, res) => {
  res.json(templates.list());
});

router.get("/templates/:id", auth, permit("fms", "add"), async (req, res) => {
  const users = await User.find({ active: true }).select("name active").lean<any>();
  const draft: any = templates.build(req.params.id, directory(users));
  if (!draft) return res.status(404).json({ message: "Template not found" });
  const existing = await Process.findOne({ name: draft.name }).select("_id").lean<any>();
  if (existing) draft.existingId = existing._id; // an older FMS already has this name
  res.json(draft);
});

// summary=1: without doer tables and step fields (for dropdowns and cards)
// FMS definitions: for the FMS Manager, FMS entries and the FMS reports – nobody else
const usesFms = (req, res, next) =>
  ["fms", "fmsEntries", "reports"].some((m) => can(req.user, m, "view")) ? next() : res.status(403).json({ message: "You don't have permission to do this. Ask your admin." });

router.get("/", auth, usesFms, async (req, res) => {
  const filter = req.query.all === "1" && can(req.user, "fms", "view") ? {} : { active: true };
  let q = Process.find(filter).sort({ active: -1, name: 1 });
  if (req.query.summary === "1") q = q.select("-steps.doer.map -steps.fields -steps.how -steps.tatOverrides");
  const list = await withNames(q).lean();
  res.json(list);
});

router.get("/:id", auth, usesFms, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid ID" });
  const p = await withNames(Process.findById(req.params.id)).lean();
  if (!p) return res.status(404).json({ message: "FMS not found" });
  res.json(p);
});

router.post("/", auth, permit("fms", "add"), async (req, res) => {
  const data = await clean(req.body);
  if (await Process.exists({ name: data.name })) return res.status(400).json({ message: "An FMS with this name already exists" });
  data.steps.forEach((s) => delete s._id);
  const p = await Process.create(data);
  audit(req, "fms.create", { entity: "Process", entityId: p._id, summary: `${p.name} (${p.steps.length} steps${p.active ? "" : ", draft"})` });
  res.status(201).json(p);
});

// Rule changes apply to steps that have not started yet; steps already started keep their planned date and doer.
router.put("/:id", auth, permit("fms", "edit"), async (req, res) => {
  const p = await Process.findById(req.params.id);
  if (!p) return res.status(404).json({ message: "FMS not found" });
  const data = await clean({ ...req.body, active: req.body?.active ?? p.active });
  if (await Process.exists({ name: data.name, _id: { $ne: p._id } })) {
    return res.status(400).json({ message: "An FMS with this name already exists" });
  }
  const before = new Set<any>(p.steps.map((s) => s.key));
  const after = new Set<any>(data.steps.map((s) => s.key));
  const added = data.steps.filter((s) => !before.has(s.key)).map((s) => s.name);
  const removed = p.steps.filter((s) => !after.has(s.key)).map((s) => s.name);
  Object.assign(p, data);
  await p.save();
  const notes = [added.length && `added ${added.join(", ")}`, removed.length && `removed ${removed.join(", ")}`].filter(Boolean);
  audit(req, "fms.update", { entity: "Process", entityId: p._id, summary: `${p.name}${notes.length ? ": " + notes.join("; ") : ""}` });
  res.json(p);
});

// Delete an FMS from the software ("FMS Manager – Delete" permission, which an admin gives per user; body
// confirm: "DELETE"): the FMS, its entries, their steps and its
// Auto Complete / reminder rules. Only the software's own data – a Google Sheet it was imported from is never touched.
// ---------- Sheet Sync (an FMS imported from a Google Sheet) ----------
const STATES = ["written", "partial", "skipped", "failed", "row-mismatch", "no-row", "cleared", "nothing", "from-sheet"];
router.get("/:id/sheet-sync", auth, permit("fms", "view"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid ID" });
  const p = await Process.findById(req.params.id).lean<any>();
  if (!p) return res.status(404).json({ message: "FMS not found" });
  const config = sheetSync.configOf(p);
  if (!config) return res.json({ config: null });
  const [recent, counts] = await Promise.all([
    Task.find({ process: p._id, sheetPush: { $ne: null }, "sheetPush.state": { $ne: "from-sheet" } })
      .sort({ "sheetPush.at": -1 })
      .limit(60)
      .select("stepKey stepName job sheetPush status")
      .populate("job", "jobNo sheetRow")
      .lean<any>(),
    Task.aggregate([{ $match: { process: p._id, sheetPush: { $ne: null } } }, { $group: { _id: "$sheetPush.state", n: { $sum: 1 } } }]),
  ]);
  res.json({
    config,
    serviceAccount: sheetSyncLib.serviceAccountEmail(),
    sheetUrl: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
    counts: Object.fromEntries(STATES.map((s) => [s, counts.find((c) => c._id === s)?.n || 0])),
    recent: recent.map((t) => ({ _id: t._id, step: t.stepName, jobNo: t.job?.jobNo, row: t.job?.sheetRow, status: t.status, ...t.sheetPush })),
  });
});
router.put("/:id/sheet-sync", auth, permit("fms", "edit"), async (req, res) => {
  const p = await Process.findById(req.params.id);
  if (!p) return res.status(404).json({ message: "FMS not found" });
  try {
    p.sheetSync = sheetSync.cleanConfig(p.toObject(), req.body);
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }
  p.markModified("sheetSync");
  await p.save();
  const s = p.sheetSync;
  const steps = Object.entries<any>(s.steps).filter(([, v]) => v.mode !== "inherit").map(([k, v]) => `${k} ${v.mode === "app" ? "app only" : "app + sheet"}`);
  audit(req, "fms.sheet_sync", { entity: "Process", entityId: p._id, summary: `${p.name}: App → Sheet ${s.push ? "on" : "off"}, Sheet → App ${s.pull ? "on" : "off"}${steps.length ? "; " + steps.join(", ") : ""}` });
  res.json({ config: sheetSync.configOf(p.toObject()) });
});
router.post("/:id/sheet-sync/check", auth, permit("fms", "edit"), async (req, res) => {
  const p = await Process.findById(req.params.id).lean<any>();
  if (!p) return res.status(404).json({ message: "FMS not found" });
  res.json(await sheetSync.checkSheet(p));
});
// write again: the given steps, or every failed / not-written one of the last 7 days
router.post("/:id/sheet-sync/retry", auth, permit("fms", "edit"), async (req, res) => {
  const p = await Process.findById(req.params.id).select("_id").lean<any>();
  if (!p) return res.status(404).json({ message: "FMS not found" });
  const ids = (Array.isArray(req.body?.taskIds) ? req.body.taskIds : []).filter((x) => mongoose.isValidObjectId(x)).slice(0, 200);
  const tasks = ids.length
    ? await Task.find({ _id: { $in: ids }, process: p._id }).select("_id").lean<any>()
    : await Task.find({ process: p._id, "sheetPush.state": { $in: ["failed", "row-mismatch", "skipped", "partial"] }, status: { $in: ["done", "na"] } }).select("_id").limit(200).lean<any>();
  const out = [];
  for (const t of tasks) {
    await Task.updateOne({ _id: t._id }, { $set: { "sheetPush.tries": 0 } });
    out.push(await sheetSync.pushTask(t._id));
  }
  res.json({ tried: out.length, written: out.filter((r) => r?.state === "written").length });
});
router.post("/:id/sheet-sync/pull", auth, permit("fms", "edit"), async (req, res) => {
  const p = await Process.findById(req.params.id).lean<any>();
  if (!p) return res.status(404).json({ message: "FMS not found" });
  if (!sheetSync.configOf(p)?.pull) return res.status(400).json({ message: "Switch on Sheet → App first" });
  try {
    const r = await sheetSync.pullProcess(p);
    audit(req, "fms.sheet_pull", { entity: "Process", entityId: p._id, summary: `${p.name}: ${r.finished} step(s) finished from the sheet, ${r.skipped} row(s) skipped` });
    res.json(r);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/:id", auth, async (req, res) => {
  if (!can(req.user, "fms", "delete")) return res.status(403).json({ message: "You do not have the permission to delete an FMS. An admin can give it in Users." });
  if (req.body?.confirm !== "DELETE") return res.status(400).json({ message: "Type DELETE to confirm" });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid ID" });
  const p = await Process.findById(req.params.id).select("name").lean<any>();
  if (!p) return res.status(404).json({ message: "FMS not found" });
  const [tasks, jobs, rules, reminders] = await Promise.all([
    Task.deleteMany({ process: p._id }),
    Job.deleteMany({ process: p._id }),
    AutoComplete.deleteMany({ $or: [{ process: p._id }, { target: p._id }] }),
    FmsReminder.deleteMany({ process: p._id }),
  ]);
  await Process.deleteOne({ _id: p._id });
  const out = { entries: jobs.deletedCount, steps: tasks.deletedCount, rules: rules.deletedCount + reminders.deletedCount };
  audit(req, "fms.delete", { entity: "Process", entityId: p._id, summary: `${p.name}: FMS deleted with ${out.entries} entries and ${out.steps} steps` });
  res.json(out);
});

// A copy to start a similar FMS from; saved as a draft
router.post("/:id/duplicate", auth, permit("fms", "add"), async (req, res) => {
  const src = await Process.findById(req.params.id).lean<any>();
  if (!src) return res.status(404).json({ message: "FMS not found" });
  let name = `${src.name} (copy)`;
  for (let n = 2; await Process.exists({ name }); n++) name = `${src.name} (copy ${n})`;
  const { _id, createdAt, updatedAt, jobCounter, ...rest } = src;
  const p = await Process.create({ ...rest, name, active: false, jobCounter: 0, steps: rest.steps.map(({ _id: sid, ...s }: any) => s) });
  audit(req, "fms.create", { entity: "Process", entityId: p._id, summary: `${p.name} (copy of ${src.name})` });
  res.status(201).json(p);
});

export = router;
