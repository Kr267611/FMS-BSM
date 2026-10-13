import express = require("express");
import mongoose = require("mongoose");
import LeaveType = require("../models/LeaveType");
import LeavePolicy = require("../models/LeavePolicy");
import LeaveRequest = require("../models/LeaveRequest");
import User = require("../models/User");
import Shift = require("../models/Shift");
import LatePolicy = require("../models/LatePolicy");
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;
import scopeLib = require("../services/scope");
const { visibleUserIds } = scopeLib;
import auditLib = require("../services/audit");
const { audit } = auditLib;
import datesLib = require("../services/dates");
const { todayKey, addDaysKey } = datesLib;
import book = require("../services/leaveBook");

// HRMS – Leave (MIDAP Leave Register + HRMS leave policies)
const router = express.Router();
router.use(auth);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const num = (v, min = 0, max = 366) => Math.min(max, Math.max(min, Number(v) || 0));
const text = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const config = permit("settings", "edit"); // leave types, policies and who gets which policy: admin by default

// ---------- leave types ----------
function cleanType(b: any = {}) {
  const name = text(b.name, 60);
  if (!name) throw fail("Enter the leave type name");
  return {
    name,
    code: text(b.code, 12).toUpperCase(),
    description: text(b.description, 300),
    paid: b.paid !== false,
    gender: ["all", "male", "female", "other"].includes(b.gender) ? b.gender : "all",
    carryForward: Boolean(b.carryForward),
    maxCarryForward: num(b.maxCarryForward),
    encashable: Boolean(b.encashable),
    requiresDocument: Boolean(b.requiresDocument),
    color: /^#[0-9a-f]{6}$/i.test(b.color || "") ? b.color : "#14877a",
    active: b.active !== false,
  };
}

router.get("/types", async (req, res) => {
  res.json(await LeaveType.find(req.query.all ? {} : { active: true }).sort({ name: 1 }).lean<any>());
});
router.post("/types", config, async (req, res) => {
  const v = cleanType(req.body);
  if (await LeaveType.exists({ name: v.name })) throw fail("A leave type with this name already exists");
  const t = await LeaveType.create(v);
  audit(req, "leave.type_create", { entity: "LeaveType", entityId: t._id, summary: t.name });
  res.status(201).json(t);
});
router.put("/types/:id", config, async (req, res) => {
  const v = cleanType(req.body);
  if (await LeaveType.exists({ name: v.name, _id: { $ne: req.params.id } })) throw fail("A leave type with this name already exists");
  const t = await LeaveType.findByIdAndUpdate(req.params.id, v, { returnDocument: "after" });
  if (!t) throw fail("Leave type not found", 404);
  audit(req, "leave.type_update", { entity: "LeaveType", entityId: t._id, summary: t.name });
  res.json(t);
});
router.delete("/types/:id", config, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  if (await LeaveRequest.exists({ type: req.params.id })) throw fail("Leave was already taken of this type. Switch it off (Active) instead.");
  if (await LeavePolicy.exists({ "rules.type": req.params.id })) throw fail("A leave policy uses this type. Remove it from the policy first.");
  const t = await LeaveType.findByIdAndDelete(req.params.id);
  if (!t) throw fail("Leave type not found", 404);
  audit(req, "leave.type_delete", { entity: "LeaveType", entityId: t._id, summary: t.name });
  res.json({ message: "Leave type deleted" });
});

// ---------- leave policies ----------
async function cleanPolicy(b: any = {}) {
  const name = text(b.name, 80);
  if (!name) throw fail("Enter the policy name");
  const types = new Set<any>((await LeaveType.find().select("_id").lean<any>()).map((t) => String(t._id)));
  const seen = new Set<any>();
  const rules = (Array.isArray(b.rules) ? b.rules : [])
    .filter((r) => r && types.has(String(r.type)) && !seen.has(String(r.type)) && seen.add(String(r.type)))
    .map((r) => {
      const out = { type: r.type, perYear: num(r.perYear), minAtOnce: num(r.minAtOnce), maxAtOnce: num(r.maxAtOnce), carryLimit: num(r.carryLimit), encashLimit: num(r.encashLimit) };
      if (out.maxAtOnce && out.minAtOnce > out.maxAtOnce) throw fail("A rule's minimum days at once is more than its maximum");
      return out;
    });
  if (!rules.length) throw fail("Add at least one leave type with its days per year");
  return {
    name,
    code: text(b.code, 12).toUpperCase(),
    description: text(b.description, 300),
    accrual: b.accrual === "monthly" ? "monthly" : "frontload",
    creditDay: Math.round(num(b.creditDay, 1, 28)) || 1,
    capacity: num(b.capacity, 0, 1000),
    exhaust: ["lwp", "reject", "negative"].includes(b.exhaust) ? b.exhaust : "lwp",
    maxNegative: num(b.maxNegative, 0, 60),
    rules,
    active: b.active !== false,
  };
}

