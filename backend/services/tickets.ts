// MIDAP "Help Ticket": raise -> (auto) assign -> working -> solved -> confirmed (closed) / reopened.
// The solver's part is a Task (kind "ticket") so it shows in My Tasks, the dashboard and the MIS ("Help Tickets" row).
import mongoose = require("mongoose");
import Ticket = require("../models/Ticket");
import TicketCategory = require("../models/TicketCategory");
import Task = require("../models/Task");
import User = require("../models/User");
import Setting = require("../models/Setting");
import orgLib = require("../models/Org");
const { Department } = orgLib;
import datesLib = require("./dates");
const { dayKey } = datesLib;
import calendarLib = require("./calendar");
const { addTatCal } = calendarLib;
import workflowLib = require("./workflow");
const { loadCalendar } = workflowLib;
import scopeLib = require("./scope");
const { visibleUserIds, canSeeUser } = scopeLib;
import permissionsLib = require("./permissions");
const { can } = permissionsLib;

const PRIORITIES = ["normal", "high", "critical"];
const DEFAULT_CATEGORIES = [
  { name: "IT", tatHours: 8, description: "Computer, printer, internet, software, login" },
  { name: "Maintenance", tatHours: 8, description: "Machine breakdown, repair, spare part" },
  { name: "Electrical", tatHours: 8, description: "Power, wiring, motor, light, panel" },
  { name: "HR", tatHours: 24, description: "Salary, attendance, leave, documents" },
  { name: "Store", tatHours: 24, description: "Material, stock, issue / return" },
  { name: "Other", tatHours: 24, description: "Anything else" },
];
const SETTINGS_DEFAULTS = { countInMis: true, autoCloseDays: 3 };
const DAY = 86400000;
const isId = (v) => mongoose.isValidObjectId(v);
const text = (v, n) => String(v ?? "").trim().slice(0, n);
const code = (n) => `HT-${String(n).padStart(4, "0")}`;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// ---------- settings + categories ----------

async function getSettings() {
  const s = await Setting.findOne({ key: "tickets" }).lean<any>();
  return { ...SETTINGS_DEFAULTS, ...(s?.value || {}) };
}
async function saveSettings(b: any = {}) {
  const value = { countInMis: b.countInMis !== false, autoCloseDays: Math.min(30, Math.max(1, Math.round(Number(b.autoCloseDays) || 3))) };
  await Setting.updateOne({ key: "tickets" }, { $set: { value } }, { upsert: true });
  return value;
}

// The first time anyone opens Help Ticket, the usual categories are there to start with
async function ensureCategories() {
  if (await TicketCategory.exists({})) return;
  await TicketCategory.insertMany(DEFAULT_CATEGORIES, { ordered: false }).catch(() => {});
}

// Who a new ticket of this category goes to: the category's solver, else its department's HOD
async function solverFor(category) {
  if (category.solver && (await User.exists({ _id: category.solver, active: true }))) return String(category.solver);
  if (category.department) {
    const dept = await Department.findById(category.department).select("hod").lean<any>();
    if (dept?.hod && (await User.exists({ _id: dept.hod, active: true }))) return String(dept.hod);
  }
  return null;
}

// ---------- who may do what ----------

// Manage a ticket (assign / solve / cancel): the category's solver or its department's HOD, or anyone with
// Help Ticket – Manage (edit) who reaches the raiser or the solver
async function canManage(me, t) {
  if (me.role === "admin") return true;
  const cat = await TicketCategory.findById(t.category?._id || t.category).select("solver department").lean<any>();
  if (cat?.solver && String(cat.solver) === String(me._id)) return true;
  if (cat?.department) {
    const dept = await Department.findById(cat.department).select("hod").lean<any>();
    if (dept?.hod && String(dept.hod) === String(me._id)) return true;
  }
  if (!can(me, "tickets", "edit")) return false;
  if ((await visibleUserIds(me)) === null) return true;
  const solver = t.solver?._id || t.solver;
  return (solver && (await canSeeUser(me, solver))) || (await canSeeUser(me, t.raisedBy?._id || t.raisedBy));
}
const isRaiser = (me, t) => String(t.raisedBy?._id || t.raisedBy) === String(me._id);
const isSolver = (me, t) => t.solver && String(t.solver?._id || t.solver) === String(me._id);
async function canView(me, t) {
  return isRaiser(me, t) || isSolver(me, t) || (await canManage(me, t));
}

// ---------- the solver's task ----------

async function solveBy(now, tatHours) {
  return addTatCal(now, tatHours, "hours", await loadCalendar(), "working");
}

