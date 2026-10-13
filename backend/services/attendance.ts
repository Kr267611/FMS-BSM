// HRMS attendance: punches from the phone (GPS + selfie), the biometric machine or a manager, turned into
// a day's result (P present, H half day, A absent, L leave, WO week-off, HO holiday, MP missed punch)
// with late / early marks against the person's shift, and a month's summary with the late-policy cut.
// The pure parts (shift times, which day a punch belongs to, a day's result, the month's summary, distance)
// are covered by tests.
import Attendance = require("../models/Attendance");
import Shift = require("../models/Shift");
import LatePolicy = require("../models/LatePolicy");
import LeaveRequest = require("../models/LeaveRequest");
import Setting = require("../models/Setting");
import User = require("../models/User");
import orgLib = require("../models/Org");
const { Branch } = orgLib;
import datesLib = require("./dates");
const { addDaysKey, dayKey } = datesLib;
import calendarLib = require("./calendar");
const { toIst, fromIst, isOff } = calendarLib;
import workflowLib = require("./workflow");
const { loadCalendar } = workflowLib;
import doerCalendarLib = require("./doerCalendar");
const { personalCalendar, daysOf } = doerCalendarLib;
import scopeLib = require("./scope");
const { canSeeUser } = scopeLib;
import permissionsLib = require("./permissions");
const { can } = permissionsLib;
import uploadsLib = require("./uploads");
const { saveImage } = uploadsLib;

const MIN = 60 * 1000;
const NIGHT_SPILL = 4 * 60; // a night shift's punches up to 4 h after its end still belong to its start day
const STATUSES = ["P", "H", "A", "L", "WO", "HO", "MP", "IN", ""];
const SETTINGS_DEFAULTS = { gpsRequired: true, selfieRequired: true, outside: "block", since: "" }; // outside: block | flag; since: "YYYY-MM-DD" attendance counts from

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

// ---------- pure ----------

// A shift (or, when a person has none, the company's working hours) -> the numbers the rest uses
function shiftInfo(shift, company?) {
  const start = shift && isTime(shift.start) ? toMin(shift.start) : (company?.startMin ?? 9 * 60);
  const end = shift && isTime(shift.end) ? toMin(shift.end) : (company?.endMin ?? 18 * 60);
  const overnight = end <= start;
  const length = overnight ? end + 1440 - start : end - start;
  return {
    id: shift?._id ? String(shift._id) : null,
    name: shift?.name || "Company hours",
    startMin: start,
    endMin: end,
    overnight,
    length,
    grace: shift?.graceMinutes ?? 10,
    earlyGrace: shift?.earlyGraceMinutes ?? 10,
    full: shift?.fullDayMinutes ?? Math.min(480, length),
    half: shift?.halfDayMinutes ?? Math.min(240, Math.round(length / 2)),
  };
}

// The day a punch belongs to: a night shift's punch early next morning counts for the night it started
function dayOfPunch(at, sh) {
  const { day, min } = toIst(at);
  if (sh.overnight && min < sh.endMin + NIGHT_SPILL) return addDaysKey(day, -1);
  return day;
}

// When the shift of `day` starts and ends
function shiftWindow(day, sh) {
  return { startAt: fromIst(day, sh.startMin), endAt: fromIst(sh.overnight ? addDaysKey(day, 1) : day, sh.endMin) };
}

