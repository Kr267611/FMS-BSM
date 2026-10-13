// Sheet Sync of an FMS imported from a Google Sheet.
//   App → Sheet (push): when a step is Done / Not Required in the app, the step's columns of that entry's row
//                       (Actual, Status, Remarks, …) are filled in the sheet.
//   Sheet → App (pull): a step someone finished in the sheet is finished in the app too.
// Switched per FMS, per step ("FMS setting" / "App only" / "App + Sheet") and per column. Off by default.
// Safety, always: never a cell with a formula, never a cell that already has something (the sheet wins),
// never a row that no longer matches the entry (rows moved), read back after writing, every write recorded.
// The pure parts (defaults, cleaning, what to write, row check) are covered by tests.
import Process = require("../models/Process");
import Job = require("../models/Job");
import Task = require("../models/Task");
import datesLib = require("./dates");
const { parseSheetDate, isRealDay } = datesLib;
import sheetFmsLib = require("./sheetFms");
const { rowValues } = sheetFmsLib;
import sheetSyncLib = require("./sheetSync");

const MODES = ["inherit", "app", "sheet"];
const COL = /^[A-Z]{1,3}$/;
const DAY = 86400000;
const NOT_REQUIRED = /^(no\s*req(uired)?|not\s*required|n\/?a)$/i;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const colIndex = (letters) => [...String(letters)].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
function colLetter(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const quote = (tab) => `'${String(tab).replace(/'/g, "''")}'`;
const stepKeyOf = (t) => t.stepKey || `i${t.stepIndex}`;

// tests swap in an in-memory sheet; the server uses the Google clients (reader read-only, writer read / write)
let testClient = null;
const reader = () => testClient || sheetSyncLib.getSheets();
const writer = () => testClient || sheetSyncLib.getSheetsWriter();
function setClientForTests(c) {
  testClient = c;
}

// ---------- configuration (pure) ----------

const kindOf = (label) => (/status/i.test(label) ? "status" : /remark/i.test(label) ? "remarks" : "field");

// The FMS's Sheet Sync settings with everything filled in: each step's columns as the import found them
// (Planned, Actual, Time Delay and the step's own fields such as Status / Remarks), changed by what was saved.
function configOf(process) {
  const src = process?.source;
  if (!src?.spreadsheetId) return null;
  const saved = process.sheetSync || {};
  const steps = (process.steps || []).map((step) => {
    const s = (src.steps || []).find((x) => x.key === step.key);
    const sv = saved.steps?.[step.key] || {};
    const fieldCols = Object.fromEntries((s?.fields || []).map(([k, c]) => [k, c]));
    const pick = (key, fallback) => (sv.cols && sv.cols[key] !== undefined ? sv.cols[key] : fallback || "");
    const actual = pick("actual", s?.actual);
    const cols = [
      { key: "planned", label: "Planned", kind: "planned", col: pick("planned", s?.planned), writable: false, write: false },
      { key: "actual", label: "Actual", kind: "actual", col: actual, writable: true, write: sv.write?.actual ?? true },
      { key: "delay", label: "Time Delay", kind: "delay", col: pick("delay", s?.actual ? colLetter(colIndex(s.actual) + 1) : ""), writable: false, write: false },
      ...(step.fields || []).map((f) => {
        const writable = f.type !== "photo";
        return { key: f.key, label: f.label, kind: kindOf(f.label), type: f.type, col: pick(f.key, fieldCols[f.key]), writable, write: writable && (sv.write?.[f.key] ?? true) };
      }),
    ];
    return { key: step.key, name: step.name, inSheet: Boolean(s), mode: MODES.includes(sv.mode) ? sv.mode : "inherit", cols };
  });
  return {
    spreadsheetId: src.spreadsheetId,
    tabName: src.tabName,
    firstDataRow: src.firstDataRow,
    headerRow: Math.max(1, (src.firstDataRow || 2) - 1),
    push: Boolean(saved.push),
    pull: Boolean(saved.pull),
    doneText: saved.doneText || "Done",
    naText: saved.naText || "Not Required",
    onReopen: saved.onReopen === "clear" ? "clear" : "keep",
    steps,
    lastPull: saved.lastPull || null,
  };
}

// Does the app write this step to the sheet / read it from the sheet?
const pushes = (cfg, s) => Boolean(cfg && s && s.cols.find((c) => c.key === "actual")?.col && (s.mode === "sheet" || (s.mode === "inherit" && cfg.push)));
const pulls = (cfg, s) => Boolean(cfg && s && cfg.pull && s.mode !== "app" && s.cols.find((c) => c.key === "actual")?.col);

// What an admin saved -> the stored settings. Refuses a column written twice, or a write into a Planned /
// Time Delay column (those are the sheet's formulas). Pure.
function cleanConfig(process, body: any = {}, now = new Date()) {
  // resetCols: every column back to what the import found (the step modes and switches stay as sent)
  const base = body.resetCols
    ? configOf({ ...process, sheetSync: { ...(process.sheetSync || {}), steps: Object.fromEntries(Object.entries<any>(process.sheetSync?.steps || {}).map(([k, v]) => [k, { ...v, cols: undefined }])) } })
    : configOf(process);
  if (!base) throw fail("This FMS was not imported from a Google Sheet");
  const steps: Record<string, any> = {};
  const formulaCols = new Map();
  for (const s of base.steps) {
    const b = body.resetCols ? {} : body.steps?.[s.key] || {};
    for (const c of s.cols) if (["planned", "delay"].includes(c.key)) {
      const col = String(b.cols?.[c.key] ?? c.col).toUpperCase().trim();
      if (col) formulaCols.set(col, `${s.name} – ${c.label}`);
    }
  }
  const used = new Map();
  for (const s of base.steps) {
    const sent = body.steps?.[s.key] || {};
    const b = body.resetCols ? { ...sent, cols: undefined } : sent;
    const mode = MODES.includes(b.mode) ? b.mode : "inherit";
    const cols: Record<string, any> = {};
    const write: Record<string, any> = {};
    for (const c of s.cols) {
      const col = String(b.cols?.[c.key] ?? c.col ?? "").toUpperCase().trim();
      if (col && !COL.test(col)) throw fail(`${s.name}: "${col}" is not a column (use letters like Q or AK)`);
      cols[c.key] = col;
      if (!c.writable) continue;
      write[c.key] = Boolean(b.write?.[c.key] ?? c.write);
      if (!col || !write[c.key]) continue;
      if (formulaCols.has(col)) throw fail(`${s.name} – ${c.label}: column ${col} is ${formulaCols.get(col)} (a formula column). Writing there is not allowed.`);
      if (used.has(col)) throw fail(`Column ${col} is written by both "${used.get(col)}" and "${s.name} – ${c.label}"`);
      used.set(col, `${s.name} – ${c.label}`);
    }
    steps[s.key] = { mode, cols, write };
  }
  const value = {
    push: Boolean(body.push),
    pull: Boolean(body.pull),
    doneText: String(body.doneText || "Done").trim().slice(0, 40) || "Done",
    naText: String(body.naText || "Not Required").trim().slice(0, 40) || "Not Required",
    onReopen: body.onReopen === "clear" ? "clear" : "keep",
    steps,
  };
  const any = value.push || value.pull || Object.values<any>(steps).some((s) => s.mode === "sheet");
  // switched on now: only steps finished from now on are written (the catch-up never fills the sheet with older work)
  const enabledAt = any ? process.sheetSync?.active && process.sheetSync?.enabledAt ? process.sheetSync.enabledAt : now : undefined;
  return { ...value, active: any, enabledAt, lastPull: process.sheetSync?.lastPull };
}

// ---------- what to write (pure) ----------

const istParts = (d) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .formatToParts(new Date(d))
      .map((p) => [p.type, p.value])
  );
