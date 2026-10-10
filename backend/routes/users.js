const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const { Branch, Department } = require("../models/Org");
const { auth, permit } = require("../middleware/auth");
const { passwordProblem } = require("../services/passwords");
const { ROLES, MODULES, ACTIONS, ROLE_DEFAULTS, cleanOverrides } = require("../services/permissions");
const { visibleUserIds, canSeeUser } = require("../services/scope");
const { audit } = require("../services/audit");

const router = express.Router();

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const cleanEmail = (s) => String(s || "").toLowerCase().trim();
const isId = (v) => mongoose.isValidObjectId(v);

async function emailProblem(email, exceptId) {
  if (!email) return null;
  if (!isEmail(email)) return "Enter a valid email address";
  if (await User.exists({ email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })) {
    return "Another user already has this email address";
  }
  return null;
}

// Only admins can create or promote admins
function roleProblem(actor, role) {
  if (!ROLES[role]) return "Choose a valid role";
  if (role === "admin" && actor.role !== "admin") return "Only an admin can make someone an admin";
  return null;
}

async function refsProblem({ branch, department, managedDepartments, teamLeader }) {
  if (branch && !(isId(branch) && (await Branch.exists({ _id: branch })))) return "Branch not found";
  if (department && !(isId(department) && (await Department.exists({ _id: department })))) return "Department not found";
  for (const d of managedDepartments || []) {
    if (!(isId(d) && (await Department.exists({ _id: d })))) return "One of the managed departments was not found";
  }
  if (teamLeader && !(isId(teamLeader) && (await User.exists({ _id: teamLeader, active: true })))) return "Team leader must be an active user";
  return null;
}

const populateUser = (q) =>
  q.populate("department", "name").populate("branch", "name").populate("teamLeader", "name").populate("managedDepartments", "name");

function strip(u) {
  const out = u.toObject ? u.toObject() : { ...u };
  delete out.password;
  return out;
}

// Roles, modules and default permissions, for the user form
router.get("/meta", auth, (req, res) => {
  res.json({ roles: ROLES, modules: MODULES, actions: ACTIONS, roleDefaults: ROLE_DEFAULTS });
});

// For dropdowns - every signed-in user needs the list of doers
router.get("/list", auth, async (req, res) => {
  const users = await User.find({ active: true }).select("name role department").populate("department", "name").sort({ name: 1 }).lean();
  res.json(users.map((u) => ({ ...u, department: u.department?.name || "" })));
});

router.get("/", auth, permit("users", "view"), async (req, res) => {
  const visible = await visibleUserIds(req.user);
  const filter = visible === null ? {} : { _id: { $in: visible } };
  res.json(await populateUser(User.find(filter).sort({ active: -1, name: 1 })).lean());
});

function userFields(body) {
  const b = body || {};
  return {
    name: b.name,
    role: b.role || "doer",
    branch: b.branch || undefined,
    department: b.department || undefined,
    managedDepartments: Array.isArray(b.managedDepartments) ? b.managedDepartments.filter(Boolean) : [],
    teamLeader: b.teamLeader || undefined,
    phone: b.phone,
  };
}