router.get("/policies", async (req, res) => {
  const [policies, counts] = await Promise.all([
    LeavePolicy.find().populate("rules.type", "name code").sort({ name: 1 }).lean<any>(),
    User.aggregate([{ $match: { active: true, leavePolicy: { $ne: null } } }, { $group: { _id: "$leavePolicy", n: { $sum: 1 } } }]),
  ]);
  const n = new Map<any, any>(counts.map((c) => [String(c._id), c.n]));
  res.json(policies.map((p) => ({ ...p, assigned: n.get(String(p._id)) || 0 })));
});
router.post("/policies", config, async (req, res) => {
  const v = await cleanPolicy(req.body);
  if (await LeavePolicy.exists({ name: v.name })) throw fail("A policy with this name already exists");
  const p = await LeavePolicy.create(v as any);
  audit(req, "leave.policy_create", { entity: "LeavePolicy", entityId: p._id, summary: p.name });
  res.status(201).json(p);
});
router.put("/policies/:id", config, async (req, res) => {
  const v = await cleanPolicy(req.body);
  if (await LeavePolicy.exists({ name: v.name, _id: { $ne: req.params.id } })) throw fail("A policy with this name already exists");
  const p = await LeavePolicy.findByIdAndUpdate(req.params.id, v, { returnDocument: "after" });
  if (!p) throw fail("Policy not found", 404);
  audit(req, "leave.policy_update", { entity: "LeavePolicy", entityId: p._id, summary: p.name });
  res.json(p);
});
router.post("/policies/:id/clone", config, async (req, res) => {
  const src = await LeavePolicy.findById(req.params.id).lean<any>();
  if (!src) throw fail("Policy not found", 404);
  let name = text(req.body?.name, 80) || `${src.name} (copy)`;
  for (let i = 2; await LeavePolicy.exists({ name }); i++) name = `${src.name} (copy ${i})`;
  const { _id, createdAt, updatedAt, ...rest } = src;
  const p = await LeavePolicy.create({ ...rest, name });
  audit(req, "leave.policy_create", { entity: "LeavePolicy", entityId: p._id, summary: `${p.name} (copy of ${src.name})` });
  res.status(201).json(p);
});
router.delete("/policies/:id", config, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const n = await User.countDocuments({ leavePolicy: req.params.id });
  if (n) throw fail(`${n} person(s) have this policy. Give them another one first.`);
  const p = await LeavePolicy.findByIdAndDelete(req.params.id);
  if (!p) throw fail("Policy not found", 404);
  audit(req, "leave.policy_delete", { entity: "LeavePolicy", entityId: p._id, summary: p.name });
  res.json({ message: "Policy deleted" });
});

