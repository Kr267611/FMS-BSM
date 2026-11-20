// Pure logic behind two read-only AI tools on a Google Sheet FMS tab (no Google calls here – sheetTools.ts reads the
// cells and hands them in, so this file is covered by plain tests):
//  - score():  the MIS score exactly as the MIS file computes it (Feeder clean dates → Performance-daily → Task Count):
//              a task counts in the period when its Planned DAY falls in it; Late = Actual day after the Planned day;
//              On time = Actual day on or before it; Pending = no Actual date; score = −(50 × Late + 100 × Pending) ÷ Planned.
//              A cell that is not a date (blank, "Not Required", text) is what the Feeder clean formula turns into "".
//  - health(): the problems that break that score – error values, 1900/3799 dates, text instead of a date, rows where
//              the Planned / Time Delay formula is missing or typed over, Status "Done" with no Actual, no "Done" dropdown,
//              an Actual date in the future – plus the overdue count.
// Cell values arrive as the Sheets API gives them: raw (UNFORMATTED_VALUE, dates as serial numbers), shown
// (FORMATTED_VALUE) and formula (FORMULA). Arrays are indexed by data row (0 = first data row).

const ERR = /^#(VALUE!|REF!|N\/A|DIV\/0!|NAME\?|NUM!|ERROR!|NULL!)/i;
const NOT_NEEDED = /^(not\s*req(uired)?|no\s*req(uired)?|n\.?\/?a\.?|-+|cancell?ed)$/i;
const DONE = /^(done|yes|completed?)$/i;
const MIN_DATE = 36526; // 1 Jan 2000 as a sheet date number
const MAX_DATE = 73415; // 31 Dec 2100

const text = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();
const blank = (v: any) => text(v) === "";
const isNum = (v: any) => typeof v === "number" && Number.isFinite(v);
const isDate = (v: any) => isNum(v) && v >= MIN_DATE && v <= MAX_DATE;

