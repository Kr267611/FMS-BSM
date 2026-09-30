const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/User");
const { todayKey } = require("./dates");

// MIS formula: Score = -(50*Late + 100*Pending) / Planned. 0 = perfect.
function score({ planned, late, pending }) {
  if (!planned) return 0;
  return Math.round((-(50 * late + 100 * pending) / planned) * 100) / 100 + 0; // +0 turns -0 into 0
}

// Classify a task, matching the Performance-daily COUNTIFS:
//   Late    : actual day > planned day
//   On time : actual day <= planned day
//   Pending : no actual
function classify(t) {
  if (!t.actualDay) return "pending";
  return t.actualDay > t.plannedDay ? "late" : "onTime";
}

function emptyRow() {
  return { planned: 0, actual: 0, late: 0, onTime: 0, pending: 0, autoClosed: 0, score: 0 };
}

function addTask(row, t) {
  row.planned += 1;
  row[classify(t)] += 1;
  if (t.status === "expired") row.autoClosed += 1; // auto-closed checklist: counted as pending
  row.actual = row.late + row.onTime;
}

// Every delegation is a different task, so a doer's delegations share one MIS row
const DELEGATION_ROW = "Delegations";
const rowOf = (t) => (t.kind === "delegation" ? DELEGATION_ROW : t.label);

function finish(row) {
  row.score = score(row);
  return row;
}

// The range never extends past today - a task that is not due yet is not counted as pending.
function effectiveRange(from, to) {
  const today = todayKey();
  return { from, to: to > today ? today : to };
}

// doerId: one doer; doerIds: the doers a HOD / PC may see (null = everyone)
// A pending task counts only once its due time has passed, so today's 6 pm task is not "pending" at 10 am.
// Finished days are not affected: every due time in them has passed.
function baseMatch(from, to, doerId, doerIds, now = new Date()) {
  const match = {
    plannedDay: { $gte: from, $lte: to },
    status: { $in: ["pending", "done", "expired"] }, // Not Required and skipped steps are not scored
    $or: [{ status: { $ne: "pending" } }, { planned: { $lte: now } }, { planned: null }],
  };
  const oid = (id) => new mongoose.Types.ObjectId(String(id));
  if (doerId) match.doer = oid(doerId);
  else if (Array.isArray(doerIds)) match.doer = { $in: doerIds.map(oid) };
  return match;
}

const KIND_ORDER = { checklist: 0, delegation: 1, app: 2, sheet: 3 };

// Task Count + MIS Summary: every checklist, the delegations and every FMS step per doer, plus the doer's total
async function misReport({ from, to, doerId, doerIds, now = new Date() }) {
  const range = effectiveRange(from, to);
  const tasks = range.from > range.to
    ? []
    : await Task.find(baseMatch(range.from, range.to, doerId, doerIds, now))
        .select("doer label plannedDay actualDay kind status")
        .lean();

  const doers = new Map();
  for (const t of tasks) {
    const id = String(t.doer);
    if (!doers.has(id)) doers.set(id, { total: emptyRow(), rows: new Map() });
    const d = doers.get(id);
    const row = rowOf(t);
    if (!d.rows.has(row)) d.rows.set(row, { label: row, kind: t.kind, ...emptyRow() });
    addTask(d.rows.get(row), t);
    addTask(d.total, t);
  }

  const users = await User.find({ _id: { $in: [...doers.keys()] } }).select("name department").populate("department", "name").lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u]));

  const result = [...doers.entries()].map(([id, d]) => ({
    doer: { _id: id, name: nameOf.get(id)?.name || "?", department: nameOf.get(id)?.department?.name || "" },
    total: finish(d.total),
    rows: [...d.rows.values()].map(finish).sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.label.localeCompare(b.label)),
  }));
  result.sort((a, b) => a.total.score - b.total.score);

  return { from: range.from, to: range.to, doers: result };
}

// Performance-daily: a doer's counts for each day
async function dailyReport({ from, to, doerId, label }) {
  const range = effectiveRange(from, to);
  if (range.from > range.to) return { from: range.from, to: range.to, days: [] };
  const match = baseMatch(range.from, range.to, doerId);
  if (label === DELEGATION_ROW) match.kind = "delegation";
  else if (label) match.label = label;
  const tasks = await Task.find(match).select("plannedDay actualDay status").lean();

  const days = new Map();
  for (const t of tasks) {
    if (!days.has(t.plannedDay)) days.set(t.plannedDay, { day: t.plannedDay, ...emptyRow() });
    addTask(days.get(t.plannedDay), t);
  }
  return {
    from: range.from,
    to: range.to,
    days: [...days.values()].map(finish).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

module.exports = { misReport, dailyReport, score, classify };