// ---------- who gets which policy ----------
router.get("/assignment", config, async (req, res) => {
  const users = await User.find({ active: true })
    .select("name role department leavePolicy gender shift latePolicy employeeCode")
    .populate("department", "name")
    .populate("leavePolicy", "name")
    .populate("shift", "name start end")
    .populate("latePolicy", "name")
    .sort({ name: 1 })
    .lean<any>();
  res.json(users.map((u) => ({ _id: u._id, name: u.name, role: u.role, department: u.department, leavePolicy: u.leavePolicy, gender: u.gender || "", shift: u.shift || null, latePolicy: u.latePolicy || null, employeeCode: u.employeeCode || "" })));
});
// { users: [ids], policy: id | null, gender? }
router.put("/assignment", config, async (req, res) => {
  const ids = (Array.isArray(req.body?.users) ? req.body.users : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 3000);
  if (!ids.length) throw fail("Choose the people");
  const set: Record<string, any> = {};
  if (req.body.policy !== undefined) {
    if (req.body.policy && !(await LeavePolicy.exists({ _id: req.body.policy }))) throw fail("Policy not found");
    set.leavePolicy = req.body.policy || null;
    set.leavePolicySince = req.body.policy ? todayKey() : null;
  }
  if (req.body.gender !== undefined) set.gender = ["male", "female", "other"].includes(req.body.gender) ? req.body.gender : "";
  // attendance: shift and late policy (null removes)
  for (const [key, Model] of [["shift", Shift], ["latePolicy", LatePolicy]] as const) {
    if (req.body[key] === undefined) continue;
    if (req.body[key] && !(mongoose.isValidObjectId(req.body[key]) && (await (Model as any).exists({ _id: req.body[key] })))) throw fail(key === "shift" ? "Shift not found" : "Late policy not found");
    set[key] = req.body[key] || null;
  }
  if (!Object.keys(set).length) throw fail("Choose the policy");
  const r = await User.updateMany({ _id: { $in: ids } }, { $set: set });
  const p = set.leavePolicy ? await LeavePolicy.findById(set.leavePolicy).select("name").lean<any>() : null;
  const parts = [];
  if (set.leavePolicy !== undefined) parts.push(`leave policy ${p ? p.name : "removed"}`);
  if (set.gender !== undefined) parts.push(`gender ${set.gender || "—"}`);
  if (set.shift !== undefined) parts.push(`shift ${set.shift ? (await Shift.findById(set.shift).select("name").lean<any>())?.name : "removed"}`);
  if (set.latePolicy !== undefined) parts.push(`late policy ${set.latePolicy ? (await LatePolicy.findById(set.latePolicy).select("name").lean<any>())?.name : "removed"}`);
  audit(req, "leave.policy_assign", { entity: "User", summary: `${r.modifiedCount} person(s): ${parts.join(", ")}` });
  res.json({ changed: r.modifiedCount });
});

// ---------- my leave ----------
router.get("/my", async (req, res) => {
  const user = String(req.query.user || req.user._id);
  if (user !== String(req.user._id) && !(book.MANAGERS.includes(req.user.role) && (await require("../services/scope").canSeeUser(req.user, user)))) throw fail("You can only see your own leave", 403);
  const year = Number(req.query.year) || Number(todayKey().slice(0, 4));
  const [balances, requests] = await Promise.all([
    book.balancesFor(user, { year, asOf: year === Number(todayKey().slice(0, 4)) ? todayKey() : `${year}-12-31` }),
    LeaveRequest.find({ user }).sort({ from: -1 }).limit(100).populate("type", "name code color").populate("decidedBy", "name").populate("appliedBy", "name").lean<any>(),
  ]);
  res.json({ year, policy: balances.policy ? { _id: balances.policy._id, name: balances.policy.name, accrual: balances.policy.accrual, exhaust: balances.policy.exhaust } : null, balances: balances.rows.map((r) => ({ ...r, available: r.limited ? r.available : null })), requests });
});

router.post("/preview", async (req, res) => {
  const p = await book.previewRequest(req.user, req.body);
  res.json({ ...p, type: { _id: p.type._id, name: p.type.name, requiresDocument: p.type.requiresDocument } });
});

router.post("/requests", async (req, res) => {
  const r = await book.createRequest(req.user, req.body);
  const who = await User.findById(r.user).select("name").lean<any>();
  audit(req, "leave.apply", { entity: "LeaveRequest", entityId: r._id, summary: `${who?.name}: ${r.from} to ${r.to}, ${r.days} day(s)${r.lwpDays ? ` (${r.lwpDays} unpaid)` : ""}` });
  res.status(201).json(r);
});

