// Each person's own working calendar: the company calendar, with their own week-off (MIDAP "Doer Weekoff",
// when set it replaces the company's) and their leave days (MIDAP "Doer Holiday") added as days off.
// Checklist due days and FMS planned dates use the doer's calendar, so nobody is late for a day they were away.
const User = require("../models/User");
const Leave = require("../models/Leave");
const Task = require("../models/Task");
const { addDaysKey, dayKey } = require("./dates");
const { isOff, fromIst, toIst } = require("./calendar");

const MAX_LEAVE_DAYS = 120;

// Every day key from `from` to `to` (inclusive)
function daysOf(from, to) {
  const out = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDaysKey(d, 1), i++) out.push(d);
  return out;
}

// company: normalizeCalendar(...). weekOff: [0-6] or null (= the company's). leaveDays: day keys. Pure.
function personalCalendar(company, weekOff, leaveDays = []) {
  if (!weekOff && !leaveDays.length) return company;
  const leave = new Set(leaveDays);
  return {
    ...company,
    weekOff: Array.isArray(weekOff) && weekOff.length < 7 ? new Set(weekOff) : company.weekOff,
    holidays: new Set([...company.holidays, ...leave]),
    leave,
  };
}

// Everyone who has their own week-off or leave -> (userId) => their calendar (the company's for everyone else)
async function loadDoerCalendars(company, { now = new Date() } = {}) {
  const since = addDaysKey(dayKey(now), -400);
  const [users, leaves] = await Promise.all([
    User.find({ "weekOff.0": { $exists: true } }).select("weekOff").lean(),
    Leave.find({ to: { $gte: since } }).select("user from to").lean(),
  ]);
  const weekOffs = new Map(users.map((u) => [String(u._id), u.weekOff]));
  const leaveDays = new Map();
  for (const l of leaves) {
    const k = String(l.user);
    leaveDays.set(k, [...(leaveDays.get(k) || []), ...daysOf(l.from, l.to)]);
  }
  const cache = new Map();
  return (userId) => {
    if (!userId) return company;
    const k = String(userId);
    if (!weekOffs.has(k) && !leaveDays.has(k)) return company;
    if (!cache.has(k)) cache.set(k, personalCalendar(company, weekOffs.get(k), leaveDays.get(k) || []));
    return cache.get(k);
  };
}

// A planned time that falls on the doer's leave moves to their first working day after it, same time of day
function outsideLeave(planned, cal) {
  if (!planned || !cal?.leave?.size) return planned;
  const { day, min } = toIst(planned);
  if (!cal.leave.has(day)) return planned;
  let d = day;
  for (let i = 0; i < 400 && isOff(d, cal); i++) d = addDaysKey(d, 1);
  return fromIst(d, min);
}

function checkLeave(from, to) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s));
  if (!ok(from) || !ok(to)) throw Object.assign(new Error("Enter the first and last day away"), { status: 400 });
  if (to < from) throw Object.assign(new Error("The last day cannot be before the first day"), { status: 400 });
  if (daysOf(from, to).length > MAX_LEAVE_DAYS) throw Object.assign(new Error(`A leave can be at most ${MAX_LEAVE_DAYS} days. Add longer ones in parts.`), { status: 400 });
}

// What a leave does to the person's open tasks (dryRun: only count):
//   checklist tasks on those days (pending, or auto-closed as not done) -> Not required "On leave"
//   FMS steps and delegations due on those days -> the first working day after the leave, same time of day
async function applyLeave({ user, from, to, reason }, company, { by, now = new Date(), dryRun = false } = {}) {
  const calFor = await loadDoerCalendars(company, { now });
  const base = calFor(user);
  const cal = personalCalendar(base, null, [...(base.leave || []), ...daysOf(from, to)]);
  const inRange = { doer: user, plannedDay: { $gte: from, $lte: to } };
  const [checklists, movable] = await Promise.all([
    Task.find({ ...inRange, kind: "checklist", status: { $in: ["pending", "expired"] } }).select("_id").lean(),
    Task.find({ ...inRange, kind: { $in: ["app", "delegation"] }, status: "pending" }).select("_id kind planned plannedDay").lean(),
  ]);
  const moves = movable.map((t) => ({ t, to: outsideLeave(t.planned || fromIst(t.plannedDay, 18 * 60), cal) }));
  const movedTo = moves.length ? dayKey(moves.reduce((a, m) => (m.to < a ? m.to : a), moves[0].to)) : null;
  const out = { notRequired: checklists.length, moved: moves.length, movedTo };
  if (dryRun) return out;

  const note = `On leave ${from}${to !== from ? ` to ${to}` : ""}${reason ? ` – ${reason}` : ""}`;
  if (checklists.length) {
    await Task.updateMany(
      { _id: { $in: checklists.map((t) => t._id) }, status: { $in: ["pending", "expired"] } },
      { $set: { status: "na", resolvedAt: now, remarks: note }, $inc: { __v: 1 } }
    );
  }
  for (const { t, to: when } of moves) {
    await Task.updateOne(
      { _id: t._id, status: "pending" },
      {
        $set: { planned: when, plannedDay: dayKey(when) },
        $inc: { __v: 1 },
        $push: { log: { $each: [{ at: now, by, action: "moved for leave", note: `${t.plannedDay} → ${dayKey(when)} (${note})` }], $slice: -60 } },
      }
    );
  }
  return out;
}

module.exports = { personalCalendar, loadDoerCalendars, outsideLeave, applyLeave, checkLeave, daysOf, MAX_LEAVE_DAYS };
