// Google Sheet FMS -> FMS in the software: the entry columns become the entry form, every Planned / Actual block
// becomes a step (with its Status / Remarks columns as the step's fields, TAT and doer read from the header block),
// and the existing rows come in as entries with each step done / pending as in the sheet.
// The sheet is only read (read-only scope); it is never changed.
import Process = require("../models/Process");
import Job = require("../models/Job");
import Task = require("../models/Task");
import User = require("../models/User");
import sheetInspectLib = require("./sheetInspect");
const { findSteps, colLetter } = sheetInspectLib;
import datesLib = require("./dates");
const { dayKey, parseSheetDate } = datesLib;
import definitionLib = require("./fms/definition");
const { normalizeProcess, slug } = definitionLib;
import engine = require("./fms/engine");
import doersLib = require("./fms/doers");
const { resolveDoer, directory } = doersLib;
import workflowLib = require("./workflow");
const { loadCalendar } = workflowLib;
import F = require("./sheetFormula");
import D = require("./sheetDoers");

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
const whole = (s) => text(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const deptOf = (u) => (u.department && typeof u.department === "object" ? u.department.name : u.department) || "";
const nameWords = (s) => text(s).split(/\s+/).map(personKey).filter((w) => w.length >= 2);

// The users a name in the sheet may mean, best match first:
//   "Jyoti" -> the user named Jyoti / Jyoti Sharma (every Jyoti, when there are two)
//   "Mahesh (Excise)" -> the Mahesh of the Excise department when there are two Maheshes
//   "Vinod Patel" -> "Vinod Ramprasad Patel" (every word of the sheet's name is in the user's name)
//   "AVINASH MASTER" -> the user whose department is AVINASH MASTER
//   "Mukesh / Vinod" -> two people: the users of both names (one of them is chosen)
function userCandidates(hint, users) {
  const full = text(hint);
  if (/[\/,&]| or /i.test(full)) {
    const parts = full.split(/[\/,&]| or /i).map(text).filter(Boolean);
    if (parts.length > 1) return [...new Set<any>(parts.flatMap((p) => userCandidates(p, users)))];
  }
  const bracket = full.match(/\(([^)]+)\)\s*$/)?.[1] || "";
  const name = bracket ? full.slice(0, full.lastIndexOf("(")).trim() : full;
  const h = personKey(name);
  if (h.length < 3) return [];
  // two users of the same name: the department in brackets tells them apart
  const narrow = (list) => {
    if (list.length < 2 || !bracket) return list;
    const d = list.filter((u) => whole(deptOf(u)).includes(whole(bracket)) || whole(bracket).includes(whole(deptOf(u)) || "\0"));
    return d.length ? d : list;
  };
  const exact = users.filter((u) => personKey(u.name) === h || personKey(u.username) === h);
  if (exact.length) return narrow(exact);
  // "AVINASH MASTER" in the sheet, a user whose department is "AVINASH MASTER"
  const dept = users.filter((u) => whole(deptOf(u)) && whole(deptOf(u)) === whole(full));
  if (dept.length) return dept;
  const first = users.filter((u) => personKey(String(u.name).split(/\s+/)[0]) === h);
  if (first.length) return narrow(first);
  // "Vinod Patel" in the sheet, "Vinod Ramprasad Patel" in the software
  const words = nameWords(name);
  if (words.length > 1) {
    const all = users.filter((u) => {
      const uw = nameWords(u.name);
      return words.every((w) => uw.includes(w));
    });
    if (all.length) return narrow(all);
  }
  // "Vinod Patel" in the sheet, "Vinod" in the software: the sheet's first name
  const hintFirst = personKey(name.split(/\s+/)[0]);
  if (hintFirst.length < 3 || hintFirst === h) return [];
  return narrow(users.filter((u) => personKey(u.name) === hintFirst || personKey(String(u.name).split(/\s+/)[0]) === hintFirst));
}

