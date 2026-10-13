// HRMS leave: how many working days a request takes, what each person's balance is, the policy's rules,
// and what approving a request does. The pure parts (count, credit, check) are covered by tests.
const mongoose = require("mongoose");
const LeaveType = require("../models/LeaveType");
const LeavePolicy = require("../models/LeavePolicy");
const LeaveRequest = require("../models/LeaveRequest");
const Leave = require("../models/Leave");
const User = require("../models/User");
const { addDaysKey, dayKey } = require("./dates");
const { isOff } = require("./calendar");
const { loadCalendar } = require("./workflow");
const { loadDoerCalendars, applyLeave, daysOf, checkLeave } = require("./doerCalendar");
const { canSeeUser } = require("./scope");

const MANAGERS = ["admin", "hod", "pc", "tl"];
const half = (n) => Math.round(n * 2) / 2; // leave counts in half days

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// ---------- pure ----------

// Working days from `from` to `to` on the person's calendar (week-offs and holidays do not count); a half day is 0.5
function countDays(from, to, cal, { halfDay = false } = {}) {
  const work = daysOf(from, to).filter((d) => !isOff(d, cal)).length;
  return halfDay ? (work ? 0.5 : 0) : work;
}

// Days of a rule credited by `asOf` in `year`: frontload = the whole year from 1 January; monthly = 1/12 a month,
// counted for each month whose credit day has come
function credited(policy, rule, year, asOf) {
  const perYear = Number(rule?.perYear) || 0;
  if (!perYear) return 0;
  if (asOf < `${year}-01-01`) return 0;
  if (policy.accrual !== "monthly") return perYear;
  const day = String(Math.min(28, Math.max(1, policy.creditDay || 1))).padStart(2, "0");
  let months = 0;
  for (let m = 1; m <= 12; m++) if (`${year}-${String(m).padStart(2, "0")}-${day}` <= asOf) months++;
  return half((perYear * months) / 12);
}

// The balance of one leave type for one year. used / pending: days in that year's approved / waiting requests;
// prevUnused: last year's quota not taken (for carry forward)
function balanceOf({ policy, type, rule, year, asOf, used = 0, pending = 0, prevUnused = 0 }) {
  if (!type.paid || !policy || !rule) return { limited: false, credited: 0, carried: 0, used, pending, available: Infinity };
  let carried = 0;
  if (type.carryForward && prevUnused > 0) {
    const caps = [rule.carryLimit, type.maxCarryForward].map(Number).filter((n) => n > 0);
    carried = half(Math.min(prevUnused, ...(caps.length ? caps : [Infinity])));
  }
  let total = credited(policy, rule, year, asOf) + carried;
  if (policy.capacity > 0) total = Math.min(total, policy.capacity);
  return { limited: true, credited: half(total - carried), carried, used, pending, available: half(total - used - pending) };
}

// A request against the balance and the policy's rules -> { lwpDays, problems }
function checkAgainst({ days, balance, policy, rule }) {
  const problems = [];
  if (rule?.minAtOnce > 0 && days < rule.minAtOnce) problems.push(`At least ${rule.minAtOnce} day(s) at a time for this leave`);
  if (rule?.maxAtOnce > 0 && days > rule.maxAtOnce) problems.push(`At most ${rule.maxAtOnce} day(s) at a time for this leave`);
  let lwpDays = 0;
  if (balance.limited && days > balance.available) {
    const short = half(days - Math.max(0, balance.available));
    if (policy.exhaust === "reject") problems.push(`Only ${Math.max(0, balance.available)} day(s) left of this leave`);
    else if (policy.exhaust === "negative") {
      if (balance.available - days < -(policy.maxNegative || 0)) problems.push(`The balance may go down to -${policy.maxNegative || 0} at most`);
    } else lwpDays = short; // the rest is unpaid leave
  }
  return { lwpDays, problems };
}

// ---------- with the database ----------

const yearOf = (day) => Number(day.slice(0, 4));