// "2026-10-13 14:05:00" (IST) – Google Sheets reads this as a date-time whatever the sheet's locale
function sheetDateTime(d) {
  const p = istParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}
// A value the sheet must show as typed (text starting with = + - @ would otherwise become a formula)
const safeText = (v) => (/^[=+\-@]/.test(String(v)) ? `'${v}` : String(v));

function fieldText(c, v) {
  if (v === undefined || v === null || v === "") return "";
  if (Array.isArray(v)) return v.length ? safeText(v.join(", ")) : "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (c.type === "date" && isRealDay(v)) return v; // "2026-10-13" – a date in the sheet
  if (c.type === "datetime" && !isNaN(Date.parse(v))) return sheetDateTime(v);
  if (typeof v === "number") return String(v);
  return safeText(String(v).slice(0, 2000));
}

// The cells this finished step fills: [{ key, col, label, value }]. Pure.
function cellsFor(cfg, s, task) {
  if (!["done", "na"].includes(task.status)) return [];
  const values = task.values || {};
  const out = [];
  for (const c of s.cols) {
    if (!c.writable || !c.write || !c.col) continue;
    let value = "";
    if (c.key === "actual") value = task.status === "done" && task.actual ? sheetDateTime(task.actual) : "";
    else {
      value = fieldText(c, values[c.key]);
      if (!value && c.kind === "status") value = task.status === "done" ? cfg.doneText : cfg.naText;
      if (!value && c.kind === "remarks" && task.remarks) value = safeText(String(task.remarks).slice(0, 2000));
    }
    if (value) out.push({ key: c.key, col: c.col, label: c.label, value });
  }
  return out;
}

