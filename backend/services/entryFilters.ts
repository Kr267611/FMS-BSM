// FMS Entries: column filters and sorting like a Google Sheet's filter view.
//   f    = JSON { fields: { <fieldKey>: { in?: [values], text?, min?, max?, from?, to? } },
//                 steps:  { <stepKey>:  { states?: [state], doers?: [userId] } } }
//   sort = "<fieldKey>:asc" | "<fieldKey>:desc" | "startDate:asc" | "jobNo:desc"…
// Every key is checked against the FMS's own fields and steps, so nothing else in the database can be reached.
import mongoose = require("mongoose");
import Task = require("../models/Task");
import Job = require("../models/Job");
import User = require("../models/User");
import datesLib = require("./dates");
const { dayKey } = datesLib;

// A step's state as the grid shows it
const STATES = {
  notStarted: { status: "waiting" },
  pending: { status: "pending" },
  overdue: (now) => ({ status: "pending", planned: { $lt: now } }),
  dueToday: (now, today) => ({ status: "pending", plannedDay: today }),
  doneOnTime: { status: "done", $expr: { $lte: ["$actualDay", "$plannedDay"] } },
  doneLate: { status: "done", $expr: { $gt: ["$actualDay", "$plannedDay"] } },
  na: { status: "na" },
  skipped: { status: "skipped" },
};
const KEY = /^[A-Za-z0-9_]{1,60}$/;
const BLANK = "(blank)";
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const num = (v) => (v === "" || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v));
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function parse(raw) {
  if (!raw) return { fields: {}, steps: {} };
  let f;
  try {
    f = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw fail("The filters could not be read");
  }
  return { fields: f?.fields && typeof f.fields === "object" ? f.fields : {}, steps: f?.steps && typeof f.steps === "object" ? f.steps : {} };
}

// One entry field's condition on Job.data
function fieldCondition(field, c) {
  const path = `data.${field.key}`;
  const and = [];
  if (Array.isArray(c.in) && c.in.length) {
    const values = c.in.slice(0, 500).map((v) => String(v));
    const real = values.filter((v) => v !== BLANK);
    const or: any[] = [];
    if (real.length) {
      // numbers may be stored as text by an import
      const typed = field.type === "number" ? [...real, ...real.map(Number).filter((n) => isFinite(n))] : real;
      or.push({ [path]: { $in: typed } });
    }
    if (values.includes(BLANK)) or.push({ [path]: { $in: [null, ""] } }, { [path]: { $exists: false } });
    if (or.length) and.push({ $or: or });
  }
  if (c.text && String(c.text).trim()) and.push({ [path]: { $regex: esc(String(c.text).trim().slice(0, 100)), $options: "i" } });
  const min = num(c.min);
  const max = num(c.max);
  if (min !== null || max !== null) {
    const value = { $convert: { input: `$${path}`, to: "double", onError: null, onNull: null } };
    const parts = [{ $ne: [value, null] }];
    if (min !== null) parts.push({ $gte: [value, min] } as any);
    if (max !== null) parts.push({ $lte: [value, max] } as any);
    and.push({ $expr: { $and: parts } });
  }
  if (isDay(c.from)) and.push({ [path]: { $gte: c.from } });
  if (isDay(c.to)) and.push({ [path]: { $lte: `${c.to}￿` } }); // "2026-10-15" and "2026-10-15T…" both count
  return and;
}

// Adds the column filters to a Job query (mutates and returns it)
async function applyColumnFilters(filter, raw, process, now = new Date()) {
  const { fields, steps } = parse(raw);
  const byField = new Map<string, any>((process.fields || []).map((f) => [f.key, f]));
  const stepKeys = new Set<string>((process.steps || []).map((s) => s.key));
  const and = [];
  for (const [key, c] of Object.entries<any>(fields)) {
    if (!KEY.test(key) || !byField.has(key) || !c || typeof c !== "object") continue;
    and.push(...fieldCondition(byField.get(key), c));
  }
  const today = dayKey(now);
  let ids = null; // entries every step filter agrees on
  for (const [key, c] of Object.entries<any>(steps)) {
    if (!stepKeys.has(key) || !c || typeof c !== "object") continue;
    const states = (Array.isArray(c.states) ? c.states : []).filter((s) => STATES[s]);
    const doers = (Array.isArray(c.doers) ? c.doers : []).filter((d) => mongoose.isValidObjectId(d)).map((d) => new mongoose.Types.ObjectId(d));
    if (!states.length && !doers.length) continue;
    const cond: Record<string, any> = { process: process._id, kind: "app", stepKey: key };
    if (states.length) cond.$or = states.map((s) => (typeof STATES[s] === "function" ? STATES[s](now, today) : STATES[s]));
    if (doers.length) cond.doer = { $in: doers };
    const jobs = (await Task.distinct("job", cond)).map(String);
    ids = ids === null ? new Set<string>(jobs) : new Set<string>(jobs.filter((j) => ids.has(j)));
  }
  if (ids !== null) and.push({ _id: { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) } });
  if (and.length) filter.$and = [...(filter.$and || []), ...and];
  return filter;
}

// "gross_meter:desc" -> a Mongo sort; the newest entries first otherwise
function sortOf(raw, process): Record<string, 1 | -1> {
  const [key, dir] = String(raw || "").split(":");
  const d = dir === "asc" ? 1 : -1;
  if (key === "startDate" || key === "jobNo") return { [key]: d, _id: d };
  if (KEY.test(key || "") && (process.fields || []).some((f) => f.key === key)) return { [`data.${key}`]: d, startDate: -1, _id: -1 };
  return { startDate: -1, _id: -1 };
}

// A to Z, as a sheet lists them, "(blank)" last
const az = (list) => list.sort((a, b) => Number(a.value === BLANK) - Number(b.value === BLANK) || a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" }));

// The values a column holds (for its filter list), A to Z with how many entries have each; person fields and step doers by name
async function columnValues(process, { field, step }: any) {
  if (step) {
    if (!(process.steps || []).some((s) => s.key === step)) throw fail("Step not found");
    const rows = await Task.aggregate([{ $match: { process: process._id, kind: "app", stepKey: step, doer: { $ne: null } } }, { $group: { _id: "$doer", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 500 }]);
    const names = new Map<string, string>((await User.find({ _id: { $in: rows.map((r) => r._id) } }).select("name").lean<any>()).map((u) => [String(u._id), u.name]));
    return az(rows.map((r) => ({ value: String(r._id), label: names.get(String(r._id)) || "(removed user)", count: r.count })));
  }
  const f = (process.fields || []).find((x) => x.key === field);
  if (!f || !KEY.test(field)) throw fail("Field not found");
  const rows = await Job.aggregate([{ $match: { process: process._id } }, { $group: { _id: `$data.${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 500 }]);
  let names = new Map<string, string>();
  if (f.type === "user") {
    const idList = rows.map((r) => r._id).filter((v) => mongoose.isValidObjectId(v));
    names = new Map((await User.find({ _id: { $in: idList } }).select("name").lean<any>()).map((u) => [String(u._id), u.name]));
  }
  return az(rows.map((r) => {
    const blank = r._id === null || r._id === undefined || r._id === "";
    const value = blank ? BLANK : String(r._id);
    return { value, label: blank ? BLANK : f.type === "user" ? names.get(value) || value : value, count: r.count };
  }));
}

export = { applyColumnFilters, sortOf, columnValues, STATES: Object.keys(STATES), BLANK };
