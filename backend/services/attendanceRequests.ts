// HRMS attendance regularization: ask to fix a day (missed punch / on duty), the manager approves or rejects.
// Approving a missed punch adds the punch(es) as "manual" (by the approver); approving on duty marks the day.
import AttendanceRequest = require("../models/AttendanceRequest");
import Attendance = require("../models/Attendance");
import Shift = require("../models/Shift");
import User = require("../models/User");
import datesLib = require("./dates");
const { addDaysKey, dayKey, isRealDay } = datesLib;
import calendarLib = require("./calendar");
const { fromIst } = calendarLib;
import workflowLib = require("./workflow");
const { loadCalendar } = workflowLib;
import scopeLib = require("./scope");
const { visibleUserIds } = scopeLib;
import att = require("./attendance");
import permissionsLib = require("./permissions");
const { can, isAdmin } = permissionsLib;

const MAX_BACK_DAYS = 30; // a correction can be asked for up to 30 days back
const MIN = 60 * 1000;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// The punch times a missed-punch request adds. An out time before the in time (or, for a night shift
// with no in time, before the shift's start) is the next morning. Pure.
function requestedPunches({ day, inTime, outTime }, sh) {
  const out = [];
  if (inTime) out.push(fromIst(day, toMin(inTime)));
  if (outTime) {
    const m = toMin(outTime);
    const nextDay = inTime ? m <= toMin(inTime) : sh.overnight && m < sh.startMin;
    out.push(fromIst(nextDay ? addDaysKey(day, 1) : day, m));
  }
  return out;
}

async function create(me, body: any = {}, now = new Date()) {
  const userId = body.user && String(body.user) !== String(me._id) ? String(body.user) : String(me._id);
  if (userId !== String(me._id) && !(await att.canManage(me, userId))) throw fail("You can only ask for your own attendance", 403);
  const user = await User.findById(userId).select("name active").lean<any>();
  if (!user?.active) throw fail("User not found", 404);

  const day = String(body.day || "");
  const today = dayKey(now);
  if (!isRealDay(day)) throw fail("Choose the day");
  if (day > today) throw fail("You can ask only for today or a day before");
  if (day < addDaysKey(today, -MAX_BACK_DAYS)) throw fail(`You can ask only for the last ${MAX_BACK_DAYS} days`);
  const kind = body.kind === "onduty" ? "onduty" : body.kind === "missed" ? "missed" : null;
  if (!kind) throw fail("Choose Missed punch or On duty");
  const reason = String(body.reason || "").trim().slice(0, 300);
  if (reason.length < 3) throw fail("Write the reason");

  const v: Record<string, any> = { user: userId, day, kind, reason, appliedBy: me._id };
  if (kind === "missed") {
    const inTime = body.inTime ? String(body.inTime) : "";
    const outTime = body.outTime ? String(body.outTime) : "";
    if ((inTime && !isTime(inTime)) || (outTime && !isTime(outTime))) throw fail("Enter the time like 09:30");
    if (!inTime && !outTime) throw fail("Enter the punch-in or punch-out time you missed");
    if (inTime) v.inTime = inTime;
    if (outTime) v.outTime = outTime;
  } else {
    if (!["P", "H"].includes(body.status)) throw fail("Choose Present or Half day");
    v.status = body.status;
  }
  if (await AttendanceRequest.exists({ user: userId, day, state: "pending" })) throw fail("A request for this day is already waiting for approval");
  return AttendanceRequest.create(v);
}

