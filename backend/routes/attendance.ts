import express = require("express");
import mongoose = require("mongoose");
import Shift = require("../models/Shift");
import LatePolicy = require("../models/LatePolicy");
import User = require("../models/User");
import orgLib = require("../models/Org");
const { Branch } = orgLib;
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;
import scopeLib = require("../services/scope");
const { visibleUserIds } = scopeLib;
import auditLib = require("../services/audit");
const { audit } = auditLib;
import datesLib = require("../services/dates");
const { todayKey } = datesLib;
import att = require("../services/attendance");

// HRMS – Attendance: punch in / out, the register, biometric upload, shifts, late policies, geo-fence
const router = express.Router();
router.use(auth);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));
const num = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
const text = (v, n = 80) => String(v ?? "").trim().slice(0, n);
const config = permit("settings", "edit"); // shifts, late policies, geo-fence, settings, biometric upload: admin by default

// ---------- me ----------
router.get("/me", async (req, res) => {
  const month = isMonth(req.query.month) ? (req.query.month as string) : todayKey().slice(0, 7);
  res.json(await att.myMonth(req.user._id, month));
});

router.post("/punch", async (req, res) => {
  const r = await att.punch(req.user, req.body);
  audit(req, "attendance.punch", { entity: "Attendance", summary: `${req.user.name}: punch ${r.kind} ${r.day}${r.outside ? ` (outside, ${r.distance} m)` : ""}` });
  res.status(201).json(r);
});

// ---------- managers ----------
router.get("/register", async (req, res) => {
  if (!att.MANAGERS.includes(req.user.role)) throw fail("Only managers can see the register", 403);
  const month = isMonth(req.query.month) ? (req.query.month as string) : todayKey().slice(0, 7);
  const from = `${month}-01`;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  const to = new Date(+next - 86400000).toISOString().slice(0, 10);
  const visible = await visibleUserIds(req.user);
  let userIds = visible;
  if (mongoose.isValidObjectId(req.query.user)) {
    if (visible !== null && !visible.includes(String(req.query.user))) throw fail("You can only see people in your department", 403);
    userIds = [String(req.query.user)];
  }
  const out = await att.register({
    userIds,
    from,
    to,
    department: mongoose.isValidObjectId(req.query.department) ? req.query.department : "",
    branch: mongoose.isValidObjectId(req.query.branch) ? req.query.branch : "",
  });
  res.json({ month, ...out });
});

router.get("/day", async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.user) || !/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || ""))) throw fail("Choose the person and the day");
  res.json(await att.dayDetail(req.user, req.query.user, req.query.day));
});

router.put("/manual", async (req, res) => {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.user)) throw fail("Choose the person");
  const r = await att.setManual(req.user, b);
  const who = await User.findById(b.user).select("name").lean<any>();
  audit(req, "attendance.manual", { entity: "Attendance", summary: `${who?.name}: ${r.day} ${r.status ? `set to ${r.status} – ${text(b.note, 120)}` : "mark removed"}` });
  res.json(r);
});

// ---------- biometric machine ----------
router.post("/biometric/preview", config, async (req, res) => {
  const { ok, problems } = await att.previewBiometric(req.body?.rows);
  res.json({ count: ok.length, people: new Set<any>(ok.map((r) => r.user)).size, sample: ok.slice(0, 20), problems: problems.slice(0, 200), problemCount: problems.length });
});
router.post("/biometric/import", config, async (req, res) => {
  const r = await att.importBiometric(req.user, req.body?.rows);
  audit(req, "attendance.biometric", { entity: "Attendance", summary: `${r.added} punch(es) added on ${r.days} day(s), ${r.skipped} already there, ${r.problems.length} line(s) not understood` });
  res.json({ ...r, problems: r.problems.slice(0, 200), problemCount: r.problems.length });
});

// ---------- shifts ----------
function cleanShift(b: any = {}) {
  const name = text(b.name, 60);
  if (!name) throw fail("Enter the shift name");
  if (!isTime(b.start) || !isTime(b.end)) throw fail("Enter the start and end time like 09:30");
  if (b.start === b.end) throw fail("Start and end cannot be the same time");
  const full = num(b.fullDayMinutes, 30, 1440);
  const half = num(b.halfDayMinutes, 0, 1440);
  if (half > full) throw fail("Half-day hours cannot be more than full-day hours");
  return {
    name,
    code: text(b.code, 12).toUpperCase(),
    start: b.start,
    end: b.end,
    graceMinutes: num(b.graceMinutes, 0, 240),
    earlyGraceMinutes: num(b.earlyGraceMinutes, 0, 240),
    fullDayMinutes: full,
    halfDayMinutes: half,
    color: /^#[0-9a-f]{6}$/i.test(b.color || "") ? b.color : "#14877a",
    active: b.active !== false,
  };
}
router.get("/shifts", async (req, res) => {
  const [shifts, counts] = await Promise.all([
    Shift.find().sort({ name: 1 }).lean<any>(),
    User.aggregate([{ $match: { active: true, shift: { $ne: null } } }, { $group: { _id: "$shift", n: { $sum: 1 } } }]),
  ]);
  const n = new Map<any, any>(counts.map((c) => [String(c._id), c.n]));
  res.json(shifts.map((s) => ({ ...s, assigned: n.get(String(s._id)) || 0 })));
});
router.post("/shifts", config, async (req, res) => {
  const v = cleanShift(req.body);
  if (await Shift.exists({ name: v.name })) throw fail("A shift with this name already exists");
  const s = await Shift.create(v);
  audit(req, "attendance.shift_create", { entity: "Shift", entityId: s._id, summary: `${s.name} ${s.start}–${s.end}` });
  res.status(201).json(s);
});
router.put("/shifts/:id", config, async (req, res) => {
  const v = cleanShift(req.body);
  if (await Shift.exists({ name: v.name, _id: { $ne: req.params.id } })) throw fail("A shift with this name already exists");
  const s = await Shift.findByIdAndUpdate(req.params.id, v, { returnDocument: "after" });
  if (!s) throw fail("Shift not found", 404);
  audit(req, "attendance.shift_update", { entity: "Shift", entityId: s._id, summary: `${s.name} ${s.start}–${s.end}` });
  res.json(s);
});
router.delete("/shifts/:id", config, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const n = await User.countDocuments({ shift: req.params.id });
  if (n) throw fail(`${n} person(s) have this shift. Give them another one first.`);
  const s = await Shift.findByIdAndDelete(req.params.id);
  if (!s) throw fail("Shift not found", 404);
  audit(req, "attendance.shift_delete", { entity: "Shift", entityId: s._id, summary: s.name });
  res.json({ message: "Shift deleted" });
});