async function makeTask(t, solverId, planned, settings) {
  const task = await Task.create({
    kind: "ticket",
    label: `${code(t.number)} · ${t.title}`.slice(0, 200),
    details: t.description,
    doer: solverId,
    assignedBy: t.raisedBy,
    priority: t.priority === "normal" ? undefined : t.priority,
    planned,
    plannedDay: dayKey(planned),
    status: "pending",
    ticket: t._id,
    unscored: settings.countInMis ? undefined : true,
  });
  return task;
}

const push = (t, by, action, note = "", at = new Date()) => {
  t.history = [...(t.history || []), { at, by, action, note: text(note, 500) }].slice(-80);
};

// ---------- raise ----------

async function raise(me, body: any = {}, now = new Date()) {
  if (!isId(body.category)) throw fail("Choose the category");
  const category = await TicketCategory.findOne({ _id: body.category, active: true }).lean<any>();
  if (!category) throw fail("Choose the category");
  const title = text(body.title, 150);
  if (title.length < 3) throw fail("Write the problem in a few words");
  const photos = (Array.isArray(body.photos) ? body.photos : []).filter((p) => /^[a-f0-9]{24}$/i.test(String(p))).slice(0, 5);
  const priority = PRIORITIES.includes(body.priority) ? body.priority : category.priority || "normal";
  const settings = await getSettings();
  const solver = await solverFor(category);

  let t;
  for (let tries = 0; ; tries++) {
    const last = await Ticket.findOne().sort({ number: -1 }).select("number").lean<any>();
    try {
      t = new Ticket({
        number: (last?.number || 0) + 1,
        raisedBy: me._id,
        category: category._id,
        title,
        description: text(body.description, 2000),
        location: text(body.location, 100),
        photos: photos.length ? photos : undefined,
        priority,
        status: "open",
        solver: solver || undefined,
      });
      push(t, me._id, "raised", "", now);
      await t.save();
      break;
    } catch (err) {
      if (err?.code !== 11000 || tries >= 5) throw err; // two tickets got the same number at once: take the next one
    }
  }
  if (solver) {
    const planned = await solveBy(now, category.tatHours);
    const task = await makeTask(t, solver, planned, settings);
    t.task = task._id;
    t.planned = planned;
    push(t, null, "assigned", `to the ${category.name} solver`, now);
    await t.save();
  }
  return t;
}

// ---------- assign / work / solve ----------

async function load(id) {
  if (!isId(id)) throw fail("Ticket not found", 404);
  const t = await Ticket.findById(id);
  if (!t) throw fail("Ticket not found", 404);
  return t as any;
}

async function assign(me, id, solverId, now = new Date()) {
  const t = await load(id);
  if (!(await canManage(me, t))) throw fail("Only the category's solver, its HOD or an admin can assign this ticket", 403);
  if (!["open", "working"].includes(t.status)) throw fail(`This ticket is already ${t.status}`);
  if (!isId(solverId)) throw fail("Choose who will solve it");
  const solver = await User.findOne({ _id: solverId, active: true }).select("name").lean<any>();
  if (!solver) throw fail("Choose an active person");
  if (String(t.solver || "") === String(solverId)) return t;
  const task = t.task ? await Task.findById(t.task) : null;
  if (task && task.status === "pending") {
    task.doer = solverId; // the solve-by time stays: the clock started when it was first assigned
    await task.save();
  } else if (!task) {
    const category = await TicketCategory.findById(t.category).lean<any>();
    const planned = await solveBy(now, category?.tatHours || 24);
    const created = await makeTask(t, solverId, planned, await getSettings());
    t.task = created._id;
    t.planned = planned;
  }
  t.solver = solverId;
  push(t, me._id, "assigned", `to ${solver.name}`, now);
  await t.save();
  return t;
}

async function startWork(me, id, note = "", now = new Date()) {
  const t = await load(id);
  if (!isSolver(me, t)) throw fail("Only the person solving it can start it", 403);
  if (t.status !== "open") throw fail(`This ticket is already ${t.status}`);
  t.status = "working";
  push(t, me._id, "working", note, now);
  await t.save();
  return t;
}

async function solve(me, id, { solution = "", photos = [], now = new Date() }: any = {}) {
  const t = await load(id);
  if (!isSolver(me, t) && !(await canManage(me, t))) throw fail("Only the person solving it can mark it solved", 403);
  if (!["open", "working"].includes(t.status)) throw fail(`This ticket is already ${t.status}`);
  const what = text(solution, 2000);
  if (what.length < 3) throw fail("Write what was done");
  const pics = (Array.isArray(photos) ? photos : []).filter((p) => /^[a-f0-9]{24}$/i.test(String(p))).slice(0, 5);
  Object.assign(t, { status: "solved", solvedAt: now, solution: what, solutionPhotos: pics.length ? pics : undefined });
  push(t, me._id, "solved", what, now);
  await t.save();
  if (t.task)
    await Task.updateOne(
      { _id: t.task, status: "pending" },
      { $set: { status: "done", actual: now, actualDay: dayKey(now), resolvedAt: now, doneBy: me._id, remarks: what.slice(0, 1000) }, $inc: { __v: 1 } }
    );
  return t;
}

