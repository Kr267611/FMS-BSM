const express = require("express");
const mongoose = require("mongoose");
const AutoComplete = require("../models/AutoComplete");
const { auth, permit } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { cleanRule } = require("../services/autoComplete");

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

module.exports = router;