// ---------- the row still belongs to the entry? (pure) ----------

const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
// Up to three of the entry's typed fields (text / dropdown / number / date) compared with the sheet row.
// Someone inserting or deleting rows in the sheet would otherwise make the app write into another entry's row.
function rowMatches(process, job, frow, rrow) {
  const cols = new Map<any, any>((process.source?.fields || []).map(([k, c]) => [k, c]));
  const fields = (process.fields || [])
    .filter((f) => cols.has(f.key) && !f.formula?.op && ["text", "select", "number", "date"].includes(f.type) && job.data?.[f.key] !== undefined && job.data[f.key] !== "")
    .sort((a, b) => ["text", "select", "number", "date"].indexOf(a.type) - ["text", "select", "number", "date"].indexOf(b.type))
    .slice(0, 3)
    .map((f) => ({ ...f, col: cols.get(f.key) }));
  if (!fields.length) return { ok: true, checked: 0 };
  const sheet = rowValues(fields, frow, rrow);
  for (const f of fields) {
    const a = job.data[f.key];
    const b = sheet[f.key];
    const same = f.type === "number" ? Number(String(a).replace(/,/g, "")) === Number(String(b ?? "").replace(/,/g, "")) : norm(a) === norm(b);
    if (!same) return { ok: false, checked: fields.length, field: f.label, app: String(a), sheet: b === undefined ? "(empty)" : String(b) };
  }
  return { ok: true, checked: fields.length };
}

// ---------- the sheet ----------

const readRow = async (sheets, cfg, row, lastCol, render) =>
  ((
    await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: `${quote(cfg.tabName)}!A${row}:${lastCol}${row}`,
      valueRenderOption: render,
      dateTimeRenderOption: "SERIAL_NUMBER",
    })
  ).data.values || [])[0] || [];

const lastColOf = (process, cfg) =>
  colLetter(
    Math.max(
      0,
      ...cfg.steps.flatMap((s) => s.cols.map((c) => (c.col ? colIndex(c.col) : 0))),
      ...(process.source?.fields || []).map(([, c]) => colIndex(c))
    )
  );

function sheetError(err) {
  const msg = err?.errors?.[0]?.message || err?.response?.data?.error?.message || err?.message || String(err);
  if (err?.code === 403 || /permission|caller does not have/i.test(msg)) return `The sheet is not shared with the app as Editor (${sheetSyncLib.serviceAccountEmail() || "the service account"}). Share it as Editor to let the app write.`;
  if (/Unable to parse range/i.test(msg)) return "The tab was not found in the sheet (renamed?)";
  if (err?.code === 404) return "The sheet was not found";
  return msg;
}