// Every leave type's balance for a person in a year (as of a day), with what is used and waiting
async function balancesFor(userId, { year, asOf, excludeRequest } = {}) {
  const user = await User.findById(userId).select("leavePolicy leavePolicySince gender").lean();
  const policy = user?.leavePolicy ? await LeavePolicy.findById(user.leavePolicy).lean() : null;
  const types = await LeaveType.find({ active: true }).sort({ name: 1 }).lean();
  const y = year || yearOf(asOf || dayKey(new Date()));
  const on = asOf || dayKey(new Date());
  const requests = await LeaveRequest.find({ user: userId, status: { $in: ["approved", "pending"] }, from: { $gte: `${y - 1}-01-01`, $lte: `${y}-12-31` }, ...(excludeRequest ? { _id: { $ne: excludeRequest } } : {}) }).lean();
  const sum = (typeId, yr, status) => half(requests.filter((r) => String(r.type) === String(typeId) && yearOf(r.from) === yr && r.status === status).reduce((a, r) => a + (r.days - (r.lwpDays || 0)), 0));
  return {
    policy,
    gender: user?.gender || "",
    rows: types
      .filter((t) => t.gender === "all" || !user?.gender || t.gender === user.gender)
      .map((type) => {
        const rule = policy?.rules?.find((r) => String(r.type) === String(type._id));
        // last year counts for carry forward only if the policy already applied then
        const hadLastYear = !user.leavePolicySince || user.leavePolicySince <= `${y - 1}-12-31`;
        const prev = rule && hadLastYear ? credited(policy, rule, y - 1, `${y - 1}-12-31`) - sum(type._id, y - 1, "approved") : 0;
        return { type, rule: rule || null, ...balanceOf({ policy, type, rule, year: y, asOf: on, used: sum(type._id, y, "approved"), pending: sum(type._id, y, "pending"), prevUnused: prev }) };
      }),
  };
}

// Everything about a request before it is sent: working days, balance after, unpaid days, problems, the work it touches
async function previewRequest(me, body = {}, { now = new Date(), excludeRequest } = {}) {
  const userId = String(body.user || me._id);
  if (!mongoose.isValidObjectId(userId)) throw fail("Choose the person");
  if (userId !== String(me._id)) {
    if (!MANAGERS.includes(me.role) || !(await canSeeUser(me, userId))) throw fail("You can apply for yourself, or a manager for their people", 403);
  }
  const { from, to } = body;
  checkLeave(from, to);
  const halfDay = Boolean(body.halfDay);
  if (halfDay && from !== to) throw fail("A half day is one day: the first and last day must be the same");
  if (!mongoose.isValidObjectId(body.type)) throw fail("Choose the leave type");
  const type = await LeaveType.findOne({ _id: body.type, active: true }).lean();
  if (!type) throw fail("Choose the leave type");

  const company = await loadCalendar();
  const cal = (await loadDoerCalendars(company, { now }))(userId);
  const days = countDays(from, to, cal, { halfDay });
  const problems = [];
  if (!days) problems.push("These days are all week-offs or holidays – no leave is needed");
  const clash = await LeaveRequest.findOne({ user: userId, status: { $in: ["pending", "approved"] }, from: { $lte: to }, to: { $gte: from }, ...(excludeRequest ? { _id: { $ne: excludeRequest } } : {}) }).lean();
  if (clash) problems.push(`Already ${clash.status === "approved" ? "on leave" : "asked for leave"} from ${clash.from} to ${clash.to}`);

  const book = await balancesFor(userId, { asOf: from, excludeRequest });
  const row = book.rows.find((r) => String(r.type._id) === String(type._id));
  if (!row) problems.push(`${type.name} is not for this person`);
  const balance = row || { limited: false, available: Infinity };
  const check = checkAgainst({ days, balance, policy: book.policy, rule: row?.rule });
  problems.push(...check.problems);
  if (type.requiresDocument && !body.attachment) problems.push(`${type.name} needs a document (photo of the certificate)`);

  const work = await applyLeave({ user: userId, from, to }, company, { dryRun: true, buddies: body.buddies || {} });
  return {
    user: userId,
    days,
    lwpDays: check.lwpDays,
    balance: { limited: balance.limited, available: balance.limited ? balance.available : null, after: balance.limited ? half(balance.available - days) : null },
    policy: book.policy ? { _id: book.policy._id, name: book.policy.name, exhaust: book.policy.exhaust } : null,
    work,
    problems,
    type,
  };
}

