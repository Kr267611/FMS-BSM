// CSV rows -> FMS entries (e.g. the monthly ERP list). Columns are matched to entry fields by label or key,
// ignoring case and spaces. dryRun checks every row without saving. uniqueField skips rows whose value
// already exists in this FMS (or earlier in the file), so the same list can be uploaded again safely.
const Process = require("../models/Process");
const Job = require("../models/Job");
const User = require("../models/User");
const wf = require("./workflow");
const { dayKey, parseSheetDate } = require("./dates");
const { peopleDirectory } = require("./checklists");

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const DATE_COLUMNS = ["entrydate", "date"];

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// "4/12/2024", "04-12-2024 10:30" or "2024-12-04" -> Date (IST)
function parseDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00+05:30` : s);
    return isNaN(d) ? undefined : d;
  }
  return parseSheetDate(s) || undefined;
}

// Which CSV column feeds which field
function columnsFor(process, headers) {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const fields = process.fields.filter((f) => !f.formula?.op);
  const matched = [];
  const missing = [];
  for (const f of fields) {
    const col = byNorm.get(norm(f.label)) ?? byNorm.get(norm(f.key));
    if (col !== undefined) matched.push({ key: f.key, label: f.label, column: col });
    else missing.push({ key: f.key, label: f.label, required: Boolean(f.required) });
  }
  const used = new Set(matched.map((m) => norm(m.column)));
  const dateColumn = DATE_COLUMNS.map((n) => byNorm.get(n)).find((c) => c !== undefined && !used.has(norm(c))) || null;
  const extra = headers.filter((h) => !used.has(norm(h)) && h !== dateColumn);
  return { matched, missing, dateColumn, extra };
}

async function importEntries({ processId, rows, dryRun = true, uniqueField, firstLine = 2, user, now = new Date() }) {
  const process = await Process.findById(processId).lean();
  if (!process) throw fail("FMS not found", 404);
  if (!dryRun && !process.active) throw fail("This FMS is a draft or inactive. Activate it in Master FMS first.");
  if (uniqueField && !process.fields.some((f) => f.key === uniqueField)) throw fail("Unknown field for duplicates");

  const headers = Object.keys(rows[0] || {});
  const cols = columnsFor(process, headers);
  const fieldOf = new Map(process.fields.map((f) => [f.key, f]));
  const needsPeople = cols.matched.some((m) => fieldOf.get(m.key).type === "user");
  const who = needsPeople ? peopleDirectory(await User.find({ active: true }).select("name username email").lean()) : null;
  const seen = new Set();

  const results = [];
  for (const [i, r] of rows.entries()) {
    const line = firstLine + i;
    try {
      const data = {};
      for (const m of cols.matched) {
        const f = fieldOf.get(m.key);
        let v = String(r[m.column] ?? "").trim();
        if (!v) continue;
        if (f.type === "date") {
          const d = parseDate(v);
          if (!d) throw fail(`"${f.label}": "${v}" is not a date (use dd/mm/yyyy)`);
          v = dayKey(d);
        } else if (f.type === "datetime") {
          const d = parseDate(v);
          if (!d) throw fail(`"${f.label}": "${v}" is not a date`);
          v = d.toISOString();
        } else if (f.type === "number") {
          v = v.replace(/,/g, "");
        } else if (f.type === "user") {
          v = who(v, f.label);
        }
        data[m.key] = v;
      }
      let start = now;
      if (cols.dateColumn && String(r[cols.dateColumn] ?? "").trim()) {
        start = parseDate(r[cols.dateColumn]);
        if (!start) throw fail(`Entry date "${r[cols.dateColumn]}" is not a date (use dd/mm/yyyy)`);
      }
      if (uniqueField && data[uniqueField] !== undefined && data[uniqueField] !== "") {
        const key = String(data[uniqueField]).toLowerCase();
        if (seen.has(key)) throw fail(`${fieldOf.get(uniqueField).label} "${data[uniqueField]}" is already in this file`, 409);
        seen.add(key);
        if (await Job.exists({ process: process._id, [`data.${uniqueField}`]: data[uniqueField] })) {
          throw fail(`${fieldOf.get(uniqueField).label} "${data[uniqueField]}" is already an entry`, 409);
        }
      }
      if (dryRun) {
        await wf.entryValues(process, data, start);
        results.push({ line, ok: true });
      } else {
        const job = await wf.createJob({ processId: process._id, data, startDate: start, user, now });
        results.push({ line, ok: true, jobNo: job.jobNo });
      }
    } catch (err) {
      results.push({ line, ok: false, duplicate: err.status === 409, error: err.message });
    }
  }
  return { columns: cols, results };
}

module.exports = { importEntries, columnsFor, parseDate };