// One day's result.
//   punches: [{ at }] · manual: { status } | null · off: "WO" | "HO" | null · leave: "full" | "half" | null
//   now: the time it is now (a day that is not over yet is not marked absent / missed punch)
function evaluateDay({ day, sh, punches = [], manual = null, off = null, leave = null, now = new Date() }) {
  const times = punches.map((p) => +new Date(p.at)).filter((t) => !isNaN(t)).sort((a, b) => a - b);
  const { startAt, endAt } = shiftWindow(day, sh);
  const over = +now >= +endAt + NIGHT_SPILL * MIN;
  const firstIn = times.length ? times[0] : null;
  const lastOut = times.length > 1 ? times[times.length - 1] : null;
  const workMinutes = lastOut ? Math.round((lastOut - firstIn) / MIN) : 0;
  const halfLeave = leave === "half";
  let lateMinutes = firstIn && firstIn > +startAt + sh.grace * MIN ? Math.round((firstIn - +startAt) / MIN) : 0;
  let earlyMinutes = lastOut && lastOut < +endAt - sh.earlyGrace * MIN ? Math.round((+endAt - lastOut) / MIN) : 0;
  if (off || halfLeave) lateMinutes = earlyMinutes = 0; // no late mark on a day off or a half-day leave

  let status;
  if (manual?.status) status = manual.status;
  else if (leave === "full" && !off) status = "L";
  else if (!times.length) status = off || (over ? "A" : "");
  else if (times.length === 1) status = over ? "MP" : "IN";
  else {
    const need = halfLeave ? sh.half : sh.full;
    status = workMinutes >= need ? "P" : !halfLeave && workMinutes >= sh.half ? "H" : over ? "A" : "IN";
  }
  if (["L", "WO", "HO", "A", ""].includes(status) && !times.length) lateMinutes = earlyMinutes = 0;
  return {
    status,
    manual: Boolean(manual?.status),
    firstIn: firstIn ? new Date(firstIn) : null,
    lastOut: lastOut ? new Date(lastOut) : null,
    punches: times.length,
    workMinutes,
    lateMinutes,
    earlyMinutes,
    late: lateMinutes > 0,
    early: earlyMinutes > 0,
    offDayWork: Boolean(off && times.length),
    halfLeave,
  };
}

// Days of a person's month -> counts, paid-present days and the late-policy cut
function monthSummary(cells, policy?) {
  const s = { P: 0, H: 0, A: 0, L: 0, WO: 0, HO: 0, MP: 0, late: 0, early: 0, workMinutes: 0, presentDays: 0, cutDays: 0, marks: 0 };
  for (const c of cells) {
    if (s[c.status] !== undefined) s[c.status]++;
    if (c.late) s.late++;
    if (c.early) s.early++;
    s.workMinutes += c.workMinutes || 0;
    if (c.status === "P") s.presentDays += c.halfLeave ? 0.5 : 1;
    else if (c.status === "H") s.presentDays += 0.5;
  }
  if (policy) {
    s.marks = s.late + (policy.countEarly ? s.early : 0);
    const extra = Math.max(0, s.marks - (policy.freeLates || 0));
    const groups = Math.floor(extra / Math.max(1, policy.every || 1));
    s.cutDays = groups * (policy.penalty === "full" ? 1 : 0.5);
  }
  return s;
}

// Metres between two points (haversine)
function distanceM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

// "13/10/2026" "2026-10-13" "13-10-2026" + "09:31" "9:31 AM" "09:31:20" (IST) -> Date | null
function parseIstDateTime(dateText, timeText) {
  let date = String(dateText || "").trim();
  let time = String(timeText || "").trim();
  if (!time) {
    const m = /^(\S+)[ T]+(.+)$/.exec(date);
    if (m) [date, time] = [m[1], m[2]];
  }
  let y, mo, d;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  if (m) [y, mo, d] = [m[1], m[2], m[3]];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(date))) [d, mo, y] = [m[1], m[2], m[3]];
  else return null;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(time);
  if (!t) return null;
  let h = Number(t[1]);
  const min = Number(t[2]);
  if (t[4]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (/pm/i.test(t[4]) ? 12 : 0);
  }
  if (h > 23 || min > 59 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const at = fromIst(key, h * 60 + min + Number(t[3] || 0) / 60);
  return isNaN(+at) || dayKey(at) !== key ? null : at;
}

// ---------- settings ----------

async function getSettings() {
  const s = await Setting.findOne({ key: "attendance" }).lean<any>();
  return { ...SETTINGS_DEFAULTS, ...(s?.value || {}) };
}
async function saveSettings(b: any = {}) {
  const value = {
    gpsRequired: b.gpsRequired !== false,
    selfieRequired: b.selfieRequired !== false,
    outside: b.outside === "flag" ? "flag" : "block",
    since: /^\d{4}-\d{2}-\d{2}$/.test(String(b.since || "")) ? b.since : "",
  };
  await Setting.updateOne({ key: "attendance" }, { $set: { value } }, { upsert: true });
  return value;
}

// ---------- loading what a set of days needs ----------

