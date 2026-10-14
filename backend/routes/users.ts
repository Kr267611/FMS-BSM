import express = require("express");
import crypto = require("crypto");
import bcrypt = require("bcryptjs");
import mongoose = require("mongoose");
import User = require("../models/User");
import OrgLib = require("../models/Org");
const { Branch, Department } = OrgLib;
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;
import passwordsLib = require("../services/passwords");
const { passwordProblem } = passwordsLib;
import permissionsLib = require("../services/permissions");
const { ROLES, MODULES, ACTIONS, ROLE_DEFAULTS, MODULE_ACTIONS, MODULE_GROUPS, ADMIN_ONLY_ROLES, cleanOverrides, permissionsFor, isAdmin, can } = permissionsLib;
import scopeLib = require("../services/scope");
const { visibleUserIds, canSeeUser, reachOf } = scopeLib;
import auditLib = require("../services/audit");
const { audit } = auditLib;
import uploadsLib = require("../services/uploads");
const { saveImage, decodeDataUrl } = uploadsLib;
import Setting = require("../models/Setting");
import sheetFmsLib = require("../services/sheetFms");

const router = express.Router();

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const cleanEmail = (s) => String(s || "").toLowerCase().trim();
const isId = (v) => mongoose.isValidObjectId(v);

async function emailProblem(email, exceptId?) {
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
  if (ADMIN_ONLY_ROLES.includes(role) && !isAdmin(actor)) return `Only an admin can make someone ${ROLES[role]}`;
  return null;
}

async function refsProblem({ branch, department, managedDepartments, teamLeader }: any) {
  if (branch && !(isId(branch) && (await Branch.exists({ _id: branch })))) return "Branch not found";
  if (department && !(isId(department) && (await Department.exists({ _id: department })))) return "Department not found";
  for (const d of managedDepartments || []) {
    if (!(isId(d) && (await Department.exists({ _id: d })))) return "One of the managed departments was not found";
  }
  if (teamLeader && !(isId(teamLeader) && (await User.exists({ _id: teamLeader, active: true })))) return "Team leader must be an active user";
  return null;
}

// Phone: 10-digit mobile number; +91 / 0 in front and spaces are dropped. -> { phone } or { problem }
function cleanPhone(raw) {
  const digits = String(raw ?? "").replace(/[\s-]/g, "").replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, "");
  if (!digits) return { phone: "" };
  if (!/^\d{10}$/.test(digits)) return { problem: "Enter a 10-digit mobile number" };
  return { phone: digits };
}
// a real calendar day ("2026-02-30" is not one, though Date would roll it over to 2 March)
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

// MIDAP "Doer type": the list admins keep in the settings
const DEFAULT_DOER_TYPES = ["Consultant", "Contract", "Intern / Trainee", "Outsourced / Agency", "Part-Time", "Permanent", "Probation", "Temporary"];
async function doerTypes() {
  const s = await Setting.findOne({ key: "doerTypes" }).lean<any>();
  return Array.isArray(s?.value) && s.value.length ? s.value : DEFAULT_DOER_TYPES;
}

// joining date, doer type, profile photo – the checks shared by add and edit. -> { set, problem }
async function profileFields(b, actorId) {
  const set: Record<string, any> = {};
  if (b.joiningDate !== undefined) {
    if (b.joiningDate && !isDay(b.joiningDate)) return { problem: "Enter the joining date" };
    set.joiningDate = b.joiningDate || "";
  }
  if (b.doerType !== undefined) {
    const t = String(b.doerType || "").trim();
    if (t && !(await doerTypes()).includes(t)) return { problem: `"${t}" is not a doer type` };
    set.doerType = t;
  }
  if (b.photo !== undefined) {
    if (!b.photo) set.photo = "";
    else if (String(b.photo).startsWith("data:")) {
      const { buffer } = decodeDataUrl(b.photo);
      if (buffer.length > 2 * 1024 * 1024) return { problem: "The photo can be 2 MB at most" };
      set.photo = ((await saveImage({ dataUrl: b.photo, filename: "profile.jpg", userId: actorId })) as any).id;
    }
  }
  return { set };
}

const populateUser = (q) =>
  q.populate("department", "name").populate("branch", "name").populate("teamLeader", "name").populate("managedDepartments", "name");

function strip(u) {
  const out = u.toObject ? u.toObject() : { ...u };
  delete out.password;
  return out;
}