const record = (taskId, sheetPush) => Task.updateOne({ _id: taskId }, { $set: { sheetPush } });

// ---------- App → Sheet ----------

const inFlight = new Set();

// Write one finished step to the sheet (or, when it was reopened, clear what the app wrote if the settings say so)
async function pushTask(taskId, { now = new Date() }: any = {}) {
  const id = String(taskId);
  if (inFlight.has(id)) return null;
  inFlight.add(id);
  try {
    const task = await Task.findById(id).lean<any>();
    if (!task || task.kind !== "app" || !task.job) return null;
    const [process, job] = await Promise.all([Process.findById(task.process).lean<any>(), Job.findById(task.job).select("data sheetRow jobNo").lean<any>()]);
    const cfg = configOf(process);
    const s = cfg?.steps.find((x) => x.key === stepKeyOf(task));
    if (!pushes(cfg, s)) return null;
    const prev = task.sheetPush || {};
    if (prev.state === "from-sheet") return null; // it came from the sheet: nothing to write back

    const reopened = !["done", "na"].includes(task.status);
    if (reopened && !["written", "partial"].includes(prev.state)) return null;
    if (!job?.sheetRow) {
      const out = { state: "no-row", at: now, note: "This entry was made in the app – it has no row in the sheet" };
      await record(id, out);
      return out;
    }
    const row = job.sheetRow;
    const sheets = writer();
    const lastCol = lastColOf(process, cfg);
    const [formulas, fmt, raw] = await Promise.all(["FORMULA", "FORMATTED_VALUE", "UNFORMATTED_VALUE"].map((r) => readRow(sheets, cfg, row, lastCol, r)));
    const check = rowMatches(process, job, fmt, raw);
    if (!check.ok) {
      const out = { state: "row-mismatch", at: now, row, note: `Row ${row} in the sheet no longer matches entry #${job.jobNo} (${check.field}: app "${check.app}", sheet "${check.sheet}"). Nothing was written – were rows inserted or deleted in the sheet?` };
      await record(id, out);
      return out;
    }

    if (reopened) {
      if (cfg.onReopen !== "clear") {
        const out = { ...prev, stale: true, staleAt: now, note: "Reopened in the app – the sheet still shows it finished" };
        await record(id, out);
        return out;
      }
      // clear only the cells the app wrote that still hold what it wrote
      const mine = (prev.cells || []).filter((c) => c.result === "written" && c.col);
      const clear = mine.filter((c) => {
        const cur = raw[colIndex(c.col)];
        return String(cur ?? "") === String(c.after ?? "");
      });
      if (clear.length) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: cfg.spreadsheetId,
          requestBody: { valueInputOption: "RAW", data: clear.map((c) => ({ range: `${quote(cfg.tabName)}!${c.col}${row}`, values: [[""]] })) },
        });
      }
      const out = { state: "cleared", at: now, row, cells: mine.map((c) => ({ ...c, result: clear.includes(c) ? "cleared" : "changed-in-sheet" })) };
      await record(id, out);
      return out;
    }

    const want = cellsFor(cfg, s, task);
    if (!want.length) {
      const out = { state: "nothing", at: now, row, note: "Nothing to write for this step (no columns switched on)" };
      await record(id, out);
      return out;
    }
    const cells = want.map((c) => {
      const cur = formulas[colIndex(c.col)];
      if (typeof cur === "string" && cur.startsWith("=")) return { ...c, result: "formula" };
      if (cur !== undefined && cur !== null && String(cur).trim() !== "") return { ...c, result: "filled", existing: String(fmt[colIndex(c.col)] ?? cur) };
      return { ...c, result: "write" };
    });
    const toWrite = cells.filter((c) => c.result === "write");
    if (toWrite.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: cfg.spreadsheetId,
        requestBody: { valueInputOption: "USER_ENTERED", data: toWrite.map((c) => ({ range: `${quote(cfg.tabName)}!${c.col}${row}`, values: [[c.value]] })) },
      });
      const after = await readRow(sheets, cfg, row, lastCol, "UNFORMATTED_VALUE");
      for (const c of toWrite) {
        const v = after[colIndex(c.col)];
        Object.assign(c, v === undefined || v === null || v === "" ? { result: "not-saved" } : { result: "written", after: v });
      }
    }
    const written = cells.filter((c) => c.result === "written").length;
    const state = written === cells.length ? "written" : written ? "partial" : cells.some((c) => c.result === "not-saved") ? "failed" : "skipped";
    const out = { state, at: now, row, cells, tries: (prev.tries || 0) + (state === "failed" ? 1 : 0) };
    await record(id, out);
    return out;
  } catch (err) {
    const prev = (await Task.findById(id).select("sheetPush").lean<any>())?.sheetPush || {};
    const out = { state: "failed", at: now, error: sheetError(err), tries: (prev.tries || 0) + 1 };
    await record(id, out).catch(() => {});
    return out;
  } finally {
    inFlight.delete(id);
  }
}

