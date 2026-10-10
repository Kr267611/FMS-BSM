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
const engine = require("./fms/engine");
const { resolveDoer, directory } = require("./fms/doers");
const { loadCalendar } = require("./workflow");
const F = require("./sheetFormula");
const D = require("./sheetDoers");

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

// The sheet's formulas -> each step's rule (how it starts, its condition, what its planned date counts from),
// the auto-calculated entry fields and the "Status by PC" column that closes an entry. Pure (covered by tests).
//   topF : the header rows as formulas (to find the =TODAY() cell)   rowsF: the data rows as formulas
function applyFormulas(plan, top, topF, rowsF) {
  const cols = {};
  const dateField = plan.fields.find((f) => f.type === "date" || f.type === "datetime");
  for (const f of plan.fields) cols[f.col] = { kind: f === dateField ? "entryDate" : "field", key: f.key, date: f.type === "date" || f.type === "datetime" };
  for (const s of plan.steps) {
    cols[s.plannedCol] = { kind: "planned", step: s.key };
    cols[s.actualCol] = { kind: "actual", step: s.key };
    for (const sf of s.fields) cols[sf.col] = { kind: "stepField", step: s.key, key: sf.key };
  }
  const cell = (rows, col, row) => rows[row - 1]?.[colIndex(col)];
  const ctx = {
    cols,
    dataRow: F.ROW,
    head: (col, row) => {
      const v = text(cell(top, col, row));
      return v !== "" && isFinite(Number(v)) ? Number(v) : v;
    },
    isToday: (col, row) => /^=\s*TODAY\(\s*\)\s*$/i.test(String(cell(topF, col, row) ?? "")),
  };
  const common = (col) => F.commonFormula(rowsF.map((r) => r?.[colIndex(col)]), plan.firstDataRow);
  const parsed = (pattern) => {
    try {
      return pattern ? F.parseCommon(pattern) : null;
    } catch {
      return null;
    }
  };
  const show = (pattern) => pattern && pattern.replace(/\{r\}/g, String(plan.firstDataRow));

  // "Status by PC": the entry column the Actual formulas watch
  let closureCol = null;
  for (const s of plan.steps) closureCol ||= F.closureColumn(parsed(common(s.actualCol)), ctx);
  if (closureCol) {
    const f = plan.fields.find((x) => x.col === closureCol);
    if (f) {
      plan.closure = { key: f.key, col: f.col, label: f.label.slice(0, 60), options: f.options.length ? f.options : ["Closed"] };
      plan.fields = plan.fields.filter((x) => x !== f);
      cols[closureCol].kind = "closure";
    }
  }

  for (const f of plan.fields) {
    const pattern = common(f.col);
    if (!pattern) continue;
    const formula = F.fieldFormula(parsed(pattern), ctx);
    if (formula) f.formula = formula;
    else f.sheetFormula = show(pattern);
  }

  let working = 0;
  for (const s of plan.steps) {
    const pattern = common(s.plannedCol);
    s.formula = show(pattern);
    const ast = parsed(pattern);
    const r = ast ? F.translate(ast, ctx) : { ok: false, notes: [pattern ? "The planned formula could not be read" : "No planned formula in this column"] };
    if (r.ok) {
      s.rule = { start: r.start, plan: r.plan, ...(r.when ? { when: r.when } : {}) };
      if (typeof r.tat === "number") s.tat = r.tat;
      if (r.working) working++;
    }
    s.ruleNotes = r.notes;
  }
  plan.calendar = working > plan.steps.length / 2 ? "working" : "calendar";
  return plan;
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

// One row's steps as in the sheet. A step with no Planned date is "waiting": the software's engine then decides,
// with the step's rule, whether it starts now, later, or is not needed. On a closed entry it is not needed.
function rowTasks(plan, frow, rrow, { closed = false } = {}) {
  const out = [];
  let prevOpen = false;
  const ruled = plan.steps.some((s) => s.rule);
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
    else if (closed) status = "skipped";
    else status = ruled || prevOpen ? "waiting" : "skipped";
    prevOpen = status === "pending" || status === "waiting";
    out.push({ step: s, status, planned, actual, values, remarks });
  }
  return out;
}

const get = (sheets, spreadsheetId, range, valueRenderOption) =>
  sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption, dateTimeRenderOption: "SERIAL_NUMBER" }).then((r) => r.data.values || []);

