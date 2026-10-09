const express = require("express");
const mongoose = require("mongoose");
const AutoComplete = require("../models/AutoComplete");
const { auth, permit } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { cleanRule } = require("../services/autoComplete");
const FmsReminder = require("../models/FmsReminder");
const reminders = require("../services/fmsReminders");

const router = express.Router();
router.use(auth);

const named = (q) => q.populate("source.process", "name steps.key steps.name").populate("target", "name");

// ---- FMS Auto Complete ----
router.get("/auto-complete", permit("fms", "view"), async (req, res) => {
  res.json(await named(AutoComplete.find().sort({ active: -1, name: 1 })).lean());
});

router.post("/auto-complete", permit("fms", "add"), async (req, res) => {
  const r = await AutoComplete.create({ ...(await cleanRule(req.body)), createdBy: req.user._id });
  audit(req, "fms.auto_complete_create", { entity: "AutoComplete", entityId: r._id, summary: r.name });
  res.status(201).json(r);
});

router.put("/auto-complete/:id", permit("fms", "edit"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid ID" });
  const r = await AutoComplete.findById(req.params.id);
  if (!r) return res.status(404).json({ message: "Rule not found" });
  Object.assign(r, await cleanRule(req.body));
  if (!r.when) r.when = undefined;
  await r.save();
  audit(req, "fms.auto_complete_update", { entity: "AutoComplete", entityId: r._id, summary: `${r.name}${r.active ? "" : " (off)"}` });
  res.json(r);
});

router.delete("/auto-complete/:id", permit("fms", "delete"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid ID" });
  const r = await AutoComplete.findByIdAndDelete(req.params.id);
  if (r) audit(req, "fms.auto_complete_delete", { entity: "AutoComplete", entityId: r._id, summary: r.name });
  res.json({ ok: true });
});

// ---- FMS Reminder / Override Notification ----
router.get("/reminders", permit("fms", "view"), async (req, res) => {
  const [list, stats] = await Promise.all([FmsReminder.find().populate("process", "name steps.key steps.name").sort({ active: -1, name: 1 }).lean(), reminders.stats()]);
  res.json({ vars: reminders.VARS, defaults: { subject: reminders.DEFAULT_SUBJECT, message: reminders.DEFAULT_MESSAGE }, list: list.map((r) => ({ ...r, stats: stats.get(String(r._id)) || null })) });
});

router.post("/reminders", permit("fms", "add"), async (req, res) => {
  const r = await FmsReminder.create({ ...(await reminders.cleanReminder(req.body)), createdBy: req.user._id });
  audit(req, "fms.reminder_create", { entity: "FmsReminder", entityId: r._id, summary: r.name });
  res.status(201).json(r);
});

router.put("/reminders/:id", permit("fms", "edit"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid ID" });
  const r = await FmsReminder.findById(req.params.id);
  if (!r) return res.status(404).json({ message: "Reminder not found" });
  Object.assign(r, await reminders.cleanReminder(req.body));
  if (!r.when) r.when = undefined;
  await r.save();
  audit(req, "fms.reminder_update", { entity: "FmsReminder", entityId: r._id, summary: `${r.name}${r.active ? "" : " (off)"}` });
  res.json(r);
});

router.delete("/reminders/:id", permit("fms", "delete"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid ID" });
  const r = await FmsReminder.findByIdAndDelete(req.params.id);
  if (r) audit(req, "fms.reminder_delete", { entity: "FmsReminder", entityId: r._id, summary: r.name });
  res.json({ ok: true });
});

module.exports = router;