// ---------- the person who raised it ----------

async function confirm(me, id, { rating, note = "", now = new Date() }: any = {}) {
  const t = await load(id);
  if (!isRaiser(me, t)) throw fail("Only the person who raised it can confirm", 403);
  if (t.status !== "solved") throw fail("The ticket is not solved yet");
  const r = Math.round(Number(rating));
  Object.assign(t, { status: "closed", closedAt: now, rating: r >= 1 && r <= 5 ? r : undefined });
  push(t, me._id, "confirmed", note, now);
  await t.save();
  return t;
}

async function reopen(me, id, { reason = "", now = new Date() }: any = {}) {
  const t = await load(id);
  if (!isRaiser(me, t) && !(await canManage(me, t))) throw fail("Only the person who raised it can reopen it", 403);
  if (!["solved", "closed"].includes(t.status)) throw fail("Only a solved ticket can be reopened");
  if (t.status === "closed" && +now - +new Date(t.closedAt) > 7 * DAY) throw fail("This ticket was closed more than 7 days ago – raise a new one");
  const why = text(reason, 500);
  if (why.length < 3) throw fail("Write what is still wrong");
  Object.assign(t, { status: t.solver ? "working" : "open", reopenCount: (t.reopenCount || 0) + 1, closedAt: undefined, autoClosed: undefined, rating: undefined });
  push(t, me._id, "reopened", why, now);
  await t.save();
  // the solver's task opens again with the same solve-by time (late if that has passed)
  if (t.task) await Task.updateOne({ _id: t.task }, { $set: { status: "pending" }, $unset: { actual: 1, actualDay: 1, resolvedAt: 1, doneBy: 1 }, $inc: { __v: 1, reopenCount: 1 } });
  return t;
}

async function cancel(me, id, { reason = "", now = new Date() }: any = {}) {
  const t = await load(id);
  if (!isRaiser(me, t) && !(await canManage(me, t))) throw fail("Only the person who raised it can cancel it", 403);
  if (!["open", "working"].includes(t.status)) throw fail(`This ticket is already ${t.status}`);
  t.status = "cancelled";
  push(t, me._id, "cancelled", reason, now);
  await t.save();
  if (t.task) await Task.updateOne({ _id: t.task, status: "pending" }, { $set: { status: "na", resolvedAt: now, remarks: "Ticket cancelled" }, $inc: { __v: 1 } });
  return t;
}

async function comment(me, id, note, now = new Date()) {
  const t = await load(id);
  if (!(await canView(me, t))) throw fail("You cannot see this ticket", 403);
  const n = text(note, 500);
  if (n.length < 2) throw fail("Write the comment");
  push(t, me._id, "comment", n, now);
  await t.save();
  return t;
}

// Solved tickets the person did not confirm within the settings' days are closed for them
async function autoClose(now = new Date()) {
  const { autoCloseDays } = await getSettings();
  const due = await Ticket.find({ status: "solved", solvedAt: { $lte: new Date(+now - autoCloseDays * DAY) } }).select("_id").lean<any>();
  for (const { _id } of due) {
    await Ticket.updateOne(
      { _id, status: "solved" },
      { $set: { status: "closed", closedAt: now, autoClosed: true }, $push: { history: { at: now, action: "closed", note: `not confirmed in ${autoCloseDays} day(s)` } } }
    );
  }
  return due.length;
}

// ---------- reading ----------

const withPeople = (q) =>
  q
    .populate({ path: "raisedBy", select: "name department", populate: { path: "department", select: "name" } })
    .populate("solver", "name")
    .populate("category", "name tatHours")
    .populate("history.by", "name");

