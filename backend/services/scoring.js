const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/User");
const { todayKey } = require("./dates");

// Aapka formula: Score = -(50*Late + 100*Pending) / Planned. 0 = perfect.
function score({ planned, late, pending }) {
  if (!planned) return 0;
  return Math.round((-(50 * late + 100 * pending) / planned) * 100) / 100 + 0; // +0: -0 ko 0 banata hai
}

// Ek task ko classify karo - Performance-daily ke COUNTIFS jaisa:
//   Late    : Actual din > Planned din
//   On time : Actual din <= Planned din
//   Pending : Actual khaali
function classify(t) {
  if (!t.actualDay) return "pending";
  return t.actualDay > t.plannedDay ? "late" : "onTime";
}

function emptyRow() {
  return { planned: 0, actual: 0, late: 0, onTime: 0, pending: 0, score: 0 };
}

function addTask(row, t) {
  row.planned += 1;
  row[classify(t)] += 1;
  row.actual = row.late + row.onTime;
}

function finish(row) {
  row.score = score(row);
  return row;
}

// Range ka "to" aaj se aage nahi jata - jo task abhi due hi nahi, woh pending nahi gina jata.
function effectiveRange(from, to) {
  const today = todayKey();
  return { from, to: to > today ? today : to };
}

function baseMatch(from, to, doerId) {
  const match = {
    plannedDay: { $gte: from, $lte: to },
    status: { $ne: "na" },
  };
  if (doerId) match.doer = new mongoose.Types.ObjectId(String(doerId));
  return match;
}

// Task Count + MIS Summary: har doer ka har step (label) + doer ka total
async function misReport({ from, to, doerId }) {
  const range = effectiveRange(from, to);
  const tasks = range.from > range.to
    ? []
    : await Task.find(baseMatch(range.from, range.to, doerId))
        .select("doer label plannedDay actualDay kind")
        .lean();

  const doers = new Map();
  for (const t of tasks) {
    const id = String(t.doer);
    if (!doers.has(id)) doers.set(id, { total: emptyRow(), rows: new Map() });
    const d = doers.get(id);
    if (!d.rows.has(t.label)) d.rows.set(t.label, { label: t.label, kind: t.kind, ...emptyRow() });
    addTask(d.rows.get(t.label), t);
    addTask(d.total, t);
  }

  const users = await User.find({ _id: { $in: [...doers.keys()] } }).select("name department").lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u]));

  const result = [...doers.entries()].map(([id, d]) => ({
    doer: { _id: id, name: nameOf.get(id)?.name || "?", department: nameOf.get(id)?.department || "" },
    total: finish(d.total),
    rows: [...d.rows.values()].map(finish).sort((a, b) => a.label.localeCompare(b.label)),
  }));
  result.sort((a, b) => a.total.score - b.total.score);

  return { from: range.from, to: range.to, doers: result };
}

// Performance-daily: ek doer ke har din ki counts
async function dailyReport({ from, to, doerId, label }) {
  const range = effectiveRange(from, to);
  if (range.from > range.to) return { from: range.from, to: range.to, days: [] };
  const match = baseMatch(range.from, range.to, doerId);
  if (label) match.label = label;
  const tasks = await Task.find(match).select("plannedDay actualDay").lean();

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