router.post("/", auth, permit("users", "add"), async (req, res) => {
  const { username, password } = req.body || {};
  const f = userFields(req.body);
  const email = cleanEmail(req.body?.email);
  if (!f.name || !username || !password) return res.status(400).json({ message: "Name, username and password are required" });
  const problem =
    passwordProblem(password) ||
    roleProblem(req.user, f.role) ||
    (await emailProblem(email)) ||
    (await refsProblem(f)) ||
    ((await User.exists({ username: String(username).toLowerCase().trim() })) ? "This username is already taken" : null);
  if (problem) return res.status(400).json({ message: problem });

  const user = await User.create({
    ...f,
    username,
    email,
    password: await bcrypt.hash(String(password), 10),
    permissions: req.user.role === "admin" ? cleanOverrides(req.body?.permissions) : undefined,
    weekOff: ((w) => (w.length && w.length < 7 ? w : undefined))(Array.isArray(req.body?.weekOff) ? [...new Set(req.body.weekOff.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort() : []),
  });
  audit(req, "user.create", { entity: "User", entityId: user._id, summary: `${user.name} (${user.role})` });
  res.status(201).json(strip(user));
});

router.put("/:id", auth, permit("users", "edit"), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  if (!(await canSeeUser(req.user, user._id))) return res.status(403).json({ message: "You can only edit people in your department" });
  if (user.role === "admin" && req.user.role !== "admin") return res.status(403).json({ message: "Only an admin can edit an admin" });

  const b = req.body || {};
  const isSelf = String(user._id) === String(req.user._id);
  if (isSelf && (b.active === false || (b.role && b.role !== user.role))) {
    return res.status(400).json({ message: "You cannot deactivate yourself or change your own role" });
  }

  const f = userFields({ ...user.toObject(), ...b });
  const problem =
    (b.role !== undefined ? roleProblem(req.user, b.role) : null) ||
    (b.email !== undefined ? await emailProblem(cleanEmail(b.email), user._id) : null) ||
    (await refsProblem(f)) ||
    (b.password ? passwordProblem(b.password) : null);
  if (problem) return res.status(400).json({ message: problem });

  // Record only fields whose value really changes
  const changes = [];
  const same = (a, c) => JSON.stringify(a ?? null) === JSON.stringify(c ?? null);
  const idStr = (x) => (x ? String(x) : null);
  for (const k of ["name", "phone"]) if (b[k] !== undefined && b[k] !== user[k]) (user[k] = b[k]), changes.push(k);
  if (b.email !== undefined && cleanEmail(b.email) !== user.email) (user.email = cleanEmail(b.email)), changes.push("email");
  if (b.role !== undefined && b.role !== user.role) (user.role = b.role), changes.push(`role→${b.role}`);
  for (const k of ["branch", "department", "teamLeader"]) {
    if (b[k] !== undefined && idStr(b[k] || null) !== idStr(user[k])) (user[k] = b[k] || undefined), changes.push(k);
  }
  if (b.managedDepartments !== undefined && !same(f.managedDepartments.map(String).sort(), (user.managedDepartments || []).map(String).sort())) {
    user.managedDepartments = f.managedDepartments;
    changes.push("managed departments");
  }
  // own week-off: [] or null = the company's; the doer's coming checklist tasks are made again with it
  let weekOffChanged = false;
  if (b.weekOff !== undefined) {
    const next = Array.isArray(b.weekOff) ? [...new Set(b.weekOff.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort() : [];
    if (next.length >= 7) return res.status(400).json({ message: "At least one day of the week must be a working day" });
    if (!same(next.length ? next : null, user.weekOff?.length ? [...user.weekOff] : null)) {
      user.weekOff = next.length ? next : undefined;
      weekOffChanged = true;
      changes.push(next.length ? `own week-off ${next.join(",")}` : "company week-off");
    }
  }
  if (b.permissions !== undefined && req.user.role === "admin") {
    const next = cleanOverrides(b.permissions);
    if (!same(next, user.permissions)) {
      user.permissions = next;
      user.markModified("permissions");
      changes.push("permissions");
    }
  }
  if (b.active !== undefined && Boolean(b.active) !== user.active) {
    if (user.active && !b.active) user.tokenVersion = (user.tokenVersion || 0) + 1; // sign out a deactivated user
    user.active = Boolean(b.active);
    changes.push(user.active ? "activated" : "deactivated");
  }
  if (b.password) {
    user.password = await bcrypt.hash(String(b.password), 10);
    user.tokenVersion = (user.tokenVersion || 0) + 1; // admin reset signs the user out everywhere
    changes.push("password reset");
  }
  await user.save();
  if (weekOffChanged) {
    const Checklist = require("../models/Checklist");
    const { afterChange } = require("../services/checklists");
    for (const c of await Checklist.find({ doer: user._id, active: true }).lean()) await afterChange(c, c);
  }
  audit(req, "user.update", { entity: "User", entityId: user._id, summary: `${user.name}: ${changes.join(", ") || "no changes"}` });
  res.json(strip(await populateUser(User.findById(user._id))));
});

// ---- bulk upload ----
// rows: [{ name, email, username?, phone?, role?, department?, branch? }] (names, not ids).
// Missing departments / branches are created when createMissing is true.
const tempPassword = () => {
  const s = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
  return `Bsm${s}${crypto.randomInt(10, 99)}`;
};

router.post("/bulk", auth, permit("users", "add"), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
  const createMissing = Boolean(req.body?.createMissing);
  if (!rows.length) return res.status(400).json({ message: "The file has no rows" });

  const deptCache = new Map((await Department.find().lean()).map((d) => [d.name.toLowerCase(), d._id]));
  const branchCache = new Map((await Branch.find().lean()).map((b) => [b.name.toLowerCase(), b._id]));
  async function resolve(cache, Model, name, label) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return undefined;
    if (cache.has(key)) return cache.get(key);
    if (!createMissing) throw new Error(`${label} "${name}" does not exist`);
    const doc = await Model.create({ name: String(name).trim() });
    cache.set(key, doc._id);
    return doc._id;
  }

  const results = [];
  for (const [i, r] of rows.entries()) {
    const line = i + 2; // row 1 is the header
    try {
      const name = String(r.name || "").trim();
      const email = cleanEmail(r.email);
      const username = String(r.username || email.split("@")[0] || "").toLowerCase().trim();
      const role = String(r.role || "doer").toLowerCase().trim();
      if (!name) throw new Error("Name is missing");
      if (!username) throw new Error("Give an email or a username");
      const problem =
        roleProblem(req.user, role) ||
        (await emailProblem(email)) ||
        ((await User.exists({ username })) ? `Username "${username}" is already taken` : null);
      if (problem) throw new Error(problem);

      const password = tempPassword();
      const user = await User.create({
        name,
        username,
        email,
        phone: String(r.phone || "").trim(),
        role,
        department: await resolve(deptCache, Department, r.department, "Department"),
        branch: await resolve(branchCache, Branch, r.branch, "Branch"),
        password: await bcrypt.hash(password, 10),
      });
      results.push({ line, ok: true, name, username, email, tempPassword: password, id: user._id });
    } catch (err) {
      results.push({ line, ok: false, name: r.name, error: err.message });
    }
  }
  const created = results.filter((r) => r.ok).length;
  audit(req, "user.bulk_upload", { entity: "User", summary: `${created} created, ${results.length - created} failed` });
  res.json({ created, failed: results.length - created, results });
});

module.exports = router;