// users: lean users with shift / latePolicy / weekOff. -> (userId, day) => that day's result
async function loadContext(users, from, to, now = new Date()) {
  const ids = users.map((u) => u._id);
  const [company, shifts, policies, records, leaves, settings] = await Promise.all([
    loadCalendar(),
    Shift.find().lean<any>(),
    LatePolicy.find().lean<any>(),
    Attendance.find({ user: { $in: ids }, day: { $gte: from, $lte: to } }).lean<any>(),
    LeaveRequest.find({ user: { $in: ids }, status: "approved", from: { $lte: to }, to: { $gte: from } }).select("user from to halfDay").lean<any>(),
    getSettings(),
  ]);
  const shiftById = new Map<any, any>(shifts.map((s) => [String(s._id), s]));
  const policyById = new Map<any, any>(policies.map((p) => [String(p._id), p]));
  const recordOf = new Map<any, any>(records.map((r) => [`${r.user}|${r.day}`, r]));
  const leaveOf = new Map();
  for (const l of leaves) for (const d of daysOf(l.from, l.to)) leaveOf.set(`${l.user}|${d}`, l.halfDay ? "half" : "full");
  const byUser = new Map<any, any>(users.map((u) => [String(u._id), u]));
  const calOf = new Map();
  const info = (u, rec?) => shiftInfo(shiftById.get(String(rec?.shift || u.shift || "")), company);
  // nothing counts before the person joined (joining date, or when they were added) or before attendance started (settings "since")
  const startOf = (u) => [u?.joiningDate || (u?.createdAt ? dayKey(u.createdAt) : ""), settings.since || ""].sort().pop();
  const cell = (userId, day) => {
    const u = byUser.get(String(userId));
    const k = `${userId}|${day}`;
    const rec = recordOf.get(k);
    if (day < startOf(u) && !rec?.punches?.length && !rec?.manual?.status) return { day, ...evaluateDay({ day, sh: info(u), now: new Date(0) }), shift: info(u).name, note: "", before: true };
    if (!calOf.has(String(userId))) calOf.set(String(userId), personalCalendar(company, u?.weekOff, []));
    const cal = calOf.get(String(userId));
    const off = cal.holidays.has(day) ? "HO" : isOff(day, cal) ? "WO" : null;
    const sh = info(u, rec);
    return { day, ...evaluateDay({ day, sh, punches: rec?.punches || [], manual: rec?.manual, off, leave: leaveOf.get(k) || null, now }), shift: sh.name, note: rec?.manual?.note || "" };
  };
  return { cell, info, policyOf: (u) => policyById.get(String(u.latePolicy || "")) || null, recordOf: (u, d) => recordOf.get(`${u}|${d}`) || null, company };
}

const USER_FIELDS = "name username role department branch shift latePolicy weekOff employeeCode active createdAt joiningDate";

// The register: people × days, with each person's month summary
async function register({ userIds = null, from, to, department = "", branch = "", now = new Date() }: any) {
  const q: Record<string, any> = { active: true };
  if (userIds) q._id = { $in: userIds };
  if (department) q.department = department;
  if (branch) q.branch = branch;
  const users = await User.find(q).select(USER_FIELDS).populate("department", "name").sort({ name: 1 }).limit(3000).lean<any>();
  const days = daysOf(from, to);
  const ctx = await loadContext(users, from, to, now);
  const people = users.map((u) => {
    const cells = days.map((d) => ctx.cell(u._id, d));
    return {
      user: { _id: u._id, name: u.name, department: u.department?.name || "", employeeCode: u.employeeCode || "" },
      shift: ctx.info(u).name,
      cells,
      summary: monthSummary(cells.filter((c) => c.day <= dayKey(now)), ctx.policyOf(u)),
    };
  });
  return { from, to, days, people };
}

