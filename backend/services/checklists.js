// Checklists (recurring tasks): validation, turning a schedule into one Task per due day, and auto-close.
// Tasks are made "createBefore" days ahead, so they show up in My Tasks before they are due.
const Checklist = require("../models/Checklist");
const Task = require("../models/Task");
const User = require("../models/User");
const TaskGroup = require("../models/TaskGroup");
const { dayKey, todayKey, addDaysKey } = require("./dates");
const { fromIst, isTime, toMin } = require("./calendar");
const { dueDays, nextDueDays } = require("./recurrence");
const { cleanFields, STEP_FIELD_TYPES } = require("./fms/definition");
const { loadCalendar } = require("./workflow");
const { loadDoerCalendars } = require("./doerCalendar");

const { FREQUENCIES, HOLIDAY_RULES } = Checklist;
const { PRIORITIES } = Task;
const MAX_CATCH_UP = 7; // days a server that was asleep fills in when it wakes up
const ID_RE = /^[a-f0-9]{24}$/i;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const idOf = (v) => {
  const s = v && typeof v === "object" && v._id ? String(v._id) : v ? String(v) : "";
  return ID_RE.test(s) ? s : undefined;
};
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s));
const blank = (v) => v === undefined || v === null || String(v).trim() === "";
function int(v, min, max, dflt) {
  if (blank(v)) return dflt;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
const ints = (list, min, max) =>
  [...new Set((Array.isArray(list) ? list : String(list ?? "").split(/[\s,]+/)).map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max))].sort(
    (a, b) => a - b
  );

// What an admin sent from the form -> the checklist that is saved.
// preview: only the schedule matters (no name or doer needed yet).
function cleanChecklist(body = {}, { activeIds = new Set(), today = todayKey(), preview = false } = {}) {
  const name = text(body.name, 150);
  if (!name && !preview) throw fail("Give the checklist a name");

  const type = FREQUENCIES.includes(body.frequency?.type) ? body.frequency.type : null;
  if (!type) throw fail("Choose how often it repeats");
  const frequency = { type };
  if (type === "weekly") {
    frequency.days = ints(body.frequency.days, 0, 6);
    if (!frequency.days.length) throw fail("Choose at least one weekday");
  }
  if (type === "monthly") {
    frequency.dates = ints(body.frequency.dates, 1, 31);
    if (!frequency.dates.length) throw fail("Choose at least one date of the month");
    frequency.every = int(body.frequency.every, 1, 12, 1);
  }
  if (type === "interval") {
    frequency.every = int(body.frequency.every, 1, 365, 0);
    if (!frequency.every) throw fail("Enter after how many days it repeats");
  }

  if (!blank(body.start) && !isDay(body.start)) throw fail("The start date is not valid");
  const start = isDay(body.start) ? body.start : today;
  let end;
  if (!blank(body.end)) {
    if (!isDay(body.end)) throw fail("The end date is not valid");
    if (body.end < start) throw fail("The end date is before the start date");
    end = body.end;
  }
  if (!blank(body.dueTime) && !isTime(body.dueTime)) throw fail("The due time must look like 18:00");

  const videoLink = text(body.videoLink, 1000);
  if (videoLink && !/^https?:\/\/\S+$/i.test(videoLink)) throw fail("The video link must start with http:// or https://");

  const person = (v, label, required) => {
    const id = idOf(v);
    if (!id) {
      if (required) throw fail(`Choose the ${label}`);
      return undefined;
    }
    if (!activeIds.has(id)) throw fail(`The ${label} must be an active user`);
    return id;
  };

  return {
    name,
    how: text(body.how, 3000),
    videoLink,
    doer: preview ? idOf(body.doer) : person(body.doer, "doer", true),
    pc: preview ? undefined : person(body.pc, "PC"),
    auditor: preview ? undefined : person(body.auditor, "auditor"),
    group: idOf(body.group) || null,
    priority: PRIORITIES.includes(body.priority) ? body.priority : "normal",
    effortMinutes: ((x) => Math.min(24 * 60, Math.max(0, Math.round(Number(x) || 0))))(body.effortMinutes),
    frequency,
    start,
    end,
    dueTime: isTime(body.dueTime) ? body.dueTime : "18:00",
    createBefore: int(body.createBefore, 0, 30, 0),
    onHoliday: HOLIDAY_RULES.includes(body.onHoliday) ? body.onHoliday : type === "daily" ? "skip" : "next",
    autoCloseDays: int(body.autoCloseDays, 0, 60, null),
    fields: cleanFields(body.fields, STEP_FIELD_TYPES, "checklist form"),
    active: body.active !== false,
  };
}