// Roles, modules and default permissions, for the user form
router.get("/meta", auth, async (req, res) => {
  res.json({ roles: ROLES, modules: MODULES, actions: ACTIONS, moduleActions: MODULE_ACTIONS, groups: MODULE_GROUPS, roleDefaults: ROLE_DEFAULTS, adminOnlyRoles: ADMIN_ONLY_ROLES, doerTypes: await doerTypes() });
});

// Access Overview (admin): every user's effective access, and which modules their department / they themselves change
router.get("/access", auth, async (req, res) => {
  if (!can(req.user, "accessOverview", "view")) return res.status(403).json({ message: "Access Overview needs its tick in Users. Ask your admin." });
  const [users, depts] = await Promise.all([
    User.find({ active: true }).select("name role department permissions seesAll reach isAuditor").populate("department", "name").sort({ name: 1 }).lean<any>(),
    Department.find().select("permissions").lean<any>(),
  ]);
  const deptPerms = new Map<any, any>(depts.map((d) => [String(d._id), d.permissions || null]));
  res.json(
    users.map((u) => {
      const dp = u.department ? deptPerms.get(String(u.department._id)) : null;
      return {
        _id: u._id,
        name: u.name,
        role: u.role,
        department: u.department?.name || "",
        seesAll: reachOf(u) === "all",
        reach: reachOf(u),
        isAuditor: Boolean(u.isAuditor),
        permissions: permissionsFor({ ...u, deptPermissions: dp || undefined }),
        own: Object.keys(u.permissions || {}),
        fromDepartment: Object.keys(dp || {}),
      };
    })
  );
});