// One person's month (My Attendance)
async function myMonth(userId, month, now = new Date()) {
  const user = await User.findById(userId).select(USER_FIELDS).populate("shift").populate("latePolicy").populate("branch", "name location").lean<any>();
  if (!user) throw fail("User not found", 404);
  const from = `${month}-01`;
  const to = addDaysKey(addDaysKey(from, 32).slice(0, 8) + "01", -1);
  const ctx = await loadContext([{ ...user, shift: user.shift?._id, latePolicy: user.latePolicy?._id }], from, to, now);
  const cells = daysOf(from, to).map((d) => ctx.cell(user._id, d));
  const sh = ctx.info({ shift: user.shift?._id });
  const today = dayOfPunch(now, sh);
  const todayRec = ctx.recordOf(user._id, today) || (await Attendance.findOne({ user: user._id, day: today }).lean<any>());
  const settings = await getSettings();
  return {
    month,
    shift: { name: sh.name, start: user.shift?.start || null, end: user.shift?.end || null, overnight: sh.overnight },
    latePolicy: user.latePolicy ? { name: user.latePolicy.name, freeLates: user.latePolicy.freeLates, every: user.latePolicy.every, penalty: user.latePolicy.penalty } : null,
    branch: user.branch ? { name: user.branch.name, fenced: Boolean(user.branch.location?.lat != null && user.branch.location?.lng != null), radius: user.branch.location?.radius || null } : null,
    settings,
    today: { day: today, punches: (todayRec?.punches || []).map((p) => ({ at: p.at, source: p.source, outside: p.outside, distance: p.distance })), next: (todayRec?.punches || []).length % 2 ? "out" : "in" },
    cells,
    summary: monthSummary(cells.filter((c) => c.day <= dayKey(now)), ctx.policyOf({ latePolicy: user.latePolicy?._id })),
  };
}

// ---------- punching ----------

async function punch(me, body: any = {}, now = new Date()) {
  const user = await User.findById(me._id).select("shift branch active").lean<any>();
  if (!user?.active) throw fail("This account is inactive", 403);
  const [settings, shift, branch, company] = await Promise.all([
    getSettings(),
    user.shift ? Shift.findById(user.shift).lean<any>() : null,
    user.branch ? Branch.findById(user.branch).lean<any>() : null,
    loadCalendar(),
  ]);
  const sh = shiftInfo(shift, company);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const hasGps = body.lat !== undefined && body.lat !== null && body.lat !== "" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (settings.gpsRequired && !hasGps) throw fail("Turn on location (GPS) and allow it for this site, then punch again");
  let distance = null;
  let outside = false;
  const fence = branch?.location;
  if (hasGps && fence?.lat != null && fence?.lng != null) {
    distance = distanceM({ lat, lng }, fence);
    outside = distance > (fence.radius || 200);
    if (outside && settings.outside === "block") throw fail(`You are ${distance} m from ${branch.name}. Punch from the office (within ${fence.radius || 200} m).`);
  }
  if (settings.selfieRequired && !body.photo) throw fail("Take a selfie to punch");
  const day = dayOfPunch(now, sh);
  const rec = await Attendance.findOne({ user: me._id, day }).lean<any>();
  const last = rec?.punches?.length ? rec.punches[rec.punches.length - 1] : null;
  if (last && +now - +new Date(last.at) < MIN) throw fail("You punched a moment ago");
  let photo;
  if (body.photo) photo = ((await saveImage({ dataUrl: body.photo, filename: `punch-${day}.jpg`, userId: me._id })) as any).id;
  const entry = {
    at: now,
    source: "app",
    ...(hasGps ? { lat, lng, accuracy: Number(body.accuracy) || undefined } : {}),
    ...(distance !== null ? { distance } : {}),
    outside,
    ...(photo ? { photo } : {}),
  };
  await Attendance.updateOne({ user: me._id, day }, { $push: { punches: entry }, $setOnInsert: { shift: user.shift || undefined } }, { upsert: true });
  const kind = (rec?.punches?.length || 0) % 2 ? "out" : "in";
  return { day, kind, at: now, outside, distance };
}

// ---------- managers ----------

// HRMS – Attendance (edit): mark days by hand, approve correction requests – for the people they reach, never themselves (except an admin)
async function canManage(me, userId) {
  if (!can(me, "attendance", "edit")) return false;
  if (String(me._id) === String(userId) && me.role !== "admin") return false;
  return canSeeUser(me, userId);
}

// Set a day by hand (P / H / A) or clear the mark (status ""), with the reason
async function setManual(me, { user, day, status, note }: any) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) throw fail("Choose the day");
  if (!(await User.exists({ _id: user }))) throw fail("User not found", 404);
  if (!(await canManage(me, user))) throw fail("Only their manager or an admin can change this attendance", 403);
  const clear = !status;
  if (!clear && !["P", "H", "A"].includes(status)) throw fail("Choose Present, Half day or Absent");
  const why = String(note || "").trim().slice(0, 300);
  if (!clear && why.length < 3) throw fail("Write the reason");
  const update = clear ? { $unset: { manual: "" } } : { $set: { manual: { status, note: why, by: me._id, at: new Date() } } };
  await Attendance.updateOne({ user, day }, update, { upsert: !clear });
  return { user, day, status: clear ? null : status };
}