// "Every Mon, Thu", "Monthly on 1, 15", "Every 3 months on the last day"…
function describe(c) {
  const f = c.frequency || {};
  const dates = (f.dates || []).map((d) => (d === 31 ? "last day" : d)).join(", ");
  switch (f.type) {
    case "daily":
      return "Every day";
    case "weekly":
      return `Every ${(f.days || []).map((d) => WEEKDAYS[d]).join(", ")}`;
    case "monthly":
      return `${f.every > 1 ? `Every ${f.every} months` : "Monthly"} on ${dates}`;
    case "interval":
      return `Every ${f.every} days`;
    default:
      return "";
  }
}

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

// The Task for one due day
function occurrence(c, day, now) {
  return compact({
    kind: "checklist",
    checklist: c._id,
    label: c.name,
    doer: c.doer,
    pc: c.pc,
    auditor: c.auditor,
    priority: c.priority || "normal",
    status: "pending",
    planned: fromIst(day, toMin(c.dueTime || "18:00")),
    plannedDay: day,
    activatedAt: now,
    closeAt: c.autoCloseDays === null || c.autoCloseDays === undefined ? undefined : fromIst(addDaysKey(day, c.autoCloseDays + 1), 0),
    remarks: "",
    __v: 0,
  });
}

// Make the tasks of one checklist up to today + createBefore. Safe to run any number of times.
// cal: the company calendar; calFor: (user) -> their own calendar (week-off, leave), loaded when not given
async function generateChecklist(c, { now = new Date(), cal, calFor } = {}) {
  if (!c.active) return 0;
  const company = cal || (await loadCalendar());
  const calendar = (calFor || (await loadDoerCalendars(company, { now })))(c.doer);
  const today = dayKey(now);
  const until = addDaysKey(today, c.createBefore || 0);
  let from = c.generatedUntil ? addDaysKey(c.generatedUntil, 1) : today;
  const floor = addDaysKey(today, -MAX_CATCH_UP);
  if (from < floor) from = floor;
  if (from < c.start) from = c.start;
  const last = c.end && c.end < until ? c.end : until;

  let created = 0;
  if (from <= last) {
    const days = dueDays(c, from, last, calendar);
    if (days.length) {
      const ops = days.map((day) => ({
        updateOne: { filter: { checklist: c._id, plannedDay: day }, update: { $setOnInsert: occurrence(c, day, now) }, upsert: true },
      }));
      try {
        const r = await Task.bulkWrite(ops, { ordered: false });
        created = r.upsertedCount || 0;
      } catch (err) {
        // two servers generating at the same moment: the unique index keeps one task per day
        const errors = err.writeErrors || err.result?.getWriteErrors?.() || [];
        if (!(err.code === 11000 || (errors.length && errors.every((e) => e.code === 11000)))) throw err;
        created = err.result?.upsertedCount || 0;
      }
    }
  }
  if (!c.generatedUntil || c.generatedUntil < until) await Checklist.updateOne({ _id: c._id }, { generatedUntil: until });
  return created;
}