// ---------- late policies ----------
function cleanLatePolicy(b: any = {}) {
  const name = text(b.name, 60);
  if (!name) throw fail("Enter the policy name");
  return {
    name,
    code: text(b.code, 12).toUpperCase(),
    freeLates: num(b.freeLates, 0, 31),
    every: num(b.every, 1, 31),
    penalty: b.penalty === "full" ? "full" : "half",
    countEarly: Boolean(b.countEarly),
    active: b.active !== false,
  };
}
router.get("/late-policies", async (req, res) => {
  const [list, counts] = await Promise.all([
    LatePolicy.find().sort({ name: 1 }).lean<any>(),
    User.aggregate([{ $match: { active: true, latePolicy: { $ne: null } } }, { $group: { _id: "$latePolicy", n: { $sum: 1 } } }]),
  ]);
  const n = new Map<any, any>(counts.map((c) => [String(c._id), c.n]));
  res.json(list.map((p) => ({ ...p, assigned: n.get(String(p._id)) || 0 })));
});
router.post("/late-policies", config, async (req, res) => {
  const v = cleanLatePolicy(req.body);
  if (await LatePolicy.exists({ name: v.name })) throw fail("A late policy with this name already exists");
  const p = await LatePolicy.create(v as any);
  audit(req, "attendance.late_policy_create", { entity: "LatePolicy", entityId: p._id, summary: p.name });
  res.status(201).json(p);
});
router.put("/late-policies/:id", config, async (req, res) => {
  const v = cleanLatePolicy(req.body);
  if (await LatePolicy.exists({ name: v.name, _id: { $ne: req.params.id } })) throw fail("A late policy with this name already exists");
  const p = await LatePolicy.findByIdAndUpdate(req.params.id, v, { returnDocument: "after" });
  if (!p) throw fail("Late policy not found", 404);
  audit(req, "attendance.late_policy_update", { entity: "LatePolicy", entityId: p._id, summary: p.name });
  res.json(p);
});
router.delete("/late-policies/:id", config, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const n = await User.countDocuments({ latePolicy: req.params.id });
  if (n) throw fail(`${n} person(s) have this late policy. Give them another one first.`);
  const p = await LatePolicy.findByIdAndDelete(req.params.id);
  if (!p) throw fail("Late policy not found", 404);
  audit(req, "attendance.late_policy_delete", { entity: "LatePolicy", entityId: p._id, summary: p.name });
  res.json({ message: "Late policy deleted" });
});

// ---------- settings + geo-fence ----------
router.get("/settings", config, async (req, res) => {
  const [settings, branches] = await Promise.all([att.getSettings(), Branch.find().select("name location active").sort({ name: 1 }).lean<any>()]);
  res.json({ settings, branches });
});
router.put("/settings", config, async (req, res) => {
  const s = await att.saveSettings(req.body);
  audit(req, "attendance.settings", { entity: "Setting", summary: `GPS ${s.gpsRequired ? "needed" : "optional"}, selfie ${s.selfieRequired ? "needed" : "optional"}, outside the fence: ${s.outside}` });
  res.json(s);
});
// { lat, lng, radius } or { clear: true }
router.put("/branches/:id/fence", config, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const b = req.body || {};
  let update;
  if (b.clear) update = { $unset: { location: "" } };
  else {
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail("Enter the latitude and longitude");
    update = { $set: { location: { lat, lng, radius: num(b.radius || 200, 20, 5000) } } };
  }
  const br = await Branch.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" }).lean<any>();
  if (!br) throw fail("Branch not found", 404);
  audit(req, "attendance.fence", { entity: "Branch", entityId: br._id, summary: b.clear ? `${br.name}: geo-fence removed` : `${br.name}: geo-fence ${br.location.radius} m` });
  res.json(br);
});

// employee code (biometric machine id) of one person
router.put("/code/:userId", config, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw fail("Invalid ID");
  const code = text(req.body?.code, 30);
  if (code) {
    const clash = await User.findOne({ employeeCode: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), _id: { $ne: req.params.userId } }).select("name").lean<any>();
    if (clash) throw fail(`${clash.name} already has the code "${code}"`);
  }
  const u = await User.findByIdAndUpdate(req.params.userId, { $set: { employeeCode: code } }, { returnDocument: "after" }).select("name employeeCode").lean<any>();
  if (!u) throw fail("User not found", 404);
  res.json(u);
});

export = router;