// Everything about one tab: the header block, the data rows (text, raw values, formulas) and the plan
async function loadTab(sheets, spreadsheetId, tab) {
  const headRange = `${quote(tab)}!A1:ZZ${HEAD_ROWS}`;
  const [top, topF] = await Promise.all([get(sheets, spreadsheetId, headRange, "FORMATTED_VALUE"), get(sheets, spreadsheetId, headRange, "FORMULA")]);
  const head = planFms(top, [], []);
  const lastCol = Math.max(...head.steps.map((s) => Math.max(colIndex(s.actualCol), ...s.fields.map((f) => colIndex(f.col)))));
  const range = `${quote(tab)}!A${head.firstDataRow}:${colLetter(lastCol)}`;
  const [fmt, raw, rowsF] = await Promise.all(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"].map((o) => get(sheets, spreadsheetId, range, o)));
  const plan = applyFormulas(planFms(top, fmt, raw), top, topF, rowsF);
  return { plan, fmt, raw };
}

// Rows that hold an entry. Pre-made empty rows are left out: dropdowns only, or only formula columns
// (e.g. Days in Diff showing 0 on a row nobody filled)
function entryRows(plan, fmt, raw) {
  const typed = plan.fields.filter((f) => !f.formula && !f.sheetFormula);
  const rows = [];
  fmt.forEach((frow, i) => {
    const data = rowValues(plan.fields, frow, raw[i]);
    if (!typed.some((f) => data[f.key] !== undefined)) return;
    const closeStatus = plan.closure ? text(frow?.[colIndex(plan.closure.col)]) : "";
    rows.push({ sheetRow: plan.firstDataRow + i, data, closeStatus, frow, rrow: raw[i] });
  });
  return rows;
}

// The FMS definition the software saves, from the plan and what the admin changed in the preview
// ctx: { rows, lookups } – the entries and the doer tabs, for doers that come from the sheet (Hissa 2)
function definition(plan, tab, body = {}, ctx = {}) {
  const over = body.steps || {};
  return {
    name: body.name,
    description: `Imported from the Google Sheet tab "${tab}"`,
    pc: body.pc || undefined,
    active: true,
    calendar: { mode: plan.calendar || "working" },
    closure: plan.closure ? { enabled: true, label: plan.closure.label, options: plan.closure.options } : { enabled: true },
    fields: plan.fields.map(({ col, sheetFormula, ...f }) => ({ ...f, help: sheetFormula ? `In the sheet: ${sheetFormula}`.slice(0, 300) : f.help })),
    steps: plan.steps.map((s, i) => ({
      key: s.key,
      name: over[s.key]?.name || s.name,
      doer: D.doerRule(over[s.key]?.source || s.source, { fallback: over[s.key]?.doer, hint: s.doerHint, people: body.people, rows: ctx.rows, lookups: ctx.lookups }),
      ...(s.rule || { start: i === 0 ? { mode: "entry" } : { mode: "afterDone", step: plan.steps[i - 1].key } }),
      tat: over[s.key]?.tat ?? s.tat,
      tatUnit: "days",
      fields: s.fields.map(({ col, ...f }) => f),
    })),
  };
}

// Each row's steps as the sheet has them, then moved on by the engine at `now` (what starts, what waits, what is not needed)
function settleRows({ process, rows, plan, now, calendar, doerOf = () => null, fallbackDoer = null }) {
  const counts = { entries: rows.length, done: 0, pending: 0, waiting: 0, skipped: 0, na: 0 };
  const dateField = process.fields.find((f) => f.type === "date" || f.type === "datetime");
  const out = rows.map((r) => {
    const sheetSteps = rowTasks(plan, r.frow, r.rrow, { closed: Boolean(r.closeStatus) });
    const startDate =
      (dateField && r.data[dateField.key] && new Date(dateField.type === "date" ? `${r.data[dateField.key]}T00:00:00+05:30` : r.data[dateField.key])) ||
      sheetSteps.find((t) => t.planned)?.planned ||
      now;
    const data = engine.computeFields(process.fields, r.data, startDate);
    const tasks = {};
    for (const t of sheetSteps) {
      const done = t.status === "done";
      tasks[t.step.key] = {
        status: t.status,
        planned: t.planned || undefined,
        plannedDay: t.planned ? dayKey(t.planned) : undefined,
        activatedAt: t.planned || undefined,
        actual: done ? t.actual : undefined,
        actualDay: done ? dayKey(t.actual) : undefined,
        resolvedAt: done ? t.actual : t.status === "skipped" || t.status === "na" ? now : undefined,
        skipReason: t.status === "skipped" ? (r.closeStatus ? "closed" : "condition") : undefined,
        values: Object.keys(t.values).length ? t.values : undefined,
        remarks: t.remarks,
      };
    }
    const job = { startDate, data, closeStatus: r.closeStatus || undefined };
    if (!r.closeStatus) engine.advance({ process, job, tasks, now, calendar, doerOf, fallbackDoer });
    for (const t of Object.values(tasks)) counts[t.status]++;
    return { row: r, job, tasks, open: !engine.allResolved(tasks) };
  });
  return { counts, rows: out };
}

// The doer tabs of the sheet (e.g. MACHINE WISE DOER), read only when a step needs them
async function doerTabs(sheets, spreadsheetId, tab, plan, wanted) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const tabs = (meta.data.sheets || []).map((s) => s.properties.title).filter((t) => !wanted || wanted.includes(t));
  return D.findLookups(sheets, spreadsheetId, tabs, tab, plan.fields);
}