// The one user a name in the sheet means, or null when none or more than one fit
function matchUser(hint, users) {
  const c = userCandidates(hint, users);
  return c.length === 1 ? c[0] : null;
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
  const distinct = [...new Set<any>(vals.map((c) => text(c.f)))];
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
  const seenKeys = new Set<any>();
  const fields = [];
  for (let c = 0; c < firstPlanned; c++) {
    if (!header[c] || DELAY.test(header[c])) continue;
    let key = slug(header[c]);
    for (let n = 2; seenKeys.has(key); n++) key = `${slug(header[c])}_${n}`;
    seenKeys.add(key);
    const g = guessType(cells(c));
    // a dropdown lists every value of the column, not only those of the first rows looked at
    if (g.type === "select" && fmt.length > SAMPLE) {
      const all = [...new Set<any>(fmt.map((r) => text(r?.[c])).filter(Boolean))];
      if (all.length <= 40) g.options = all;
      else Object.assign(g, { type: "text", options: [] });
    }
    fields.push({ key, label: header[c].slice(0, 80), col: colLetter(c), ...g });
  }
  // a name column's dropdown lists names only ("4" pasted in Master Name is not a choice)
  for (const f of D.personFields(fields)) {
    if (f.type !== "select") continue;
    f.options = f.options.filter((o) => !D.notAName(o));
    if (!f.options.length) f.type = "text";
  }

  const steps = found.steps.map((s, k) => {
    const p = planned[k];
    const a = colIndex(s.actualCol);
    const end = k + 1 < planned.length ? planned[k + 1] : Math.min(header.length, p + 8);
    const stepFields = [];
    const keys = new Set<any>();
    for (let c = p + 1; c < end; c++) {
      if (c === a || !header[c] || DELAY.test(header[c])) continue;
      if (k + 1 === planned.length && c > a + 3) break; // the last block: Status / Remarks right after Actual
      let key = slug(header[c]);
      for (let n = 2; keys.has(key); n++) key = `${slug(header[c])}_${n}`;
      keys.add(key);
      const g = guessType(cells(c));
      stepFields.push({ key, label: header[c].slice(0, 80), col: colLetter(c), ...(g.type === "datetime" ? { type: "date", options: [] } : g) });
    }
    // TAT: the block's When / TAT row when the sheet labels it, else a number written above the block;
    // the doer: the block's Who, else the nearest name above it
    let tat = 1;
    if (s.when !== undefined && /^\d+(\.\d+)?$/.test(s.when)) tat = Number(s.when);
    else if (s.when === undefined) {
      for (let r = found.headerRow - 2; r >= 0; r--) {
        const n = (top[r] || []).slice(Math.max(k > 0 ? planned[k - 1] + 1 : 0, p - 2), end).map(text).find((v) => /^\d+(\.\d+)?$/.test(v));
        if (n !== undefined) {
          tat = Number(n);
          break;
        }
      }
    }
    return {
      key: `s${k + 1}`,
      name: s.name.slice(0, 120),
      doerHint: s.who ? s.who.slice(0, 80) : doerHint(s),
      how: s.how ? s.how.slice(0, 2000) : "",
      when: s.when || "",
      plannedCol: s.plannedCol,
      actualCol: s.actualCol,
      tat,
      fields: stepFields,
    };
  });
  return { headerRow: found.headerRow, firstDataRow: found.headerRow + 1, fields, steps };
}

