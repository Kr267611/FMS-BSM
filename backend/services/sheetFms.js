// Google Sheet FMS -> FMS in the software: the entry columns become the entry form, every Planned / Actual block
// becomes a step (with its Status / Remarks columns as the step's fields, TAT and doer read from the header block),
// and the existing rows come in as entries with each step done / pending as in the sheet.
// The sheet is only read (read-only scope); it is never changed.
const Process = require("../models/Process");
const Job = require("../models/Job");
const Task = require("../models/Task");
const User = require("../models/User");
const { findSteps, colLetter } = require("./sheetInspect");
const { dayKey, parseSheetDate } = require("./dates");
const { normalizeProcess, slug } = require("./fms/definition");

const HEAD_ROWS = 15;
const SAMPLE = 400; // rows looked at to guess each column's type
const DELAY = /delay/i;
const REMARK = /remark/i;
const quote = (tab) => `'${String(tab).replace(/'/g, "''")}'`;
const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// "AYUSH SIR", "Paresh Bhai", "NIKUNJBHAI" -> the user named Ayush / Paresh / Nikunj
const HONORIFIC = /\b(sir|ji|bhai|ben|madam|mam|sahab|saheb|master)\b|(bhai|ji|sir)$/gi;
const personKey = (s) => text(s).toLowerCase().replace(HONORIFIC, "").replace(/[^a-z0-9]+/g, "");
function matchUser(hint, users) {
  const h = personKey(hint);
  if (h.length < 3) return null;
  const exact = users.find((u) => personKey(u.name) === h || personKey(u.username) === h);
  if (exact) return exact;
  const first = users.filter((u) => personKey(String(u.name).split(/\s+/)[0]) === h);
  return first.length === 1 ? first[0] : null;
}

// Who the sheet names for a step: "Accountable Person ( PRADEEP BHAI )", "Update to AYUSH SIR", or the name written under it
const NOT_PERSON = /\b(month|day|hour|within|remark|status|action|date|time)s?\b/i;
function doerHint(s) {
  const top = s.above[s.above.length - 1] || "";
  const inBrackets = top.match(/\(([^)]+)\)/)?.[1];
  const after = top.match(/\b(?:to|by)\s+([a-z .]+)$/i)?.[1];
  return [inBrackets, after, s.above[0]].map(text).find((h) => h && !NOT_PERSON.test(h) && h.length <= 40) || "";
}

// Guess a column's type from its values (formatted text + raw value)
function guessType(cells) {
  const vals = cells.filter((c) => text(c.f));
  if (!vals.length) return { type: "text", options: [] };
  const dates = vals.filter((c) => (typeof c.r === "number" && c.r > 20000 && c.r < 80000 && /[\/\-.]/.test(c.f)) || parseSheetDate(text(c.f)));
  if (dates.length >= vals.length * 0.8) {
    const withTime = dates.some((c) => /\d:\d\d/.test(c.f));
    return { type: withTime ? "datetime" : "date", options: [] };
  }
  if (vals.filter((c) => typeof c.r === "number").length >= vals.length * 0.9) return { type: "number", options: [] };
  const distinct = [...new Set(vals.map((c) => text(c.f)))];
  if (distinct.length <= 15 && vals.length >= distinct.length * 2 && distinct.every((d) => d.length <= 60)) return { type: "select", options: distinct };
  return { type: "text", options: [] };
}

// top: first rows (formatted). fmt / raw: the data rows below the header. Pure (covered by tests).
function planFms(top, fmt, raw) {
  const found = findSteps(top);
  if (!found.headerRow || !found.steps.length) throw fail("No Planned column was found in this tab, so its steps cannot be read");
  const header = (top[found.headerRow - 1] || []).map(text);
  const cells = (c) => fmt.slice(0, SAMPLE).map((row, i) => ({ f: row?.[c], r: raw[i]?.[c] }));
  const planned = found.steps.map((s) => colIndex(s.plannedCol));
  const firstPlanned = planned[0];

  // Entry form: the named columns on the left of the first step
  const seenKeys = new Set();
  const fields = [];
  for (let c = 0; c < firstPlanned; c++) {
    if (!header[c] || DELAY.test(header[c])) continue;
    let key = slug(header[c]);
    for (let n = 2; seenKeys.has(key); n++) key = `${slug(header[c])}_${n}`;
    seenKeys.add(key);
    fields.push({ key, label: header[c].slice(0, 80), col: colLetter(c), ...guessType(cells(c)) });
  }

  const steps = found.steps.map((s, k) => {
    const p = planned[k];
    const a = colIndex(s.actualCol);
    const end = k + 1 < planned.length ? planned[k + 1] : Math.min(header.length, p + 8);
    const stepFields = [];
    const keys = new Set();
    for (let c = p + 1; c < end; c++) {
      if (c === a || !header[c] || DELAY.test(header[c])) continue;
      if (k + 1 === planned.length && c > a + 3) break; // the last block: Status / Remarks right after Actual
      let key = slug(header[c]);
      for (let n = 2; keys.has(key); n++) key = `${slug(header[c])}_${n}`;
      keys.add(key);
      const g = guessType(cells(c));
      stepFields.push({ key, label: header[c].slice(0, 80), col: colLetter(c), ...(g.type === "datetime" ? { type: "date", options: [] } : g) });
    }
    // TAT: a number written above the block (header rows); the doer: the nearest name above it
    let tat = 1;
    for (let r = found.headerRow - 2; r >= 0; r--) {
      const n = (top[r] || []).slice(Math.max(k > 0 ? planned[k - 1] + 1 : 0, p - 2), end).map(text).find((v) => /^\d+(\.\d+)?$/.test(v));
      if (n !== undefined) {
        tat = Number(n);
        break;
      }
    }
    return { key: `s${k + 1}`, name: s.name.slice(0, 120), doerHint: doerHint(s), plannedCol: s.plannedCol, actualCol: s.actualCol, tat, fields: stepFields };
  });
  return { headerRow: found.headerRow, firstDataRow: found.headerRow + 1, fields, steps };
}