async function previewSheetFms(sheets, spreadsheetId, tab, { now = new Date() } = {}) {
  const { plan, fmt, raw } = await loadTab(sheets, spreadsheetId, tab);
  const users = await User.find({ active: true }).select("name username").lean();
  const rows = entryRows(plan, fmt, raw);
  const lookups = await doerTabs(sheets, spreadsheetId, tab, plan);
  const persons = D.personFields(plan.fields);
  const sources = D.suggestSources(plan.steps, persons, lookups);
  plan.steps.forEach((s, i) => {
    const u = matchUser(s.doerHint, users);
    s.doer = u ? String(u._id) : "";
    s.source = sources[i];
  });

  // Where a doer can come from, and every name the sheet uses there, matched to a user where possible
  const people = {};
  const named = (count) => [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ((people[name] ??= String(matchUser(name, users)?._id || "")), [name, n]));
  const doerSources = {
    fields: persons.map((f) => ({ key: f.key, label: f.label, col: f.col, names: named(D.namesOf({ type: "field", field: f.key }, rows, lookups)) })),
    lookups: lookups.map((l) => ({
      tab: l.tab,
      field: l.field,
      fieldLabel: plan.fields.find((f) => f.key === l.field)?.label,
      keyHeader: l.keyHeader,
      doerHeader: l.doerHeader,
      rows: l.rows.length,
      names: named(D.namesOf({ type: "lookup", tab: l.tab }, rows, lookups)),
    })),
  };

  const def = normalizeProcess({ ...definition(plan, tab, { name: tab }, { rows, lookups }), active: false });
  const { counts } = settleRows({ process: def, rows, plan, now, calendar: await loadCalendar() });
  return { ...plan, counts, closedEntries: rows.filter((r) => r.closeStatus).length, doerSources, people };
}

// Make the FMS and bring in the rows.
// body: { name, pc, steps: { s1: { name, tat, doer, source: { type: "fixed" | "field" | "lookup", field, tab } } }, people: { "SB PATIL": userId } }
async function importSheetFms(sheets, spreadsheetId, tab, body, user, { now = new Date() } = {}) {
  const { plan, fmt, raw } = await loadTab(sheets, spreadsheetId, tab);
  const active = await User.find({ active: true }).select("_id name active").lean();
  const entries = entryRows(plan, fmt, raw);
  const wanted = Object.values(body.steps || {}).filter((s) => s?.source?.type === "lookup").map((s) => s.source.tab);
  const lookups = wanted.length ? await doerTabs(sheets, spreadsheetId, tab, plan, wanted) : [];
  const def = normalizeProcess(definition(plan, tab, body, { rows: entries, lookups }), { activeIds: new Set(active.map((u) => String(u._id))) });
  if (await Process.exists({ name: def.name })) throw fail("An FMS with this name already exists");
  const source = {
    spreadsheetId,
    tabName: tab,
    firstDataRow: plan.firstDataRow,
    importedAt: now,
    closure: plan.closure?.col,
    fields: plan.fields.map((f) => [f.key, f.col]),
    steps: plan.steps.map((s) => ({ key: s.key, planned: s.plannedCol, actual: s.actualCol, formula: s.formula, fields: s.fields.map((f) => [f.key, f.col]) })),
  };
  const process = (await Process.create({ ...def, source })).toObject();

  const dir = directory(active);
  const doerOf = (step, data) => resolveDoer(step.doer, data, dir);
  const { counts, rows } = settleRows({
    process,
    rows: entries,
    plan,
    now,
    calendar: await loadCalendar(),
    doerOf,
    fallbackDoer: process.pc || user?._id,
  });
  const stepIndex = new Map(process.steps.map((s, i) => [s.key, i]));
  let jobNo = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const jobs = [];
    const tasks = [];
    for (const r of rows.slice(i, i + 500)) {
      const job = new Job({
        process: process._id,
        jobNo: String(++jobNo),
        startDate: r.job.startDate,
        data: r.job.data,
        createdBy: user?._id,
        status: r.open ? "open" : "closed",
        ...(r.job.closeStatus ? { closeStatus: r.job.closeStatus, closedAt: now, closedBy: user?._id } : {}),
        sheetRow: r.row.sheetRow,
        searchText: Object.values(r.job.data).join(" ").toLowerCase().slice(0, 2000),
      });
      jobs.push(job);
      for (const step of process.steps) {
        const t = r.tasks[step.key];
        const started = t.status === "pending" || t.status === "done";
        tasks.push({
          kind: "app",
          label: `${process.name} – ${step.name}`,
          process: process._id,
          job: job._id,
          stepIndex: stepIndex.get(step.key),
          stepKey: step.key,
          stepName: step.name,
          ...t,
          // a step started in the sheet: its doer by the step's rule (e.g. the person in column H), else the PC / admin
          doer: t.doer || (started ? doerOf(step, r.job.data) || process.pc || user?._id : undefined),
          tat: t.tat ?? (t.planned ? step.tat : undefined),
          tatUnit: t.tatUnit ?? (t.planned ? step.tatUnit : undefined),
        });
      }
    }
    await Job.insertMany(jobs);
    await Task.insertMany(tasks);
  }
  await Process.updateOne({ _id: process._id }, { jobCounter: jobNo });
  return { process: { _id: process._id, name: process.name }, counts };
}

module.exports = { planFms, applyFormulas, rowTasks, rowValues, entryRows, definition, settleRows, matchUser, guessType, previewSheetFms, importSheetFms };