// Called after a step changes in the app. Never makes the person wait or fail because of the sheet.
function afterChange(taskIds) {
  for (const id of [].concat(taskIds || [])) {
    pushTask(id).catch((err) => console.error("Sheet Sync:", err.message));
  }
}

// Catch-up (sweep): finished steps of the last 7 days not written yet (missed while the server slept, done by an
// auto-complete rule…) and failed writes, up to 5 tries.
async function catchUp(now = new Date()) {
  const processes = await Process.find({ "sheetSync.active": true }).lean<any>();
  // only the steps written to the sheet, finished since Sheet Sync was switched on (and within 7 days)
  const which = processes
    .map((p) => {
      const cfg = configOf(p);
      const keys = (cfg?.steps || []).filter((s) => pushes(cfg, s)).map((s) => s.key);
      const since = new Date(Math.max(+now - 7 * DAY, p.sheetSync?.enabledAt ? +new Date(p.sheetSync.enabledAt) : 0));
      return keys.length ? { process: p._id, stepKey: { $in: keys }, resolvedAt: { $gte: since } } : null;
    })
    .filter(Boolean);
  if (!which.length) return 0;
  const tasks = await Task.find({
    $and: [
      { $or: which },
      { kind: "app", status: { $in: ["done", "na"] } },
      { $or: [{ sheetPush: null }, { "sheetPush.state": "failed", "sheetPush.tries": { $lt: 5 } }] },
    ],
  })
    .select("_id")
    .limit(200)
    .lean<any>();
  let n = 0;
  for (const t of tasks) if (await pushTask(t._id, { now })) n++;
  return n;
}

// ---------- Sheet → App ----------