// view: mine (raised by me) | assigned (I solve) | all (what I may manage) | unassigned
async function list(me, { view = "mine", status = "", category = "", q = "", late = "", from = "", to = "" }: any = {}) {
  const filter: Record<string, any> = {};
  if (view === "mine") filter.raisedBy = me._id;
  else if (view === "assigned") filter.solver = me._id;
  else {
    const reach = can(me, "tickets", "view") ? await visibleUserIds(me) : [];
    if (reach !== null) {
      const [visible, cats] = await Promise.all([visibleUserIds(me), TicketCategory.find().select("solver department").lean<any>()]);
      const myDepts = (await Department.find({ hod: me._id }).select("_id").lean<any>()).map((d) => String(d._id));
      const mine = cats.filter((c) => String(c.solver || "") === String(me._id) || (c.department && myDepts.includes(String(c.department)))).map((c) => c._id);
      const or: any[] = [{ category: { $in: mine } }, { raisedBy: me._id }, { solver: me._id }];
      if (can(me, "tickets", "view") && visible) or.push({ raisedBy: { $in: visible } }, { solver: { $in: visible } });
      filter.$or = or;
    }
    if (view === "unassigned") filter.solver = null;
  }
  if (["open", "working", "solved", "closed", "cancelled"].includes(status)) filter.status = status;
  else if (status === "active") filter.status = { $in: ["open", "working"] };
  if (isId(category)) filter.category = category;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) filter.createdAt = { ...(filter.createdAt || {}), $gte: new Date(from + "T00:00:00+05:30") };
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) filter.createdAt = { ...(filter.createdAt || {}), $lte: new Date(to + "T23:59:59+05:30") };
  const words = text(q, 60);
  if (words) {
    const n = /^ht-?(\d+)$/i.exec(words) || /^(\d+)$/.exec(words);
    filter.$and = [{ $or: [...(n ? [{ number: Number(n[1]) }] : []), { title: new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }] }];
  }
  const now = Date.now();
  let rows = await withPeople(Ticket.find(filter).select("-history").sort({ createdAt: -1 }).limit(1000)).lean();
  rows = rows.map((t) => ({ ...t, code: code(t.number), late: Boolean(t.planned && (t.solvedAt ? +new Date(t.solvedAt) > +new Date(t.planned) : ["open", "working"].includes(t.status) && +new Date(t.planned) < now)) }));
  if (late === "1") rows = rows.filter((t) => t.late);
  return rows;
}

async function detail(me, id) {
  const t = await withPeople(Ticket.findById(id)).lean();
  if (!t) throw fail("Ticket not found", 404);
  if (!(await canView(me, t))) throw fail("You cannot see this ticket", 403);
  const manage = await canManage(me, t);
  return {
    ...t,
    code: code(t.number),
    late: Boolean(t.planned && (t.solvedAt ? +new Date(t.solvedAt) > +new Date(t.planned) : ["open", "working"].includes(t.status) && +new Date(t.planned) < Date.now())),
    can: {
      assign: manage && ["open", "working"].includes(t.status),
      start: isSolver(me, t) && t.status === "open",
      solve: (isSolver(me, t) || manage) && ["open", "working"].includes(t.status),
      confirm: isRaiser(me, t) && t.status === "solved",
      reopen: (isRaiser(me, t) || manage) && (t.status === "solved" || (t.status === "closed" && Date.now() - +new Date(t.closedAt) <= 7 * DAY)),
      cancel: (isRaiser(me, t) || manage) && ["open", "working"].includes(t.status),
    },
  };
}

// Report: per category and per solver – raised, solved, on time, late, still open, average hours to solve
async function report(me, { from, to }: any) {
  const rows = await list(me, { view: "all", from, to });
  const group = (keyOf, nameOf) => {
    const m = new Map();
    for (const t of rows) {
      const k = keyOf(t);
      if (!m.has(k)) m.set(k, { key: k, name: nameOf(t), raised: 0, solved: 0, onTime: 0, late: 0, open: 0, hours: 0, reopened: 0, rating: 0, rated: 0 });
      const g = m.get(k);
      g.raised++;
      if (["open", "working"].includes(t.status)) g.open++;
      if (t.solvedAt) {
        g.solved++;
        g.hours += (+new Date(t.solvedAt) - +new Date(t.createdAt)) / 3600000;
        if (t.planned && +new Date(t.solvedAt) > +new Date(t.planned)) g.late++;
        else g.onTime++;
      } else if (t.late) g.late++;
      if (t.reopenCount) g.reopened++;
      if (t.rating) (g.rating += t.rating), g.rated++;
    }
    return [...m.values()].map((g) => ({ ...g, avgHours: g.solved ? Math.round((g.hours / g.solved) * 10) / 10 : null, rating: g.rated ? Math.round((g.rating / g.rated) * 10) / 10 : null })).sort((a, b) => b.raised - a.raised);
  };
  return {
    total: rows.length,
    byCategory: group((t) => String(t.category?._id), (t) => t.category?.name || "—"),
    bySolver: group((t) => String(t.solver?._id || "none"), (t) => t.solver?.name || "Not assigned"),
  };
}

export = { DEFAULT_CATEGORIES, code, getSettings, saveSettings, ensureCategories, solverFor, raise, assign, startWork, solve, confirm, reopen, cancel, comment, autoClose, list, detail, report, canManage };