// Scheduler, cron and before lists: make due tasks, then close the ones past their auto-close time
async function sweepChecklists(now = new Date()) {
  const cal = await loadCalendar();
  const calFor = await loadDoerCalendars(cal, { now });
  const today = dayKey(now);
  const list = await Checklist.find({ active: true, $or: [{ generatedUntil: null }, { generatedUntil: { $lt: addDaysKey(today, 30) } }] }).lean();
  let created = 0;
  for (const c of list) {
    if (c.generatedUntil && c.generatedUntil >= addDaysKey(today, c.createBefore || 0)) continue;
    try {
      created += await generateChecklist(c, { now, cal, calFor });
    } catch (err) {
      console.error(`Checklist "${c.name}":`, err.message);
    }
  }

  const due = await Task.find({ kind: "checklist", status: "pending", closeAt: { $ne: null, $lte: now } }).select("_id closeAt").lean();
  if (due.length) {
    await Task.bulkWrite(
      due.map((t) => ({ updateOne: { filter: { _id: t._id, status: "pending" }, update: { $set: { status: "expired", resolvedAt: t.closeAt } } } }))
    );
  }
  return { created, expired: due.length };
}

// After a checklist is changed: tasks for later days are made again with the new rules.
// Tasks up to today keep their doer and due time.
async function afterChange(c, before, now = new Date()) {
  const today = dayKey(now);
  await Task.deleteMany({ checklist: c._id, status: "pending", plannedDay: { $gt: today } });
  let generatedUntil = c.generatedUntil;
  if (generatedUntil && generatedUntil > today) generatedUntil = today;
  if (before && !before.active && c.active) generatedUntil = addDaysKey(today, -1); // switched back on: start today, no backlog
  await Checklist.updateOne({ _id: c._id }, { generatedUntil: generatedUntil || null });
  return generateChecklist({ ...c, generatedUntil }, { now });
}

// Next due days shown on the list and in the form
async function preview(c, count = 8, now = new Date()) {
  const cal = await loadCalendar();
  return nextDueDays(c, dayKey(now), count, c.doer ? (await loadDoerCalendars(cal, { now }))(c.doer) : cal);
}

// ---------- bulk upload (CSV) ----------

const DAY_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "dd/mm/yyyy", "dd-mm-yyyy" or "yyyy-mm-dd" -> "yyyy-mm-dd"
function parseDay(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) throw fail(`"${s}" is not a date (use dd/mm/yyyy)`);
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// "18:00", "6:30 PM", "6 pm" -> "18:30"
function parseTime(v) {
  const s = norm(v);
  if (!s) return "";
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) throw fail(`"${v}" is not a time (use 18:00)`);
  let h = Number(m[1]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  const t = `${String(h).padStart(2, "0")}:${m[2] || "00"}`;
  if (!isTime(t)) throw fail(`"${v}" is not a time (use 18:00)`);
  return t;
}

function parseFrequency(r) {
  const f = norm(r.frequency);
  const everyNum = Number(String(r.every ?? "").trim()) || Number((f.match(/\d+/) || [])[0]) || undefined;
  const days = String(r.days ?? "")
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((d) => (/^\d$/.test(d) ? Number(d) : DAY_NAMES[norm(d).slice(0, 3)]))
    .filter((n) => n !== undefined);
  const dates = String(r.dates ?? "")
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((d) => (/^last/i.test(d) ? 31 : Number(d)));
  if (!f || /daily|every day/.test(f)) return { type: "daily" };
  if (/week/.test(f)) return { type: "weekly", days };
  if (/quarter/.test(f)) return { type: "monthly", dates, every: 3 };
  if (/half/.test(f)) return { type: "monthly", dates, every: 6 };
  if (/year|annual/.test(f)) return { type: "monthly", dates, every: 12 };
  if (/month/.test(f)) return { type: "monthly", dates, every: everyNum || 1 };
  if (/day|interval/.test(f)) return { type: "interval", every: everyNum };
  throw fail(`Frequency "${r.frequency}" is not known (Daily, Weekly, Monthly, Quarterly, Yearly or Every N days)`);
}