async function createRequest(me, body = {}, { now = new Date() } = {}) {
  const p = await previewRequest(me, body, { now });
  if (p.problems.length) throw fail(p.problems[0]);
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (reason.length < 3) throw fail("Write the reason for the leave");
  const buddies = {};
  for (const k of ["checklist", "fms", "delegation"]) {
    const id = body.buddies?.[k];
    if (id && mongoose.isValidObjectId(id) && String(id) !== p.user && (await User.exists({ _id: id, active: true }))) buddies[k] = id;
  }
  return LeaveRequest.create({
    user: p.user,
    type: p.type._id,
    from: body.from,
    to: body.to,
    halfDay: Boolean(body.halfDay),
    session: body.halfDay ? (body.session === "afternoon" ? "afternoon" : "morning") : null,
    days: p.days,
    lwpDays: p.lwpDays,
    reason,
    attachment: String(body.attachment || "").slice(0, 100),
    buddies,
    appliedBy: me._id,
  });
}

// The manager who may approve: admin, or a HOD / PC / Team Leader who oversees the person (never for themselves)
async function canDecide(me, request) {
  if (String(request.user._id || request.user) === String(me._id)) return me.role === "admin";
  if (me.role === "admin") return true;
  return MANAGERS.includes(me.role) && (await canSeeUser(me, request.user._id || request.user));
}

async function load(id) {
  if (!mongoose.isValidObjectId(id)) throw fail("Invalid ID");
  const r = await LeaveRequest.findById(id).populate("type", "name").populate("user", "name");
  if (!r) throw fail("Leave request not found", 404);
  return r;
}

// Approve: the days become a Leave (the task engine stops planning work on them) and the work of those days goes to
// the buddies, or is freed / moved after the leave. A half day only records the leave.
async function approve(id, me, { note = "", now = new Date() } = {}) {
  const r = await load(id);
  if (!(await canDecide(me, r))) throw fail("Only their manager or an admin can approve this leave", 403);
  if (r.status !== "pending") throw fail(`This request is already ${r.status}`);
  let applied = { notRequired: 0, moved: 0, handedOver: 0 };
  if (!r.halfDay) {
    const clash = await Leave.findOne({ user: r.user._id, from: { $lte: r.to }, to: { $gte: r.from } }).lean();
    const leave = clash || (await Leave.create({ user: r.user._id, from: r.from, to: r.to, reason: `${r.type.name}: ${r.reason}`.slice(0, 200), createdBy: me._id }));
    applied = await applyLeave({ user: String(r.user._id), from: r.from, to: r.to, reason: r.type.name }, await loadCalendar(), { by: me._id, now, buddies: r.buddies || {} });
    if (!clash) await Leave.updateOne({ _id: leave._id }, { applied });
    r.leave = leave._id;
  }
  Object.assign(r, { status: "approved", decidedBy: me._id, decidedAt: now, note: String(note || "").slice(0, 300), applied });
  await r.save();
  return r;
}

async function reject(id, me, { note = "", now = new Date() } = {}) {
  const r = await load(id);
  if (!(await canDecide(me, r))) throw fail("Only their manager or an admin can reject this leave", 403);
  if (r.status !== "pending") throw fail(`This request is already ${r.status}`);
  const why = String(note || "").trim();
  if (why.length < 3) throw fail("Write why it is rejected");
  Object.assign(r, { status: "rejected", decidedBy: me._id, decidedAt: now, note: why.slice(0, 300) });
  await r.save();
  return r;
}

// The person takes back a waiting request; a manager can also cancel an approved one (the days stop counting as
// leave for new work; work already handed over or moved stays)
async function cancel(id, me, { now = new Date() } = {}) {
  const r = await load(id);
  const own = String(r.user._id) === String(me._id);
  if (r.status === "pending" && !own && !(await canDecide(me, r))) throw fail("You cannot cancel this request", 403);
  if (r.status === "approved" && !(await canDecide(me, r))) throw fail("Ask your manager to cancel an approved leave", 403);
  if (!["pending", "approved"].includes(r.status)) throw fail(`This request is already ${r.status}`);
  if (r.status === "approved" && r.leave) await Leave.deleteOne({ _id: r.leave });
  Object.assign(r, { status: "cancelled", decidedBy: me._id, decidedAt: now });
  await r.save();
  return r;
}

module.exports = { countDays, credited, balanceOf, checkAgainst, balancesFor, previewRequest, createRequest, canDecide, approve, reject, cancel, MANAGERS, half };