// view: "approve" (waiting for me) | "mine" | "all" (managers: everyone they can see)
async function list(me, { view = "mine", state = "", user = "", month = "" }: any = {}) {
  const filter: Record<string, any> = {};
  if (view === "mine" || !can(me, "attendance", "view")) filter.user = me._id;
  else {
    const visible = await visibleUserIds(me);
    if (visible !== null) filter.user = { $in: visible };
    if (user) {
      if (visible !== null && !visible.includes(String(user))) throw fail("You can only see people in your department", 403);
      filter.user = user;
    }
  }
  if (view === "approve") filter.state = "pending";
  else if (["pending", "approved", "rejected", "cancelled"].includes(state)) filter.state = state;
  if (/^\d{4}-\d{2}$/.test(month)) filter.day = { $gte: `${month}-01`, $lte: `${month}-31` };
  let rows = await AttendanceRequest.find(filter)
    .sort({ state: 1, createdAt: -1 })
    .limit(1000)
    .populate({ path: "user", select: "name department", populate: { path: "department", select: "name" } })
    .populate("decidedBy", "name")
    .populate("appliedBy", "name")
    .lean<any>();
  if (view === "approve") rows = rows.filter((r) => isAdmin(me) || String(r.user?._id) !== String(me._id));
  for (const r of rows) r.canDecide = r.state === "pending" && (await att.canManage(me, r.user?._id));
  return rows;
}

async function load(id) {
  const r = await AttendanceRequest.findById(id).populate("user", "name shift");
  if (!r) throw fail("Request not found", 404);
  return r as any;
}

async function approve(id, me, { note = "", now = new Date() }: any = {}) {
  const r = await load(id);
  if (r.state !== "pending") throw fail(`This request is already ${r.state}`);
  if (!(await att.canManage(me, r.user._id))) throw fail("Only their manager or an admin can approve this", 403);
  if (r.kind === "missed") {
    const [shift, company] = await Promise.all([r.user.shift ? Shift.findById(r.user.shift).lean<any>() : null, loadCalendar()]);
    const times = requestedPunches(r, att.shiftInfo(shift, company));
    const rec = await Attendance.findOne({ user: r.user._id, day: r.day }).select("punches.at").lean<any>();
    const have = (rec?.punches || []).map((p) => +new Date(p.at));
    const fresh = times.filter((t) => !have.some((h) => Math.abs(h - +t) < MIN));
    if (fresh.length)
      await Attendance.updateOne(
        { user: r.user._id, day: r.day },
        { $push: { punches: { $each: fresh.map((at) => ({ at, source: "manual", by: me._id })) } }, $setOnInsert: { shift: r.user.shift || undefined } },
        { upsert: true }
      );
  } else {
    await Attendance.updateOne(
      { user: r.user._id, day: r.day },
      { $set: { manual: { status: r.status, note: `On duty: ${r.reason}`.slice(0, 300), by: me._id, at: now } } },
      { upsert: true }
    );
  }
  Object.assign(r, { state: "approved", decidedBy: me._id, decidedAt: now, note: String(note || "").trim().slice(0, 300) });
  await r.save();
  return r;
}

async function reject(id, me, { note = "", now = new Date() }: any = {}) {
  const r = await load(id);
  if (r.state !== "pending") throw fail(`This request is already ${r.state}`);
  if (!(await att.canManage(me, r.user._id))) throw fail("Only their manager or an admin can reject this", 403);
  const why = String(note || "").trim().slice(0, 300);
  if (why.length < 3) throw fail("Write why it is rejected");
  Object.assign(r, { state: "rejected", decidedBy: me._id, decidedAt: now, note: why });
  await r.save();
  return r;
}

// The person (or whoever asked for them) takes back a request that is still waiting
async function cancel(id, me) {
  const r = await load(id);
  if (r.state !== "pending") throw fail(`This request is already ${r.state}`);
  if (String(r.user._id) !== String(me._id) && String(r.appliedBy) !== String(me._id)) throw fail("Only the person who asked can take it back", 403);
  r.state = "cancelled";
  await r.save();
  return r;
}

async function pendingCount(me) {
  if (!can(me, "attendance", "edit")) return 0;
  const visible = await visibleUserIds(me);
  const filter: Record<string, any> = { state: "pending" };
  if (visible !== null) filter.user = { $in: visible.filter((id) => isAdmin(me) || id !== String(me._id)) };
  else if (!isAdmin(me)) filter.user = { $ne: me._id };
  return AttendanceRequest.countDocuments(filter);
}

export = { MAX_BACK_DAYS, requestedPunches, create, list, approve, reject, cancel, pendingCount };