// One FMS: steps finished in the sheet (an Actual date, or "No Req" / "Not Required") are finished in the app
async function pullProcess(processOrId, { now = new Date() }: any = {}) {
  const process = processOrId?._id ? processOrId : await Process.findById(processOrId).lean<any>();
  const cfg = configOf(process);
  if (!cfg?.pull) return { checked: 0, finished: 0, skipped: 0 };
  const steps = cfg.steps.filter((s) => pulls(cfg, s));
  if (!steps.length) return { checked: 0, finished: 0, skipped: 0 };
  const jobs = await Job.find({ process: process._id, status: "open", sheetRow: { $ne: null } }).select("data sheetRow jobNo").lean<any>();
  if (!jobs.length) return { checked: 0, finished: 0, skipped: 0 };
  const sheets = reader();
  const lastCol = lastColOf(process, cfg);
  const from = Math.min(...jobs.map((j) => j.sheetRow));
  const to = Math.max(...jobs.map((j) => j.sheetRow));
  const range = `${quote(cfg.tabName)}!A${from}:${lastCol}${to}`;
  const [fmtRows, rawRows] = await Promise.all(
    ["FORMATTED_VALUE", "UNFORMATTED_VALUE"].map((r) =>
      sheets.spreadsheets.values.get({ spreadsheetId: cfg.spreadsheetId, range, valueRenderOption: r, dateTimeRenderOption: "SERIAL_NUMBER" }).then((x) => x.data.values || [])
    )
  );
  const wf = require("./workflow");
  let finished = 0;
  let skipped = 0;
  for (const job of jobs) {
    const frow = fmtRows[job.sheetRow - from] || [];
    const rrow = rawRows[job.sheetRow - from] || [];
    if (!rowMatches(process, job, frow, rrow).ok) {
      skipped++;
      continue;
    }
    const updates: Record<string, any> = {};
    for (const s of steps) {
      const a = s.cols.find((c) => c.key === "actual").col;
      const rawA = rrow[colIndex(a)];
      const textA = String(frow[colIndex(a)] ?? "").trim();
      const values: Record<string, any> = {};
      let remarks = "";
      for (const c of s.cols) {
        if (!c.col || ["planned", "actual", "delay"].includes(c.key)) continue;
        const v = String(frow[colIndex(c.col)] ?? "").trim();
        if (!v) continue;
        if (c.kind === "remarks") remarks = v.slice(0, 1000);
        if (c.type !== "photo") values[c.key] = v.slice(0, 2000);
      }
      if (NOT_REQUIRED.test(textA)) updates[s.key] = { status: "na", remarks, values };
      else {
        const d = parseSheetDate(rawA) || parseSheetDate(textA);
        if (d && +d <= +now + DAY) updates[s.key] = { status: "done", actual: d, remarks, values };
      }
    }
    if (!Object.keys(updates).length) continue;
    finished += await wf.applyFromSheet(job._id, updates, { now });
  }
  const lastPull = { at: now, checked: jobs.length, finished, skipped };
  await Process.updateOne({ _id: process._id }, { $set: { "sheetSync.lastPull": lastPull } });
  return lastPull;
}

async function pullAll(now = new Date()) {
  const processes = await Process.find({ "sheetSync.active": true, "sheetSync.pull": true }).lean<any>();
  const out = [];
  for (const p of processes) {
    try {
      out.push({ process: p.name, ...(await pullProcess(p, { now })) });
    } catch (err) {
      const error = sheetError(err);
      await Process.updateOne({ _id: p._id }, { $set: { "sheetSync.lastPull": { at: now, error } } });
      out.push({ process: p.name, error });
    }
  }
  return out;
}

// ---------- check (Sheet Sync tab) ----------

// The header of every mapped column (so a wrong letter shows at once) and whether the app may write
async function checkSheet(process) {
  const cfg = configOf(process);
  if (!cfg) throw fail("This FMS was not imported from a Google Sheet");
  const lastCol = lastColOf(process, cfg);
  let header = [];
  let readError = "";
  try {
    header = await readRow(reader(), cfg, cfg.headerRow, lastCol, "FORMATTED_VALUE");
  } catch (err) {
    readError = sheetError(err);
  }
  const expect = { planned: /planned|plan|target/i, actual: /actual/i, delay: /delay/i };
  const steps = cfg.steps.map((s) => ({
    key: s.key,
    cols: s.cols.map((c) => {
      const h = c.col ? String(header[colIndex(c.col)] ?? "").trim() : "";
      // the sheet could not be read: unknown, not wrong
      const ok = readError || !c.col ? null : expect[c.key] ? expect[c.key].test(h) : Boolean(h) && (norm(h).includes(norm(c.label)) || norm(c.label).includes(norm(h)));
      return { key: c.key, col: c.col, header: h, ok };
    }),
  }));
  let canWrite = false;
  let writeError = "";
  try {
    await writer().spreadsheets.batchUpdate({ spreadsheetId: cfg.spreadsheetId, requestBody: { requests: [] } });
    canWrite = true;
  } catch (err) {
    writeError = sheetError(err);
  }
  return { headerRow: cfg.headerRow, readError, steps, canWrite, writeError, serviceAccount: sheetSyncLib.serviceAccountEmail() };
}

export = { MODES, configOf, cleanConfig, pushes, pulls, cellsFor, rowMatches, sheetDateTime, safeText, pushTask, afterChange, catchUp, pullProcess, pullAll, checkSheet, setClientForTests, colIndex, colLetter };