function colLetter(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function colIndex(letters: string) {
  let n = 0;
  for (const ch of String(letters).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// sheet date number <-> "2026-11-20"
const EPOCH = Date.UTC(1899, 11, 30);
const serialOf = (iso: string) => {
  const m = String(iso || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? Math.round((t - EPOCH) / 86400000) : null;
};
const isoOf = (serial: number) => new Date(EPOCH + Math.floor(serial) * 86400000).toISOString().slice(0, 10);

// The columns of every step block, from the header row: Planned, Actual, and the Time Delay / Status columns between this
// step's Planned and the next step's Planned (a standard block is Planned | Actual | Time Delay | Status | Remarks).
function blocks(header: any[], steps: { name: string; plannedCol: string; actualCol: string }[]) {
  const starts = steps.map((s) => colIndex(s.plannedCol));
  return steps.map((s, k) => {
    const p = starts[k];
    const end = k + 1 < starts.length ? starts[k + 1] : p + 5;
    const find = (re: RegExp) => {
      for (let c = p + 1; c < end; c++) if (re.test(text(header[c]))) return c;
      return -1;
    };
    return { name: s.name, planned: p, actual: colIndex(s.actualCol), delay: find(/delay/i), status: find(/status/i) };
  });
}
type Block = ReturnType<typeof blocks>[number];

// Which data rows hold an entry: a left-side (entry) cell that is filled. A pre-made row can carry a formula whose
// result is the same in every empty row (e.g. a "days" column = TODAY() − blank); such a column's most common value,
// when it fills most of the column, is not taken as data – otherwise thousands of empty rows would count.
function entryRows(left: any[][], rows: number) {
  const width = Math.max(0, ...left.map((r) => (r || []).length));
  const filler: string[] = [];
  for (let c = 0; c < width; c++) {
    const counts = new Map<string, number>();
    let filled = 0;
    for (const r of left) {
      const t = text((r || [])[c]);
      if (!t) continue;
      filled++;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    let top = "";
    let n = 0;
    counts.forEach((count, value) => count > n && ((n = count), (top = value)));
    filler[c] = n >= 50 && n >= filled * 0.5 ? top : null;
  }
  return Array.from({ length: rows }, (_, i) => (left[i] || []).some((v, c) => !blank(v) && text(v) !== filler[c]));
}

// ---------- score ----------

function score(planned: any[], actual: any[], from: number, to: number, today: number, keep: (i: number) => boolean = () => true) {
  const r = { planned: 0, actual: 0, late: 0, onTime: 0, pending: 0, notDue: 0, textActual: 0, notDate: 0, score: 0 };
  for (let i = 0; i < planned.length; i++) {
    if (!keep(i)) continue;
    const p = planned[i];
    if (!isNum(p)) {
      if (!blank(p) && !NOT_NEEDED.test(text(p))) r.notDate++; // text or an error: the Feeder clean formula skips it
      continue;
    }
    const day = Math.floor(p);
    if (day < from || day > to) continue;
    r.planned++;
    const a = actual[i];
    if (isNum(a)) Math.floor(a) > day ? r.late++ : r.onTime++;
    else {
      r.pending++;
      if (day >= today) r.notDue++;
      if (!blank(a)) r.textActual++;
    }
  }
  r.actual = r.late + r.onTime;
  r.score = scoreOf(r.planned, r.late, r.pending);
  return r;
}
const scoreOf = (planned: number, late: number, pending: number) => (planned ? Math.round((-(50 * late + 100 * pending) / planned) * 100) / 100 || 0 : 0);

// ---------- health ----------

// "AH12, AH40–AH45, AH90 … (9 cells)"
function cellList(list: { col: number; row: number }[], max = 6) {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1].col === list[i].col && list[j + 1].row === list[j].row + 1) j++;
    const a = `${colLetter(list[i].col)}${list[i].row}`;
    parts.push(j > i ? `${a}–${colLetter(list[j].col)}${list[j].row}` : a);
    i = j;
  }
  const shown = parts.slice(0, max).join(", ") + (parts.length > max ? ", …" : "");
  return `${shown} (${list.length} ${list.length === 1 ? "cell" : "cells"})`;
}

type Health = {
  firstRow: number; // sheet row of data row 0
  data: boolean[]; // data row holds an entry
  cols: Map<number, { raw: any[]; shown: any[]; formula: any[] }>;
  dropdown: Map<number, boolean[] | null>; // Status column -> has a dropdown, by data row (null = could not be checked)
  today: number;
};

const FIX = {
  error: "a formula fails – usually text such as \"No Req\" inside a date formula, or a deleted column (#REF!). Open the cell and check its formula",
  oddDate: "a 1900 or 3799 date means the formula reads an empty cell, itself or the wrong column – point it at the right column",
  textDate: "typed as text, not a real date, so the MIS cannot count it – re-enter it as a date",
  missing: "the formula is missing in these rows – copy it down from a row above",
  typed: "a value was typed over the formula – copy the formula back from a row above",
  doneNoActual: "Status is Done but Actual is empty, so the MIS counts these as pending – check what fills Actual when Done is selected (a script or the doer)",
  noDropdown: "the \"Done\" dropdown is missing – Data → Data validation, or copy a row above and Paste special → Data validation only",
  noDropdownAll: "the Status column has no dropdown at all – add one with Data → Data validation",
  future: "Actual is after today – probably a typing mistake",
};

function checkStep(b: Block, h: Health) {
  const col = (c: number) => h.cols.get(c) || { raw: [], shown: [], formula: [] };
  const rows = h.data.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  const cell = (c: number, i: number) => ({ col: c, row: h.firstRow + i });
  const found: { what: string; cells: { col: number; row: number }[]; fix: string }[] = [];
  const add = (what: string, cells: { col: number; row: number }[], fix: string) => cells.length && found.push({ what, cells, fix });
  const blockCols = [b.planned, b.actual, b.delay, b.status].filter((c) => c >= 0);

  // error values anywhere in the step's columns
  const errors = [];
  for (const c of blockCols) for (const i of rows) if (ERR.test(text(col(c).shown[i])) || ERR.test(text(col(c).raw[i]))) errors.push(cell(c, i));
  add("Error values (#VALUE!, #REF!, #N/A …)", errors.sort((x, y) => x.col - y.col || x.row - y.row), FIX.error);

  // dates that are not real dates
  for (const [c, label] of [[b.planned, "Planned"], [b.actual, "Actual"]] as [number, string][]) {
    const odd = [];
    const asText = [];
    for (const i of rows) {
      const v = col(c).raw[i];
      if (isNum(v) && !isDate(v)) odd.push(cell(c, i));
      else if (!isNum(v) && !blank(v) && !ERR.test(text(v)) && !NOT_NEEDED.test(text(v)) && !(c === b.actual && DONE.test(text(v)))) asText.push(cell(c, i));
    }
    add(`${label} shows a wrong date (year 1900 / 3799 …)`, odd, FIX.oddDate);
    add(`${label} holds text instead of a date`, asText, FIX.textDate);
  }

  // Planned / Time Delay formula missing or typed over, where most rows with an entry carry the formula
  for (const [c, label] of [[b.planned, "Planned"], [b.delay, "Time Delay"]] as [number, string][]) {
    if (c < 0 || !rows.length) continue;
    const isF = (i: number) => text(col(c).formula[i]).startsWith("=");
    const withF = rows.filter(isF).length;
    if (withF < Math.max(3, rows.length * 0.5)) continue; // this column is not formula-driven
    const without = rows.filter((i) => !isF(i));
    add(`${label} formula missing`, without.filter((i) => blank(col(c).raw[i])).map((i) => cell(c, i)), FIX.missing);
    add(`${label} formula typed over`, without.filter((i) => !blank(col(c).raw[i])).map((i) => cell(c, i)), FIX.typed);
  }

  // Status Done but no Actual date; Status dropdown missing
  if (b.status >= 0) {
    add(
      "Status Done but Actual is empty",
      rows.filter((i) => DONE.test(text(col(b.status).shown[i])) && !isNum(col(b.actual).raw[i])).map((i) => cell(b.status, i)),
      FIX.doneNoActual
    );
    const dd = h.dropdown.get(b.status);
    if (dd && rows.length) {
      const missing = rows.filter((i) => !dd[i]);
      if (missing.length === rows.length) add("No dropdown in the Status column", [cell(b.status, rows[0])], FIX.noDropdownAll);
      else add("Status dropdown missing", missing.map((i) => cell(b.status, i)), FIX.noDropdown);
    }
  }

  // Actual in the future
  add("Actual date after today", rows.filter((i) => isDate(col(b.actual).raw[i]) && Math.floor(col(b.actual).raw[i]) > h.today).map((i) => cell(b.actual, i)), FIX.future);

  const overdue = rows.filter((i) => isDate(col(b.planned).raw[i]) && Math.floor(col(b.planned).raw[i]) < h.today && blank(col(b.actual).raw[i]));
  const oldest = overdue.map((i) => ({ i, day: Math.floor(col(b.planned).raw[i]) })).sort((x, y) => x.day - y.day)[0];
  return { found, overdue: overdue.length, oldestOverdue: oldest ? { row: h.firstRow + oldest.i, planned: isoOf(oldest.day) } : null };
}

function health(bl: Block[], h: Health) {
  return bl.map((b) => ({ block: b, ...checkStep(b, h) }));
}

export = { blocks, entryRows, score, scoreOf, health, cellList, serialOf, isoOf, colLetter, colIndex, NOT_NEEDED, FIX };
