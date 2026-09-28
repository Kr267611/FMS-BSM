const express = require("express");
const { Branch, Department } = require("../models/Org");
const User = require("../models/User");
const { auth, permit } = require("../middleware/auth");
const { audit } = require("../services/audit");

const router = express.Router();
router.use(auth);

const clean = (s) => String(s || "").trim();

// ---- branches ----
router.get("/branches", async (req, res) => {
  res.json(await Branch.find().sort({ active: -1, name: 1 }).lean());
});

router.post("/branches", permit("org", "add"), async (req, res) => {
  const name = clean(req.body?.name);
  if (!name) return res.status(400).json({ message: "Enter a branch name" });
  if (await Branch.exists({ name })) return res.status(400).json({ message: "A branch with this name already exists" });
  const b = await Branch.create({ name, address: clean(req.body?.address) });
  audit(req, "branch.create", { entity: "Branch", entityId: b._id, summary: name });
  res.status(201).json(b);
});

router.put("/branches/:id", permit("org", "edit"), async (req, res) => {
  const b = await Branch.findById(req.params.id);
  if (!b) return res.status(404).json({ message: "Branch not found" });
  const name = clean(req.body?.name);
  if (name && name !== b.name) {
    if (await Branch.exists({ name, _id: { $ne: b._id } })) return res.status(400).json({ message: "A branch with this name already exists" });
    b.name = name;
  }
  if (req.body?.address !== undefined) b.address = clean(req.body.address);
  if (req.body?.active !== undefined) b.active = Boolean(req.body.active);
  await b.save();
  audit(req, "branch.update", { entity: "Branch", entityId: b._id, summary: b.name });
  res.json(b);
});

// ---- departments ----
router.get("/departments", async (req, res) => {
  const [depts, counts] = await Promise.all([
    Department.find().populate("branch", "name").populate("hod", "name").sort({ active: -1, name: 1 }).lean(),
    User.aggregate([{ $match: { active: true, department: { $ne: null } } }, { $group: { _id: "$department", n: { $sum: 1 } } }]),
  ]);
  const n = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(depts.map((d) => ({ ...d, users: n.get(String(d._id)) || 0 })));
});

async function deptBody(body, exceptId) {
  const name = clean(body?.name);
  if (!name) throw new Error("Enter a department name");
  if (await Department.exists({ name, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })) {
    throw new Error("A department with this name already exists");
  }
  const out = { name, branch: body?.branch || undefined, hod: body?.hod || undefined };
  if (out.branch && !(await Branch.exists({ _id: out.branch }))) throw new Error("Branch not found");
  if (out.hod && !(await User.exists({ _id: out.hod, active: true }))) throw new Error("HOD must be an active user");
  return out;
}

router.post("/departments", permit("org", "add"), async (req, res) => {
  try {
    const d = await Department.create(await deptBody(req.body));
    audit(req, "department.create", { entity: "Department", entityId: d._id, summary: d.name });
    res.status(201).json(d);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/departments/:id", permit("org", "edit"), async (req, res) => {
  const d = await Department.findById(req.params.id);
  if (!d) return res.status(404).json({ message: "Department not found" });
  try {
    const body = await deptBody(req.body, d._id);
    d.name = body.name;
    d.branch = body.branch;
    d.hod = body.hod;
    if (req.body?.active !== undefined) d.active = Boolean(req.body.active);
    await d.save();
    audit(req, "department.update", { entity: "Department", entityId: d._id, summary: d.name });
    res.json(d);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