// A sheet row -> entry values (in the stored form) + whether the row has anything in it
function rowValues(fields, frow, rrow) {
  const data = {};
  for (const f of fields) {
    const c = colIndex(f.col);
    const t = text(frow?.[c]);
    if (!t) continue;
    if (f.type === "date" || f.type === "datetime") {
      const d = parseSheetDate(rrow?.[c]) || parseSheetDate(t);
      if (!d) continue;
      data[f.key] = f.type === "date" ? dayKey(d) : d.toISOString();
    } else if (f.type === "number") {
      data[f.key] = typeof rrow?.[c] === "number" ? rrow[c] : t.replace(/,/g, "");
    } else data[f.key] = t;
  }
  return data;
}

// One row's steps as in the sheet. A step with no Planned date: not started yet if the step before it is
// still open, otherwise the sheet's condition left it out (skipped, not scored).
function rowTasks(plan, frow, rrow) {
  const out = [];
  let prevOpen = false;
  for (const s of plan.steps) {
    const pc = colIndex(s.plannedCol);
    const ac = colIndex(s.actualCol);
    const plannedText = text(frow?.[pc]);
    const planned = parseSheetDate(rrow?.[pc]) || parseSheetDate(plannedText);
    const actual = parseSheetDate(rrow?.[ac]) || parseSheetDate(text(frow?.[ac]));
    const values = {};
    let remarks = "";
    for (const f of s.fields) {
      const v = text(frow?.[colIndex(f.col)]);
      if (!v) continue;
      values[f.key] = v;
      if (REMARK.test(f.label) && !remarks) remarks = v;
    }
    let status;
    if (/^(no\s*req|not\s*required|n\/?a)$/i.test(plannedText)) status = "na";
    else if (planned && actual) status = "done";
    else if (planned) status = "pending";
    else status = prevOpen ? "waiting" : "skipped";
    prevOpen = status === "pending" || status === "waiting";
    out.push({ step: s, status, planned, actual, values, remarks });
  }
  return out;
}