// The doer type list (admin): ["Staff", "Worker", …]
router.put("/doer-types", auth, permit("settings", "edit"), async (req, res) => {
  const list = [...new Set<any>((Array.isArray(req.body?.types) ? req.body.types : []).map((t) => String(t || "").trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
  if (!list.length) return res.status(400).json({ message: "Keep at least one doer type" });
  await Setting.updateOne({ key: "doerTypes" }, { $set: { value: list } }, { upsert: true });
  audit(req, "user.doer_types", { entity: "Setting", summary: list.join(", ") });
  res.json(list);
});

// For dropdowns - every signed-in user needs the list of doers
router.get("/list", auth, async (req, res) => {
  const users = await User.find({ active: true }).select("name role department isAuditor").populate("department", "name").sort({ name: 1 }).lean<any>();
  res.json(users.map((u) => ({ ...u, department: u.department?.name || "", isAuditor: Boolean(u.isAuditor) })));
});

router.get("/", auth, permit("users", "view"), async (req, res) => {
  const visible = await visibleUserIds(req.user);
  const filter = visible === null ? {} : { _id: { $in: visible } };
  res.json(await populateUser(User.find(filter).sort({ active: -1, name: 1 })).lean());
});

// "Data kiska dikhe" from the form: "all" = the whole company (seesAll); "" = the role's own; or self / team / department
const REACHES = ["", "self", "team", "department", "all"];
function reachFields(body) {
  const r = body?.reach;
  if (r !== undefined && REACHES.includes(r)) return { seesAll: r === "all", reach: r === "all" ? "" : r };
  if (body?.seesAll !== undefined) return { seesAll: Boolean(body.seesAll) };
  return null;
}

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
    isAuditor: Boolean(b.isAuditor),
  };
}

router.post("/", auth, permit("users", "add"), async (req, res) => {
  const { username, password } = req.body || {};
  const f = userFields(req.body);
  const email = cleanEmail(req.body?.email);
  if (!f.name || !username || !password) return res.status(400).json({ message: "Name, username and password are required" });
  const ph = cleanPhone(req.body?.phone);
  if (ph.problem) return res.status(400).json({ message: ph.problem });
  f.phone = ph.phone;
  const profile = await profileFields(req.body || {}, req.user._id);
  if (profile.problem) return res.status(400).json({ message: profile.problem });
  const problem =
    passwordProblem(password) ||
    roleProblem(req.user, f.role) ||
    (await emailProblem(email)) ||
    (await refsProblem(f)) ||
    ((await User.exists({ username: String(username).toLowerCase().trim() })) ? "This username is already taken" : null);
  if (problem) return res.status(400).json({ message: problem });

  const user = await User.create({
    ...f,
    ...profile.set,
    ...(isAdmin(req.user) ? reachFields(req.body) || {} : {}),
    username,
    email,
    password: await bcrypt.hash(String(password), 10),
    permissions: isAdmin(req.user) ? cleanOverrides(req.body?.permissions) : undefined,
    weekOff: ((w) => (w.length && w.length < 7 ? w : undefined))(Array.isArray(req.body?.weekOff) ? [...new Set<any>(req.body.weekOff.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort() : []),
  });
  audit(req, "user.create", { entity: "User", entityId: user._id, summary: `${user.name} (${user.role})` });
  res.status(201).json(strip(user));
});

router.put("/:id", auth, permit("users", "edit"), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  if (!(await canSeeUser(req.user, user._id))) return res.status(403).json({ message: "You can only edit people in your department" });
  if (ADMIN_ONLY_ROLES.includes(user.role) && !isAdmin(req.user)) return res.status(403).json({ message: `Only an admin can edit ${isAdmin(user) ? "an admin" : "an HR user"}` });

  const b = req.body || {};
  const isSelf = String(user._id) === String(req.user._id);
  if (isSelf && (b.active === false || (b.role && b.role !== user.role))) {
    return res.status(400).json({ message: "You cannot deactivate yourself or change your own role" });
  }

  if (b.phone !== undefined) {
    const ph = cleanPhone(b.phone);
    if (ph.problem) return res.status(400).json({ message: ph.problem });
    b.phone = ph.phone;
  }
  const profile = await profileFields(b, req.user._id);
  if (profile.problem) return res.status(400).json({ message: profile.problem });
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
  const reach = isAdmin(req.user) ? reachFields(b) : null;
  if (reach) {
    const before = user.seesAll ? "all" : user.reach || "";
    if (reach.seesAll !== undefined) user.seesAll = reach.seesAll;
    if (reach.reach !== undefined) user.reach = reach.reach;
    const after = user.seesAll ? "all" : user.reach || "";
    if (after !== before) changes.push(`data: ${({ all: "whole company", self: "only their own", team: "their team", department: "their departments", "": "the role's own" })[after]}`);
  }
  if (b.isAuditor !== undefined && Boolean(b.isAuditor) !== Boolean(user.isAuditor)) (user.isAuditor = Boolean(b.isAuditor)), changes.push(user.isAuditor ? "made auditor" : "no longer auditor");
  for (const [k, v] of Object.entries(profile.set)) if (v !== (user[k] || "")) (user[k] = v), changes.push(k === "photo" ? (v ? "photo" : "photo removed") : k);
  if (b.email !== undefined && cleanEmail(b.email) !== user.email) (user.email = cleanEmail(b.email)), changes.push("email");
  // employee code (the biometric machine id): one person per code, or the machine's punches go to the wrong person
  if (b.employeeCode !== undefined) {
    const code = String(b.employeeCode ?? "").trim().slice(0, 30);
    if (code !== (user.employeeCode || "")) {
      if (code && (await User.exists({ _id: { $ne: user._id }, employeeCode: code }))) return res.status(400).json({ message: `Employee code ${code} already belongs to someone else` });
      user.employeeCode = code;
      changes.push("employee code");
    }
  }
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
    const next = Array.isArray(b.weekOff) ? [...new Set<any>(b.weekOff.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort() : [];
    if (next.length >= 7) return res.status(400).json({ message: "At least one day of the week must be a working day" });
    if (!same(next.length ? next : null, user.weekOff?.length ? [...user.weekOff] : null)) {
      user.weekOff = next.length ? next : undefined;
      weekOffChanged = true;
      changes.push(next.length ? `own week-off ${next.join(",")}` : "company week-off");
    }
  }
  if (b.permissions !== undefined && isAdmin(req.user)) {
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

// Delete a user who never had any work. Anyone with tasks, checklists, FMS steps or leave stays, so their history and
// score stay right – make them Inactive instead (they can no longer sign in and get no new work).
router.delete("/:id", auth, permit("users", "delete"), async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid ID" });
  const user = await User.findById(req.params.id).lean<any>();
  if (!user) return res.status(404).json({ message: "User not found" });
  if (String(user._id) === String(req.user._id)) return res.status(400).json({ message: "You cannot delete yourself" });
  if (ADMIN_ONLY_ROLES.includes(user.role) && !isAdmin(req.user)) return res.status(403).json({ message: "Only an admin can delete this user" });
  if (!(await canSeeUser(req.user, user._id))) return res.status(403).json({ message: "You can only delete people in your department" });
  const id = user._id;
  const [tasks, checklists, fms, leaves, team] = await Promise.all([
    require("../models/Task").countDocuments({ $or: [{ doer: id }, { assignedBy: id }, { auditor: id }, { pc: id }] }),
    require("../models/Checklist").countDocuments({ $or: [{ doer: id }, { pc: id }, { auditor: id }] }),
    require("../models/Process").countDocuments({ $or: [{ pc: id }, { auditor: id }, { "steps.doer.user": id }, { "steps.doer.fallback": id }] }),
    require("../models/Leave").countDocuments({ user: id }),
    User.countDocuments({ teamLeader: id }),
  ]);
  const uses = [tasks && `${tasks} task(s)`, checklists && `${checklists} checklist(s)`, fms && `${fms} FMS`, leaves && `${leaves} leave(s)`, team && `team leader of ${team}`].filter(Boolean);
  if (uses.length) return res.status(400).json({ message: `${user.name} has ${uses.join(", ")}, so the history and score would break. Make them Inactive instead.` });
  await User.deleteOne({ _id: id });
  audit(req, "user.delete", { entity: "User", entityId: id, summary: `${user.name} (${user.username}) deleted` });
  res.json({ message: "User deleted" });
});

// ---- bulk upload ----
// rows: [{ name, email, username?, phone?, role?, department?, branch? }] (names, not ids).
// Missing departments / branches are created when createMissing is true.
const tempPassword = () => {
  const s = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
  return `Bsm${s}${crypto.randomInt(10, 99)}`;
};

// Bulk upload. rows: [{ name, phone, employeeCode, joiningDate, department, designation, role, username, email, branch }]
// dryRun: true only checks and says what each row will do. A person already in the software (same mobile, same
// employee code, or the same full name) is not made twice: only their empty mobile / code / joining date /
// department are filled; their role, department and password stay. skip: line numbers to leave out.
// Role: as given, else PC when the designation is "PC", else doer. Username: as given, else the mobile number, the
// part of the email before @, or the employee code. Departments match ignoring dots and spaces ("M.I.S" = "MIS").
const deptKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim();
const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s.(-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s);
// "3/12/2015", "03-12-2015" (day first, as in Indian sheets) or "2015-12-03" -> "2015-12-03"
function dayFrom(v) {
  const t = String(v || "").trim();
  if (!t) return "";
  if (isDay(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const d = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isDay(d) ? d : null;
}

router.post("/bulk", auth, permit("users", "add"), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
  const createMissing = Boolean(req.body?.createMissing);
  const dryRun = Boolean(req.body?.dryRun);
  const skip = new Set<number>((Array.isArray(req.body?.skip) ? req.body.skip : []).map(Number));
  if (!rows.length) return res.status(400).json({ message: "The file has no rows" });

  const deptCache = new Map<string, any>((await Department.find().lean<any>()).map((d) => [deptKey(d.name), d._id]));
  const branchCache = new Map<string, any>((await Branch.find().lean<any>()).map((b) => [deptKey(b.name), b._id]));
  const newNames = { department: new Set<string>(), branch: new Set<string>() };
  async function resolve(cache, Model, name, label) {
    const key = deptKey(name);
    if (!key) return undefined;
    if (cache.has(key)) return cache.get(key);
    if (!createMissing) throw new Error(`${label} "${String(name).trim()}" does not exist`);
    newNames[label.toLowerCase()].add(String(name).trim());
    if (dryRun) return null;
    const doc = await Model.create({ name: String(name).trim() });
    cache.set(key, doc._id);
    return doc._id;
  }

  const people = await User.find().select("name username phone employeeCode joiningDate department role").lean<any>();
  const byPhone = new Map<string, any>(people.filter((p) => p.phone).map((p) => [p.phone, p]));
  const byCode = new Map<string, any>(people.filter((p) => p.employeeCode).map((p) => [String(p.employeeCode).toLowerCase(), p]));
  const nameKey = (n) => sheetFmsLib.personKey(n);
  const byName = new Map<string, any[]>();
  for (const p of people) byName.set(nameKey(p.name), [...(byName.get(nameKey(p.name)) || []), p]);
  const firstKey = (n) => nameKey(String(n).split(/\s+/)[0]);
  const seen = { phone: new Set<string>(), code: new Set<string>(), username: new Set<string>() };

  const results = [];
  for (const [i, r] of rows.entries()) {
    const line = i + 2; // row 1 is the header
    if (skip.has(line)) {
      results.push({ line, ok: true, action: "skipped", name: cleanName(r.name) });
      continue;
    }
    try {
      const name = titleCase(cleanName(r.name));
      if (!name) throw new Error("Name is missing");
      const email = cleanEmail(r.email);
      const ph = cleanPhone(r.phone);
      if (ph.problem) throw new Error(`Mobile "${String(r.phone).trim()}": ${ph.problem.toLowerCase()}`);
      const phone = ph.phone;
      const code = String(r.employeeCode ?? "").trim().slice(0, 30);
      const joiningDate = dayFrom(r.joiningDate);
      if (joiningDate === null) throw new Error(`Joining date "${String(r.joiningDate).trim()}" is not a date (day/month/year)`);
      if (phone && seen.phone.has(phone)) throw new Error(`Mobile ${phone} is twice in the file`);
      if (code && seen.code.has(code.toLowerCase())) throw new Error(`Code ${code} is twice in the file`);

      // already in the software?
      const sameName = (byName.get(nameKey(name)) || []).filter((p) => !p.phone || !phone || p.phone === phone);
      const existing = (phone && byPhone.get(phone)) || (code && byCode.get(code.toLowerCase())) || (sameName.length === 1 ? sameName[0] : null);
      if (phone) seen.phone.add(phone);
      if (code) seen.code.add(code.toLowerCase());
      if (existing) {
        if (phone && existing.phone && existing.phone !== phone) throw new Error(`Matches ${existing.name}, whose mobile is ${existing.phone}: check the row`);
        const set: Record<string, any> = {};
        if (phone && !existing.phone) set.phone = phone;
        if (code && !existing.employeeCode) set.employeeCode = code;
        if (joiningDate && !existing.joiningDate) set.joiningDate = joiningDate;
        if (r.department && !existing.department) set.department = await resolve(deptCache, Department, r.department, "Department");
        if (!dryRun && Object.keys(set).length) await User.updateOne({ _id: existing._id }, { $set: set });
        results.push({ line, ok: true, action: Object.keys(set).length ? "updated" : "same", name, existing: existing.name, username: existing.username, filled: Object.keys(set), id: existing._id });
        continue;
      }

      const designation = String(r.designation || "").trim();
      const role = String(r.role || (/^p\.?\s*c\.?$/i.test(designation) ? "pc" : "doer")).toLowerCase().trim();
      const username = String(r.username || phone || email.split("@")[0] || code || "").toLowerCase().trim();
      if (!username) throw new Error("Give a mobile number, an email, a username or an employee code");
      const problem =
        roleProblem(req.user, role) ||
        (await emailProblem(email)) ||
        ((await User.exists({ username })) || seen.username.has(username) ? `Username "${username}" is already taken` : null);
      if (problem) throw new Error(problem);
      seen.username.add(username);
      // only one person of that first name, without a mobile: maybe the same person under a short name ("Vinod")
      const alike = people.filter((p) => firstKey(p.name) === firstKey(name));
      const warning = alike.length === 1 && !alike[0].phone ? `Maybe the same person as "${alike[0].name}" (already in the software, no mobile). If so, leave this row out and add the details to ${alike[0].name}.` : undefined;
      const department = await resolve(deptCache, Department, r.department, "Department");
      const branch = await resolve(branchCache, Branch, r.branch, "Branch");
      if (dryRun) {
        results.push({ line, ok: true, action: "create", name, username, role, department: String(r.department || "").trim(), warning });
        continue;
      }
      const password = tempPassword();
      const user = await User.create(<any>{
        name,
        username,
        email,
        phone,
        employeeCode: code,
        joiningDate,
        role,
        department,
        branch,
        password: await bcrypt.hash(password, 10),
      });
      results.push({ line, ok: true, action: "created", name, username, email, phone, role, tempPassword: password, id: user._id, warning });
    } catch (err) {
      results.push({ line, ok: false, name: cleanName(r.name), error: err.message });
    }
  }
  const count = (a) => results.filter((r) => r.action === a).length;
  const out = {
    dryRun,
    created: count("created") + count("create"),
    updated: count("updated"),
    same: count("same"),
    skipped: count("skipped"),
    failed: results.filter((r) => !r.ok).length,
    newDepartments: [...newNames.department],
    newBranches: [...newNames.branch],
    results,
  };
  if (!dryRun) audit(req, "user.bulk_upload", { entity: "User", summary: `${out.created} created, ${out.updated} updated, ${out.failed} failed` });
  res.json(out);
});

export = router;