// ---------- the managers' list ----------
// ?view=approve (waiting for me) | all &status= &user= &department= &type= &from= &to=
router.get("/requests", async (req, res) => {
  const visible = await visibleUserIds(req.user);
  const filter: Record<string, any> = {};
  if (visible !== null) filter.user = { $in: visible };
  if (!book.MANAGERS.includes(req.user.role)) filter.user = req.user._id; // a doer sees their own
  if (mongoose.isValidObjectId(req.query.user)) {
    if (visible !== null && !visible.map(String).includes(String(req.query.user))) throw fail("You can only see people in your department", 403);
    filter.user = req.query.user;
  }
  if (mongoose.isValidObjectId(req.query.department)) {
    const ids = (await User.find({ department: req.query.department as string }).distinct("_id")).map(String);
    const allowed = filter.user?.$in ? filter.user.$in.map(String) : filter.user ? [String(filter.user)] : null;
    filter.user = { $in: allowed ? ids.filter((id) => allowed.includes(id)) : ids };
  }
  if (["pending", "approved", "rejected", "cancelled"].includes((req.query.status as string))) filter.status = req.query.status;
  if (req.query.view === "approve") filter.status = "pending";
  if (mongoose.isValidObjectId(req.query.type)) filter.type = req.query.type;
  if (isDay(req.query.from)) filter.to = { $gte: req.query.from };
  if (isDay(req.query.to)) filter.from = { $lte: req.query.to };
  let list = await LeaveRequest.find(filter)
    .sort({ status: 1, from: -1 })
    .limit(1000)
    .populate({ path: "user", select: "name department", populate: { path: "department", select: "name" } })
    .populate("type", "name code color")
    .populate("decidedBy", "name")
    .populate("appliedBy", "name")
    .populate("buddies.checklist buddies.fms buddies.delegation", "name")
    .lean<any>();
  // waiting for me: only the ones I may decide (not my own)
  if (req.query.view === "approve") list = list.filter((r) => String(r.user._id) !== String(req.user._id) || req.user.role === "admin");
  for (const r of list) r.canDecide = r.status === "pending" && (await book.canDecide(req.user, r));
  res.json(list);
});

router.post("/requests/:id/approve", async (req, res) => {
  const r: any = await book.approve(req.params.id, req.user, { note: req.body?.note });
  audit(req, "leave.approve", { entity: "LeaveRequest", entityId: r._id, summary: `${r.user.name}: ${r.from} to ${r.to} approved – ${r.applied?.handedOver || 0} task(s) to buddies, ${r.applied?.notRequired || 0} not required, ${r.applied?.moved || 0} moved` });
  res.json(r);
});
router.post("/requests/:id/reject", async (req, res) => {
  const r: any = await book.reject(req.params.id, req.user, { note: req.body?.note });
  audit(req, "leave.reject", { entity: "LeaveRequest", entityId: r._id, summary: `${r.user.name}: ${r.from} to ${r.to} rejected – ${r.note}` });
  res.json(r);
});
router.post("/requests/:id/cancel", async (req, res) => {
  const r: any = await book.cancel(req.params.id, req.user);
  audit(req, "leave.cancel", { entity: "LeaveRequest", entityId: r._id, summary: `${r.user.name}: ${r.from} to ${r.to} cancelled` });
  res.json(r);
});

// ---------- HR summary (leave): today, waiting, this week, people without a policy ----------
router.get("/summary", async (req, res) => {
  const visible = await visibleUserIds(req.user);
  const scope = visible === null ? {} : { user: { $in: visible } };
  const today = todayKey();
  const weekEnd = addDaysKey(today, 6);
  const people = visible === null ? { active: true } : { active: true, _id: { $in: visible } };
  const [onLeave, waiting, upcoming, noPolicy, total] = await Promise.all([
    LeaveRequest.find({ ...scope, status: "approved", from: { $lte: today }, to: { $gte: today } }).populate("user", "name").populate("type", "name").lean<any>(),
    LeaveRequest.countDocuments({ ...scope, status: "pending" }),
    LeaveRequest.find({ ...scope, status: { $in: ["approved", "pending"] }, from: { $gt: today, $lte: weekEnd } }).sort({ from: 1 }).limit(20).populate("user", "name").populate("type", "name").lean<any>(),
    User.countDocuments({ ...people, leavePolicy: null }),
    User.countDocuments(people),
  ]);
  res.json({ today, onLeave, waiting, upcoming, noPolicy, people: total });
});

export = router;