// The punches of one day (who / where / selfie), for the register's detail box
async function dayDetail(me, userId, day) {
  if (String(me._id) !== String(userId) && !(can(me, "attendance", "view") && (await canSeeUser(me, userId)))) throw fail("You can only see your own attendance", 403);
  const rec = await Attendance.findOne({ user: userId, day }).populate("punches.by", "name").populate("manual.by", "name").lean<any>();
  return { day, punches: rec?.punches || [], manual: rec?.manual?.status ? rec.manual : null };
}

// ---------- biometric machine ----------

// rows: [{ code | username | email, date, time }] or [{ code, datetime }] -> what would be added
async function previewBiometric(rows) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, 20000);
  if (!list.length) throw fail("The file has no rows");
  const users = await User.find({ active: true }).select("name username email employeeCode shift").lean<any>();
  const byKey = new Map();
  for (const u of users) {
    if (u.employeeCode) byKey.set(`c:${u.employeeCode.toLowerCase()}`, u);
    byKey.set(`u:${u.username}`, u);
    if (u.email) byKey.set(`e:${u.email}`, u);
  }
  const [shifts, company] = await Promise.all([Shift.find().lean<any>(), loadCalendar()]);
  const shiftById = new Map<any, any>(shifts.map((s) => [String(s._id), s]));
  const ok = [];
  const problems = [];
  list.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const code = String(r.code || r.employeecode || r["employee code"] || r.id || "").trim().toLowerCase();
    const uname = String(r.username || "").trim().toLowerCase();
    const email = String(r.email || "").trim().toLowerCase();
    const u = (code && byKey.get(`c:${code}`)) || (uname && byKey.get(`u:${uname}`)) || (email && byKey.get(`e:${email}`));
    if (!u) return problems.push({ line, error: `No active user with code / username "${code || uname || email}"` });
    const at = parseIstDateTime(r.date || r.datetime || r["date time"], r.time);
    if (!at) return problems.push({ line, name: u.name, error: `Date / time not understood: "${[r.date || r.datetime, r.time].filter(Boolean).join(" ")}"` });
    const sh = shiftInfo(shiftById.get(String(u.shift || "")), company);
    ok.push({ line, user: String(u._id), name: u.name, at, day: dayOfPunch(at, sh), shift: u.shift || null });
  });
  return { ok, problems };
}

async function importBiometric(me, rows) {
  const { ok, problems } = await previewBiometric(rows);
  const groups = new Map();
  for (const p of ok) {
    const k = `${p.user}|${p.day}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const keys = [...groups.keys()];
  const existing = await Attendance.find({ $or: keys.map((k) => ({ user: k.split("|")[0], day: k.split("|")[1] })) }).select("user day punches.at").lean<any>();
  const have = new Map<any, any>(existing.map((r) => [`${r.user}|${r.day}`, r.punches.map((p) => +new Date(p.at))]));
  let added = 0;
  let skipped = 0;
  const ops = [];
  for (const [k, list] of groups) {
    const times = have.get(k) || [];
    const fresh = [];
    for (const p of list.sort((a, b) => +a.at - +b.at)) {
      if ([...times, ...fresh.map((f) => +f.at)].some((t) => Math.abs(t - +p.at) < MIN)) {
        skipped++;
        continue;
      }
      fresh.push(p);
    }
    if (!fresh.length) continue;
    added += fresh.length;
    const [user, day] = k.split("|");
    ops.push({
      updateOne: {
        filter: { user, day },
        update: { $push: { punches: { $each: fresh.map((p) => ({ at: p.at, source: "biometric", by: me._id })) } }, $setOnInsert: { shift: fresh[0].shift || undefined } },
        upsert: true,
      },
    });
  }
  for (let i = 0; i < ops.length; i += 500) await Attendance.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  return { added, skipped, problems, days: ops.length };
}

export = {
  STATUSES,
  shiftInfo,
  dayOfPunch,
  shiftWindow,
  evaluateDay,
  monthSummary,
  distanceM,
  parseIstDateTime,
  getSettings,
  saveSettings,
  register,
  myMonth,
  punch,
  canManage,
  setManual,
  dayDetail,
  previewBiometric,
  importBiometric,
};
