const express = require("express");
const Process = require("../models/Process");
const User = require("../models/User");
const { auth, adminOnly } = require("../middleware/auth");

const router = express.Router();

function slug(label) {
  return String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
}

async function cleanBody(body) {
  const { name, description, skipSundays, fields = [], steps = [] } = body || {};
  if (!name || !String(name).trim()) throw new Error("Enter a process name");
  if (!Array.isArray(steps) || !steps.length) throw new Error("Add at least one step");

  const cleanSteps = steps.map((s, i) => {
    if (!s.name || !String(s.name).trim()) throw new Error(`Enter a name for step ${i + 1}`);
    if (!s.doer) throw new Error(`Choose a doer for step "${s.name}"`);
    const tat = Number(s.tat);
    if (!(tat >= 0)) throw new Error(`Enter a valid TAT for step "${s.name}"`);
    return {
      _id: s._id,
      name: String(s.name).trim(),
      doer: s.doer,
      tat,
      tatUnit: s.tatUnit === "hours" ? "hours" : "days",
      how: s.how || "",
    };
  });

  const doerIds = [...new Set(cleanSteps.map((s) => String(s.doer)))];
  const found = await User.countDocuments({ _id: { $in: doerIds }, active: true });
  if (found !== doerIds.length) throw new Error("One of the doers is invalid or inactive");

  const seen = new Set();
  const cleanFields = fields
    .filter((f) => f && String(f.label || "").trim())
    .map((f) => {
      let key = f.key || slug(f.label);
      while (seen.has(key)) key += "_";
      seen.add(key);
      return {
        _id: f._id,
        key,
        label: String(f.label).trim(),
        type: ["text", "number", "date", "select"].includes(f.type) ? f.type : "text",
        options: f.type === "select" ? (f.options || []).map(String).filter(Boolean) : [],
        required: Boolean(f.required),
      };
    });

  return {
    name: String(name).trim(),
    description: description || "",
    skipSundays: Boolean(skipSundays),
    fields: cleanFields,
    steps: cleanSteps,
  };
}

router.get("/", auth, async (req, res) => {
  const filter = req.query.all === "1" && req.user.role === "admin" ? {} : { active: true };
  res.json(await Process.find(filter).populate("steps.doer", "name").sort({ name: 1 }).lean());
});

router.get("/:id", auth, async (req, res) => {
  const p = await Process.findById(req.params.id).populate("steps.doer", "name").lean();
  if (!p) return res.status(404).json({ message: "Process not found" });
  res.json(p);
});

router.post("/", auth, adminOnly, async (req, res) => {
  try {
    const data = await cleanBody(req.body);
    if (await Process.exists({ name: data.name })) return res.status(400).json({ message: "A process with this name already exists" });
    res.status(201).json(await Process.create(data));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Changes apply to NEW jobs only - existing jobs keep the doer/TAT copied into their tasks
router.put("/:id", auth, adminOnly, async (req, res) => {
  try {
    const data = await cleanBody(req.body);
    const p = await Process.findById(req.params.id);
    if (!p) return res.status(404).json({ message: "Process not found" });
    if (await Process.exists({ name: data.name, _id: { $ne: p._id } })) {
      return res.status(400).json({ message: "A process with this name already exists" });
    }
    if (req.body.active !== undefined) p.active = Boolean(req.body.active);
    Object.assign(p, data);
    await p.save();
    res.json(p);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