async function readTop(sheets, spreadsheetId, tab) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${quote(tab)}!A1:ZZ${HEAD_ROWS}`, valueRenderOption: "FORMATTED_VALUE" });
  return res.data.values || [];
}

async function readRows(sheets, spreadsheetId, tab, plan) {
  const lastCol = Math.max(...plan.steps.map((s) => Math.max(colIndex(s.actualCol), ...s.fields.map((f) => colIndex(f.col)))));
  const range = `${quote(tab)}!A${plan.firstDataRow}:${colLetter(lastCol)}`;
  const [f, r] = await Promise.all(
    ["FORMATTED_VALUE", "UNFORMATTED_VALUE"].map((valueRenderOption) =>
      sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption, dateTimeRenderOption: "SERIAL_NUMBER" })
    )
  );
  return { fmt: f.data.values || [], raw: r.data.values || [] };
}

// Rows that hold an entry (pre-made empty rows with only dropdowns are left out)
function entryRows(plan, fmt, raw) {
  const rows = [];
  fmt.forEach((frow, i) => {
    const data = rowValues(plan.fields, frow, raw[i]);
    if (Object.keys(data).length) rows.push({ sheetRow: plan.firstDataRow + i, data, frow, rrow: raw[i] });
  });
  return rows;
}

async function previewSheetFms(sheets, spreadsheetId, tab) {
  const top = await readTop(sheets, spreadsheetId, tab);
  const head = planFms(top, [], []);
  const { fmt, raw } = await readRows(sheets, spreadsheetId, tab, head);
  const plan = planFms(top, fmt, raw);
  const users = await User.find({ active: true }).select("name username").lean();
  for (const s of plan.steps) {
    const u = matchUser(s.doerHint, users);
    s.doer = u ? String(u._id) : "";
  }
  const rows = entryRows(plan, fmt, raw);
  const counts = { entries: rows.length, done: 0, pending: 0 };
  for (const r of rows) for (const t of rowTasks(plan, r.frow, r.rrow)) if (t.status in counts) counts[t.status]++;
  return { ...plan, counts, sample: rows.slice(-3).map((r) => ({ sheetRow: r.sheetRow, data: r.data })) };
}

// Make the FMS and bring in the rows. body: { name, pc, steps: { s1: { name, tat, doer } } }
async function importSheetFms(sheets, spreadsheetId, tab, body, user, { now = new Date() } = {}) {
  const top = await readTop(sheets, spreadsheetId, tab);
  const { fmt, raw } = await readRows(sheets, spreadsheetId, tab, planFms(top, [], []));
  const plan = planFms(top, fmt, raw);
  const over = body.steps || {}; // what the admin changed in the preview: { s1: { name, tat, doer } }
  const active = await User.find({ active: true }).select("_id").lean();
  const activeIds = new Set(active.map((u) => String(u._id)));

  const def = normalizeProcess(
    {
      name: body.name,
      description: `Imported from the Google Sheet tab "${tab}"`,
      pc: body.pc || undefined,
      active: true,
      fields: plan.fields.map(({ col, ...f }) => f),
      steps: plan.steps.map((s, i) => ({
        key: s.key,
        name: over[s.key]?.name || s.name,
        doer: { mode: "fixed", user: over[s.key]?.doer, hint: s.doerHint },
        start: i === 0 ? { mode: "entry" } : { mode: "afterDone", step: plan.steps[i - 1].key },
        tat: over[s.key]?.tat ?? s.tat,
        tatUnit: "days",
        fields: s.fields.map(({ col, ...f }) => f),
      })),
    },
    { activeIds }
  );
  if (await Process.exists({ name: def.name })) throw fail("An FMS with this name already exists");
  const source = { spreadsheetId, tabName: tab, firstDataRow: plan.firstDataRow, importedAt: now, map: { fields: plan.fields.map((f) => [f.key, f.col]), steps: plan.steps.map((s) => [s.key, s.plannedCol, s.actualCol, s.fields.map((f) => [f.key, f.col])]) } };
  const process = await Process.create({ ...def, source });

  const rows = entryRows(plan, fmt, raw);
  const dateField = plan.fields.find((f) => f.type === "date" || f.type === "datetime");
  const stepByKey = new Map(process.steps.map((s) => [s.key, s]));
  let jobNo = 0;
  const counts = { entries: 0, done: 0, pending: 0, waiting: 0, skipped: 0, na: 0 };
  for (let i = 0; i < rows.length; i += 500) {
    const jobs = [];
    const tasks = [];
    for (const r of rows.slice(i, i + 500)) {
      const steps = rowTasks(plan, r.frow, r.rrow);
      const start = (dateField && r.data[dateField.key] && new Date(dateField.type === "date" ? `${r.data[dateField.key]}T00:00:00+05:30` : r.data[dateField.key])) || steps.find((t) => t.planned)?.planned || now;
      const open = steps.some((t) => t.status === "pending" || t.status === "waiting");
      const job = new Job({ process: process._id, jobNo: String(++jobNo), startDate: start, data: r.data, createdBy: user?._id, status: open ? "open" : "closed", sheetRow: r.sheetRow, searchText: Object.values(r.data).join(" ").toLowerCase().slice(0, 2000) });
      jobs.push(job);
      counts.entries++;
      steps.forEach((t, k) => {
        const step = stepByKey.get(t.step.key);
        counts[t.status]++;
        tasks.push({
          kind: "app",
          label: `${process.name} – ${step.name}`,
          process: process._id,
          job: job._id,
          stepIndex: k,
          stepKey: step.key,
          stepName: step.name,
          status: t.status,
          doer: t.status === "waiting" || t.status === "skipped" ? undefined : step.doer?.user || process.pc || user?._id,
          planned: t.planned || undefined,
          plannedDay: t.planned ? dayKey(t.planned) : undefined,
          activatedAt: t.planned || undefined,
          actual: t.status === "done" ? t.actual : undefined,
          actualDay: t.status === "done" ? dayKey(t.actual) : undefined,
          resolvedAt: t.status === "done" ? t.actual : t.status === "skipped" || t.status === "na" ? now : undefined,
          skipReason: t.status === "skipped" ? "condition" : undefined,
          tat: t.planned ? step.tat : undefined,
          tatUnit: t.planned ? step.tatUnit : undefined,
          values: Object.keys(t.values).length ? t.values : undefined,
          remarks: t.remarks,
        });
      });
    }
    await Job.insertMany(jobs);
    await Task.insertMany(tasks);
  }
  await Process.updateOne({ _id: process._id }, { jobCounter: jobNo });
  return { process: { _id: process._id, name: process.name }, counts };
}

module.exports = { planFms, rowTasks, rowValues, entryRows, matchUser, guessType, previewSheetFms, importSheetFms };
