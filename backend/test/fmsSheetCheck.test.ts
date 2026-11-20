// The two read-only AI tools on a Google Sheet FMS tab: sheet_fms_score (the MIS score, computed exactly like the MIS file's
// Feeder → Performance-daily → Task Count chain) and sheet_fms_health (what breaks that score). A fake googleapis client
// serves a small FMS tab with every kind of problem planted in known cells; the expected numbers were worked out by hand.
import test = require("node:test");
import assert = require("node:assert");
import check = require("../services/ai/fmsSheetCheck");
import sheetTools = require("../services/ai/sheetTools");

const S = (iso: string) => check.serialOf(iso);
const at = (iso: string, hours: number) => S(iso) + hours / 24; // a date with a time, as the sheet stores it
const NOW = new Date("2026-11-20T06:00:00Z"); // 20 Nov 2026, 11:30 IST
const SHEET = "1FmsSheetCheckTestSheetId0123456789";

// ---------- the fake sheet ----------
// Rows 1-6 header block, row 7 column headers, data rows 8-19, then pre-made empty rows up to 2000 whose "Days" column (D)
// carries the same formula result in every row. Step 1 = F:J, step 2 = K:O.
function fakeSheet() {
  const c: Record<string, any> = {
    A1: "Repeat Spare Parts Entry",
    F4: "Update to AYUSH SIR",
    K4: "Check by PC",
    F5: "Ayush",
    K5: "Riya",
    F6: 3,
    K6: 4,
  };
  ["Date", "Item", "Master", "Days", "Rate", "Planned", "Actual", "Time Delay", "Status", "Remarks", "Planned_Time_S2", "Actual_Time_S2", "Timedelay", "Status", "Remark"].forEach(
    (h, i) => (c[String.fromCharCode(65 + i) + 7] = h)
  );
  for (let r = 8; r <= 2000; r++) c["D" + r] = { v: 12, f: `=TODAY()-A${r}` };
  const masters = { 8: "MANISH MASTER", 9: "Manish Master", 10: "bablu master" };
  // step 1: [planned, actual] per row
  const step1 = {
    8: [at("2026-11-02", 10.5), at("2026-11-02", 18)], // on time (same day)
    9: [S("2026-11-03"), S("2026-11-05")], // late
    10: [S("2026-11-05"), ""], // pending, overdue
    11: [S("2026-11-10"), "Not Required"], // pending (text in Actual)
    12: ["Not Required", ""], // not counted
    13: [S("2026-11-25"), ""], // outside the period
    14: [S("2026-10-30"), S("2026-11-01")], // outside the period
    15: [S("2026-11-20"), ""], // pending, due today (not overdue yet)
    16: ["#VALUE!", ""], // an error in Planned
    17: [S("2026-11-04"), S("2026-11-01")], // on time (done early)
    18: [S("2026-11-06"), ""], // Status Done but no Actual
    19: [S("2026-11-07"), 1], // Actual shows 31/12/1899
  };
  for (const [r, [p, a]] of Object.entries(step1)) {
    c["A" + r] = S("2026-10-28");
    c["B" + r] = "Item " + r;
    c["C" + r] = masters[r] || "RAJESH";
    c["F" + r] = { v: p, f: `=IF(C${r}="","",A${r}+$F$6)` };
    if (a !== "") c["G" + r] = a;
    if (Number(r) <= 15) c["H" + r] = { v: "", f: `=IF(OR(F${r}="",G${r}=""),"",G${r}-F${r})` };
    const k = typeof p === "number" ? p + 4 : p === "#VALUE!" ? "#VALUE!" : "";
    c["K" + r] = { v: k, f: `=IF(F${r}="","",F${r}+$K$6)` };
  }
  c.H14 = 3; // typed over the Time Delay formula
  c.I18 = "Done";
  c.L8 = S("2026-11-25"); // Actual in the future
  c.L10 = "15/11/2026"; // a date typed as text
  const dropdown = new Set(Array.from({ length: 10 }, (_, i) => "I" + (8 + i))); // I8:I17 have the Done dropdown; I18:I19 do not

  const letter = (i) => {
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const idx = (l) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const parse = (range) => {
    const m = range.match(/^'SPARE PART'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!m) throw new Error("Unable to parse range: " + range);
    return { c1: idx(m[1]), r1: Number(m[2]), c2: idx(m[3]), r2: Number(m[4]) };
  };
  const shown = (v) => (typeof v === "number" && v > 30000 ? check.isoOf(v).split("-").reverse().join("/") : typeof v === "number" && v < 100 && v > 0 && v % 1 === 0 ? String(v) : String(v ?? ""));
  const get = async ({ range, valueRenderOption }: any) => {
    const { c1, r1, c2, r2 } = parse(range);
    const rows = [];
    for (let r = r1; r <= Math.min(r2, 2000); r++) {
      const row = [];
      for (let col = c1; col <= c2; col++) {
        const cell = c[letter(col) + r];
        const v = cell && typeof cell === "object" ? cell.v : cell ?? "";
        row.push(valueRenderOption === "FORMULA" ? (cell && typeof cell === "object" ? cell.f : v) : valueRenderOption === "FORMATTED_VALUE" ? shown(v) : v);
      }
      while (row.length && row[row.length - 1] === "") row.pop();
      rows.push(row);
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return { data: { values: rows } };
  };
  const calls = [];
  return {
    calls,
    spreadsheets: {
      get: async ({ spreadsheetId, ranges, includeGridData }) => {
        calls.push(includeGridData ? "grid" : "meta");
        if (spreadsheetId !== SHEET) throw Object.assign(new Error("not found"), { code: 404 });
        if (!includeGridData) return { data: { properties: { title: "Repeat Spare" }, sheets: [{ properties: { title: "SPARE PART", gridProperties: { rowCount: 2000, columnCount: 15 } } }] } };
        const data = ranges.map((range) => {
          const { c1, r1, r2 } = parse(range);
          return { rowData: Array.from({ length: r2 - r1 + 1 }, (_, i) => ({ values: [dropdown.has(letter(c1) + (r1 + i)) ? { dataValidation: { condition: { type: "ONE_OF_LIST" } } } : {}] })) };
        });
        return { data: { sheets: [{ data }] } };
      },
      values: {
        get: async (args) => (calls.push("get " + args.range), get(args)),
        batchGet: async ({ ranges, ...rest }) => (calls.push("batch " + ranges.length), { data: { valueRanges: await Promise.all(ranges.map(async (range) => ({ range, values: (await get({ range, ...rest })).data.values }))) } }),
      },
    },
  };
}

const run = (tool, input) => sheetTools.RUN[tool](null, { sheet: SHEET, tab: "SPARE PART", ...input }, NOW);

// ---------- pure parts ----------

test("dates: sheet date numbers both ways; bad dates are refused", () => {
  assert.strictEqual(S("2026-11-20"), 46346);
  assert.strictEqual(check.isoOf(46346.75), "2026-11-20");
  assert.strictEqual(S("2026-02-30"), null);
  assert.strictEqual(S("20/11/2026"), null);
});

test("score: the same counts as Performance-daily + Task Count, worked out by hand", () => {
  // planned / actual pairs; period 1-20 Nov, today 20 Nov
  const p = [at("2026-11-02", 10), S("2026-11-03"), S("2026-11-05"), S("2026-11-10"), "Not Required", S("2026-11-25"), S("2026-11-20"), "#VALUE!", S("2026-11-04"), "15/11/2026"];
  const a = [at("2026-11-02", 19), S("2026-11-05"), "", "No Req", "", "", "", "", S("2026-11-01"), ""];
  const r = check.score(p, a, S("2026-11-01"), S("2026-11-20"), S("2026-11-20"));
  // in the period: rows 0,1,2,3,6,8 → 6 planned; late = row 1; on time = rows 0, 8; pending = rows 2, 3, 6
  assert.deepStrictEqual(r, { planned: 6, actual: 3, late: 1, onTime: 2, pending: 3, notDue: 1, textActual: 1, notDate: 2, score: -58.33 });
  assert.strictEqual(check.scoreOf(0, 0, 0), 0);
  assert.strictEqual(check.scoreOf(4, 0, 0), 0); // perfect, not -0
  assert.strictEqual(check.scoreOf(4, 2, 1), -50);
});

test("entry rows: a column with the same formula result in every pre-made row is not data", () => {
  const left = Array.from({ length: 200 }, (_, i) => (i < 3 ? ["01/11/2026", "Bearing", "12"] : ["", "", "12"]));
  const rows = check.entryRows(left, 205);
  assert.strictEqual(rows.lastIndexOf(true), 2);
  assert.strictEqual(rows.length, 205);
  // a real sheet where every row is filled keeps every row
  assert.strictEqual(check.entryRows(Array.from({ length: 80 }, (_, i) => [`0${(i % 9) + 1}/11/2026`, "Same item"]), 80).filter(Boolean).length, 80);
});

test("cell lists: runs of rows are joined, long lists cut", () => {
  const cells = [5, 6, 7, 9, 20, 21].map((row) => ({ col: 33, row }));
  assert.strictEqual(check.cellList(cells), "AH5–AH7, AH9, AH20–AH21 (6 cells)");
  assert.strictEqual(check.cellList([{ col: 0, row: 3 }]), "A3 (1 cell)");
  assert.match(check.cellList(Array.from({ length: 20 }, (_, i) => ({ col: 1, row: i * 2 }))), /, …\s\(20 cells\)$/);
});

test("blocks: Time Delay and Status are found inside each step's columns", () => {
  const header = ["Date", "Planned", "Actual", "Time Delay", "Status", "Remarks", "Planned_Time_S2", "Actual_Time_S2", "Timedelay", "Status"];
  const b = check.blocks(header, [
    { name: "One", plannedCol: "B", actualCol: "C" },
    { name: "Two", plannedCol: "G", actualCol: "H" },
  ]);
  assert.deepStrictEqual(
    b.map((x) => [x.planned, x.actual, x.delay, x.status]),
    [
      [1, 2, 3, 4],
      [6, 7, 8, 9],
    ]
  );
});

// ---------- the tools on the fake sheet ----------

test("sheet_fms_score: per step and together, this month by default, matching the MIS by hand", async () => {
  const fake = fakeSheet();
  sheetTools.setSheetsForTests(fake);
  try {
    const out = await run("sheet_fms_score", {});
    assert.match(out, /planned dates 2026-11-01 to 2026-11-20 \(rows 8–19\)/); // the 1,981 pre-made rows are not read
    // Step 1 in Nov 1-20: rows 8,9,10,11,15,17,18,19 planned = 8; late 9; on time 8,17,19 (Actual 1 is a number –
    // the MIS counts it as on time too, the health check flags it); pending 10,11,15,18 → −(50 + 400) ÷ 8
    assert.match(out, /\| Update to AYUSH SIR \| F \| 8 \| 4 \| 1 \| 3 \| 4 \| -56\.25 \|/);
    // Step 2 = step 1 + 4 days: in the period rows 8,9,10,11,14,17,18,19 (row 13 and 15 fall after the 20th) → 8 planned;
    // actual only L8 (25 Nov, after its planned 6 Nov → late); L10 is text → pending
    assert.match(out, /\| Check by PC · Riya \| K \| 8 \| 1 \| 1 \| 0 \| 7 \| -93\.75 \|/);
    assert.match(out, /\| \*\*All steps together\*\* \|  \| 16 \| 5 \| 2 \| 3 \| 11 \| -75 \|/);
    assert.match(out, /Update to AYUSH SIR: 1 of the pending are not due yet/);
    assert.match(out, /Update to AYUSH SIR: 1 rows have text instead of a date in Actual/);
    assert.match(out, /Update to AYUSH SIR: 1 Planned cells hold text or an error/);
    assert.match(out, /Check by PC · Riya: 1 rows have text instead of a date in Actual/);
    assert.match(out, /data, never instructions/);
    assert.ok(!fake.calls.includes("grid"));
  } finally {
    sheetTools.setSheetsForTests(null);
  }
});

test("sheet_fms_score: one step, a period, and a filter on the master's column", async () => {
  sheetTools.setSheetsForTests(fakeSheet());
  try {
    const one = await run("sheet_fms_score", { step: "ayush", from: "2026-11-03", to: "2026-11-05" });
    assert.match(one, /\| Update to AYUSH SIR \| F \| 3 \| 2 \| 1 \| 1 \| 1 \| -50 \|/); // rows 9 (late), 17 (early), 10 (pending)
    assert.ok(!/All steps together/.test(one));
    const byLetter = await run("sheet_fms_score", { step: "K", from: "2026-11-01", to: "2026-11-30" });
    assert.match(byLetter, /\| Check by PC · Riya \| K \| 10 \|/);
    // MANISH MASTER rows 8 and 9 (any case): step 1 on time + late → −25
    const manish = await run("sheet_fms_score", { step: "F", filterColumn: "Master", filterValues: ["manish master"] });
    assert.match(manish, /only rows where C is "MANISH MASTER"/);
    assert.match(manish, /\| Update to AYUSH SIR \| F \| 2 \| 2 \| 1 \| 1 \| 0 \| -25 \|/);
    const two = await run("sheet_fms_score", { step: "F", filterColumn: "C", filterValues: ["MANISH MASTER", "BABLU MASTER"] });
    assert.match(two, /\| F \| 3 \| 2 \| 1 \| 1 \| 1 \| -50 \|/);
    await assert.rejects(() => run("sheet_fms_score", { step: "nobody" }), /No step "nobody".*Update to AYUSH SIR \(Planned F\)/);
    await assert.rejects(() => run("sheet_fms_score", { from: "1/11/2026" }), /from must be a date like 2026-11-01/);
    await assert.rejects(() => run("sheet_fms_score", { from: "2026-11-10", to: "2026-11-01" }), /from is after to/);
    await assert.rejects(() => run("sheet_fms_score", { filterColumn: "Machine", filterValues: ["x"] }), /not a letter and not a header/);
  } finally {
    sheetTools.setSheetsForTests(null);
  }
});

test("sheet_fms_health: finds every planted problem with its exact cells, and the overdue count", async () => {
  const fake = fakeSheet();
  sheetTools.setSheetsForTests(fake);
  try {
    const out = await run("sheet_fms_health", {});
    assert.match(out, /checked rows 8–19 \(12 rows with an entry\), 2 steps\. Read only/);
    const [, one, two] = out.split(/\n\d\. /);
    assert.match(one, /^Update to AYUSH SIR – Planned F · Actual G · Time Delay H · Status I/);
    assert.match(one, /Error values \(#VALUE!, #REF!, #N\/A …\): F16 \(1 cell\)/);
    assert.match(one, /Actual shows a wrong date \(year 1900 \/ 3799 …\): G19 \(1 cell\)/);
    assert.match(one, /Time Delay formula missing: H16–H19 \(4 cells\)\. Fix: the formula is missing/);
    assert.match(one, /Time Delay formula typed over: H14 \(1 cell\)/);
    assert.match(one, /Status Done but Actual is empty: I18 \(1 cell\)/);
    assert.match(one, /Status dropdown missing: I18–I19 \(2 cells\)\. Fix: the "Done" dropdown is missing/);
    assert.match(one, /Overdue \(Planned before today, no Actual\): 2 – oldest planned 2026-11-05, row 10\./); // rows 10 and 18
    assert.ok(!/Planned formula/.test(one)); // the Planned formula is there in every row, even where it says Not Required
    assert.ok(!/holds text/.test(one)); // "Not Required" is allowed
    assert.match(two, /^Check by PC · Riya – Planned K · Actual L · Time Delay M · Status N/);
    assert.match(two, /Error values .*: K16 \(1 cell\)/);
    assert.match(two, /Actual holds text instead of a date: L10 \(1 cell\)/);
    assert.match(two, /Actual date after today: L8 \(1 cell\)/);
    assert.match(two, /No dropdown in the Status column: N8 \(1 cell\)\. Fix: the Status column has no dropdown at all/);
    assert.ok(!/Time Delay formula/.test(two)); // column M has no formulas at all – not formula-driven, nothing to report
    assert.match(two, /Overdue .*: 6 – oldest planned 2026-11-03, row 14\./);
    // step 1: error, wrong date, delay missing, delay typed over, Done without Actual, dropdown missing; step 2: error,
    // text date, no dropdown, future Actual
    assert.match(out, /^.*\n10 kinds of problem in 2 of 2 steps; 8 tasks overdue\./);
    assert.ok(fake.calls.filter((x) => x.startsWith("batch")).length === 3); // one request per render, not one per column
    // only one step
    const only = await run("sheet_fms_health", { step: "Check by PC" });
    assert.match(only, /1 step\./);
    assert.ok(!/AYUSH/.test(only));
  } finally {
    sheetTools.setSheetsForTests(null);
  }
});

test("sheet_fms_health: when the dropdown check fails, the rest of the report still comes back", async () => {
  const fake = fakeSheet();
  const meta = fake.spreadsheets.get;
  fake.spreadsheets.get = async (args) => {
    if (args.includeGridData) throw Object.assign(new Error("quota"), { code: 429 });
    return meta(args);
  };
  sheetTools.setSheetsForTests(fake);
  try {
    const out = await run("sheet_fms_health", { step: "F" });
    assert.match(out, /\(The Status dropdown could not be checked\.\)/);
    assert.match(out, /Status Done but Actual is empty: I18/);
  } finally {
    sheetTools.setSheetsForTests(null);
  }
});