function parseHoliday(v) {
  const s = norm(v);
  if (!s) return undefined;
  if (/skip|no/.test(s)) return "skip";
  if (/prev|before/.test(s)) return "previous";
  if (/next|after/.test(s)) return "next";
  throw fail(`"If holiday" must be skip, next or previous`);
}

// Look people up by name, username or email; a name two users share is refused
function peopleDirectory(users) {
  const map = new Map();
  const add = (key, u) => {
    if (!key) return;
    const prev = map.get(key);
    map.set(key, prev && String(prev._id) !== String(u._id) ? "ambiguous" : u);
  };
  for (const u of users) {
    add(norm(u.name), u);
    add(norm(u.username), u);
    add(norm(u.email), u);
  }
  return (value, label, required) => {
    const key = norm(value);
    if (!key) {
      if (required) throw fail(`${label} is missing`);
      return undefined;
    }
    const u = map.get(key);
    if (u === "ambiguous") throw fail(`Two users are called "${value}" – use the username`);
    if (!u) throw fail(`${label} "${value}" is not an active user`);
    return String(u._id);
  };
}

// rows: objects keyed by the template's column names. dryRun: check only.
async function importRows(rows, { user, dryRun = true, now = new Date() }) {
  const users = await User.find({ active: true }).select("name username email").lean();
  const who = peopleDirectory(users);
  const activeIds = new Set(users.map((u) => String(u._id)));
  const groups = new Map((await TaskGroup.find().lean()).map((g) => [norm(g.name), g._id]));
  const today = dayKey(now);

  const results = [];
  const seen = new Set();
  for (const [i, r] of rows.entries()) {
    const line = i + 2; // row 1 is the header
    try {
      const body = {
        name: r.task || r.name,
        doer: who(r.doer, "Doer", true),
        pc: who(r.pc, "PC"),
        auditor: who(r.auditor, "Auditor"),
        frequency: parseFrequency(r),
        start: parseDay(r.start) || today,
        end: parseDay(r.end),
        dueTime: parseTime(r.due_time),
        createBefore: r.create_before,
        onHoliday: parseHoliday(r.if_holiday),
        autoCloseDays: r.auto_close_days,
        priority: norm(r.priority) || "normal",
        how: r.how,
        fields: /^(y|yes|true|1)$/i.test(String(r.proof ?? "").trim()) ? [{ label: "Photo (proof)", type: "photo", required: true }] : [],
      };
      if (body.priority && !PRIORITIES.includes(body.priority)) throw fail(`Priority must be ${PRIORITIES.join(", ")}`);
      const c = cleanChecklist(body, { activeIds, today });
      const dupKey = norm(c.name) + "|" + c.doer;
      if (seen.has(dupKey)) throw fail("The same task for the same doer is already in this file");
      seen.add(dupKey);
      if (await Checklist.exists({ doer: c.doer, name: new RegExp(`^${escapeRe(c.name)}$`, "i") })) {
        throw fail("This doer already has a checklist with this name");
      }
      const groupName = text(r.group, 80);
      if (groupName) {
        let g = groups.get(norm(groupName));
        if (!g && !dryRun) {
          g = (await TaskGroup.create({ name: groupName }))._id;
          groups.set(norm(groupName), g);
        }
        c.group = g || null;
      }
      if (!dryRun) {
        const saved = await Checklist.create({ ...c, createdBy: user?._id });
        await generateChecklist(saved.toObject(), { now });
      }
      const doer = users.find((u) => String(u._id) === c.doer);
      results.push({ line, ok: true, name: c.name, doer: doer?.name, schedule: describe(c), group: groupName || "" });
    } catch (err) {
      results.push({ line, ok: false, name: r.task || r.name || "", error: err.message });
    }
  }
  return results;
}

module.exports = { cleanChecklist, describe, generateChecklist, sweepChecklists, afterChange, preview, importRows, peopleDirectory, parseDay, parseTime };