// The sheet's formulas -> each step's rule (how it starts, its condition, what its planned date counts from),
// the auto-calculated entry fields and the "Status by PC" column that closes an entry. Pure (covered by tests).
//   topF : the header rows as formulas (to find the =TODAY() cell)   rowsF: the data rows as formulas
//   ext  : other tabs the step formulas read, as text rows ({ Rules: [[…], …] }) – e.g. the Rules tab of a
//          "Next Stage" column, or Rules!$G$2 holding the days of an escalation
function applyFormulas(plan, top, topF, rowsF, ext: Record<string, any[]> = {}) {
  const cols: Record<string, any> = {};
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
    isToday: (col, row) => /^=\s*(TODAY|NOW)\(\s*\)\s*$/i.test(String(cell(topF, col, row) ?? "")),
    ext: (tab, col, row) => {
      const v = text(ext[tab]?.[row - 1]?.[colIndex(col)]);
      return v !== "" && isFinite(Number(v)) ? Number(v) : v;
    },
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

  // "Next Stage" columns: a step's Status looked up in a Rules tab ("S2|GR" -> 3). The column is worked out from the
  // Status, so the doer does not fill it; the Status dropdown gets every status the Rules tab knows for that step.
  for (const s of plan.steps) {
    const routes = [];
    for (const sf of s.fields) {
      const r = F.routeOf(parsed(common(sf.col)));
      const rows = r && ext[r.tab];
      if (!rows) continue;
      const input = s.fields.find((f) => f.col === r.inputCol);
      const map = [];
      for (const row of rows) {
        const key = text(row?.[colIndex(r.keyCol)]);
        if (!key || !key.toUpperCase().startsWith(r.prefix.toUpperCase())) continue;
        const status = key.slice(r.prefix.length).trim();
        if (status) map.push({ status, to: text(row?.[colIndex(r.valueCol)]) });
      }
      if (!input || !map.length) continue;
      cols[sf.col] = { kind: "route", step: s.key, statusKey: input.key, map };
      const options = [...map.map((m) => m.status), ...(input.options || [])].filter((o, i, all) => all.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === i);
      Object.assign(input, { type: "select", options: options.slice(0, 500) });
      routes.push({ col: sf.col, label: sf.label, tab: r.tab, map });
    }
    if (routes.length) {
      s.fields = s.fields.filter((f) => !routes.some((r) => r.col === f.col));
      s.routes = routes;
    }
  }

  // An entry column worked out only from the steps (e.g. "Final Status": "S2 pending - Master", "CLOSED at S2 - …")
  // is not part of the entry form: the software shows each step's state itself
  const stepKinds = ["planned", "actual", "stepField", "route"];
  const readsSteps = (ast) => {
    let hit = false;
    (function visit(n) {
      if (hit || !n || typeof n !== "object") return;
      if (n.k === "ref" && !n.sheet && !n.rowAbs && stepKinds.includes(cols[n.col]?.kind)) hit = true;
      for (const v of Object.values<any>(n)) if (v && typeof v === "object") visit(v);
    })(ast);
    return hit;
  };
  const fromSteps = [];
  for (const f of plan.fields) {
    const pattern = common(f.col);
    if (!pattern) continue;
    const ast = parsed(pattern);
    if (ast && f !== dateField && readsSteps(ast)) {
      fromSteps.push(f);
      continue;
    }
    const formula = F.fieldFormula(ast, ctx);
    if (formula) f.formula = formula;
    else f.sheetFormula = show(pattern);
  }
  if (fromSteps.length) {
    plan.fields = plan.fields.filter((f) => !fromSteps.includes(f));
    plan.fromSteps = fromSteps.map((f) => ({ col: f.col, label: f.label }));
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
  const data: Record<string, any> = {};
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
function rowTasks(plan, frow, rrow, { closed = false }: any = {}) {
  const out = [];
  let prevOpen = false;
  const ruled = plan.steps.some((s) => s.rule);
  for (const s of plan.steps) {
    const pc = colIndex(s.plannedCol);
    const ac = colIndex(s.actualCol);
    const plannedText = text(frow?.[pc]);
    const planned = parseSheetDate(rrow?.[pc]) || parseSheetDate(plannedText);
    const actual = parseSheetDate(rrow?.[ac]) || parseSheetDate(text(frow?.[ac]));
    const values: Record<string, any> = {};
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
  // the other tabs that the steps' formulas read (a Rules tab), only read
  const stepCols = head.steps.flatMap((s) => [s.plannedCol, ...s.fields.map((f) => f.col)]);
  const tabs = [...new Set<string>(stepCols.flatMap((c) => F.tabsIn(F.commonFormula(rowsF.map((r) => r?.[colIndex(c)]), head.firstDataRow))))].filter((t) => t !== tab).slice(0, 5);
  const ext: Record<string, any[]> = {};
  if (tabs.length) {
    const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabs.map((t) => `${quote(t)}!A1:Z1000`), valueRenderOption: "FORMATTED_VALUE" });
    (res.data.valueRanges || []).forEach((v, i) => (ext[tabs[i]] = v.values || []));
  }
  const plan = applyFormulas(planFms(top, fmt, raw), top, topF, rowsF, ext);
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
function definition(plan, tab, body: any = {}, ctx: any = {}) {
  const over = body.steps || {};
  return {
    name: body.name,
    description: `Imported from the Google Sheet tab "${tab}"`,
    pc: body.pc || undefined,
    active: true,
    calendar: { mode: plan.calendar || "working" },
    closure: plan.closure ? { enabled: true, label: plan.closure.label, options: plan.closure.options } : { enabled: true },
    fields: plan.fields.map(({ col, sheetFormula, ...f }: any) => ({ ...f, help: sheetFormula ? `In the sheet: ${sheetFormula}`.slice(0, 300) : f.help })),
    steps: plan.steps.map((s, i) => ({
      key: s.key,
      name: over[s.key]?.name || s.name,
      how: s.how || "",
      // a step may bring its own table (Master Name -> Mukesh / Vinod), else the names table of the whole sheet
      doer: D.doerRule(over[s.key]?.source || s.source, { fallback: over[s.key]?.doer, hint: s.doerHint, people: over[s.key]?.people || body.people, rows: ctx.rows, lookups: ctx.lookups }),
      ...(s.rule || { start: i === 0 ? { mode: "entry" } : { mode: "afterDone", step: plan.steps[i - 1].key } }),
      tat: over[s.key]?.tat ?? s.tat,
      tatUnit: "days",
      fields: s.fields.map(({ col, ...f }: any) => f),
    })),
  };
}

// Each row's steps as the sheet has them, then moved on by the engine at `now` (what starts, what waits, what is not needed)
function settleRows({ process, rows, plan, now, calendar, doerOf = () => null, fallbackDoer = null }: any) {
  const counts = { entries: rows.length, done: 0, pending: 0, waiting: 0, skipped: 0, na: 0 };
  const dateField = process.fields.find((f) => f.type === "date" || f.type === "datetime");
  const out = rows.map((r) => {
    const sheetSteps = rowTasks(plan, r.frow, r.rrow, { closed: Boolean(r.closeStatus) });
    const startDate =
      (dateField && r.data[dateField.key] && new Date(dateField.type === "date" ? `${r.data[dateField.key]}T00:00:00+05:30` : r.data[dateField.key])) ||
      sheetSteps.find((t) => t.planned)?.planned ||
      now;
    const data = engine.computeFields(process.fields, r.data, startDate);
    const tasks: Record<string, any> = {};
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
    for (const t of Object.values<any>(tasks)) counts[t.status]++;
    return { row: r, job, tasks, open: !engine.allResolved(tasks) };
  });
  return { counts, rows: out };
}

// The doer tabs of the sheet (e.g. MACHINE WISE DOER), read only when a step needs them
async function doerTabs(sheets, spreadsheetId, tab, plan, wanted?) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const tabs = (meta.data.sheets || []).map((s) => s.properties.title).filter((t) => !wanted || wanted.includes(t));
  return D.findLookups(sheets, spreadsheetId, tabs, tab, plan.fields);
}

async function previewSheetFms(sheets, spreadsheetId, tab, { now = new Date() }: any = {}) {
  const { plan, fmt, raw } = await loadTab(sheets, spreadsheetId, tab);
  const users = await User.find({ active: true }).select("name username department").populate("department", "name").lean<any>();
  const rows = entryRows(plan, fmt, raw);
  const lookups = await doerTabs(sheets, spreadsheetId, tab, plan);
  const persons = D.personFields(plan.fields);
  const sources = D.suggestSources(plan.steps, persons, lookups);
  plan.steps.forEach((s, i) => {
    // the step's Who: the one user it names becomes the doer; when it fits several (two Jyotis, "Mukesh / Vinod"),
    // the page shows them to pick from
    const found = userCandidates(s.doerHint, users);
    s.doer = found.length === 1 ? String(found[0]._id) : "";
    s.doerCandidates = found.length > 1 ? found.slice(0, 8).map((u) => ({ _id: String(u._id), name: u.name, department: deptOf(u) })) : [];
    s.source = sources[i];
  });

  // Where a doer can come from, and every name the sheet uses there, matched to a user where possible
  const people: Record<string, any> = {};
  const named = (count) => [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ((people[name] ??= String(matchUser(name, users)?._id || "")), [name, n]));
  const doerSources = {
    fields: persons.map((f) => ({
      key: f.key,
      label: f.label,
      col: f.col,
      names: named(D.namesOf({ type: "field", field: f.key }, rows, lookups)),
      notNames: [...D.notNamesOf({ type: "field", field: f.key }, rows).entries()],
    })),
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
async function importSheetFms(sheets, spreadsheetId, tab, body, user, { now = new Date() }: any = {}) {
  const { plan, fmt, raw } = await loadTab(sheets, spreadsheetId, tab);
  const active = await User.find({ active: true }).select("_id name active").lean<any>();
  const entries = entryRows(plan, fmt, raw);
  const wanted = Object.values<any>(body.steps || {}).filter((s) => s?.source?.type === "lookup").map((s) => s.source.tab);
  const lookups = wanted.length ? await doerTabs(sheets, spreadsheetId, tab, plan, wanted) : [];
  const def = normalizeProcess(definition(plan, tab, body, { rows: entries, lookups }), { activeIds: new Set<any>(active.map((u) => String(u._id))) });
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
  const stepIndex = new Map<any, any>(process.steps.map((s, i) => [s.key, i]));
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
        searchText: Object.values<any>(r.job.data).join(" ").toLowerCase().slice(0, 2000),
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

export = { planFms, applyFormulas, rowTasks, rowValues, entryRows, definition, settleRows, matchUser, userCandidates, personKey, guessType, previewSheetFms, importSheetFms };
