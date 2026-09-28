const test = require("node:test");
const assert = require("node:assert");
const { dayKey, addTat, parseSheetDate } = require("../services/dates");
const { score, classify } = require("../services/scoring");
const { buildRows, extractSpreadsheetId } = require("../services/sheetSync");

// 2026-09-28 10:00 IST ka Google Sheets serial number
const serial = (y, m, d, hh = 0, mm = 0) => (Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(1899, 11, 30)) / 86400000;

test("score formula: -(50*late + 100*pending)/planned", () => {
  assert.strictEqual(score({ planned: 0, late: 0, pending: 0 }), 0);
  assert.strictEqual(score({ planned: 10, late: 0, pending: 0 }), 0);
  assert.strictEqual(score({ planned: 10, late: 2, pending: 1 }), -20);
  assert.strictEqual(score({ planned: 4, late: 4, pending: 0 }), -50);
  assert.strictEqual(score({ planned: 4, late: 0, pending: 4 }), -100);
});

test("classify late / on time / pending by day", () => {
  assert.strictEqual(classify({ plannedDay: "2026-09-10", actualDay: null }), "pending");
  assert.strictEqual(classify({ plannedDay: "2026-09-10", actualDay: "2026-09-10" }), "onTime");
  assert.strictEqual(classify({ plannedDay: "2026-09-10", actualDay: "2026-09-09" }), "onTime");
  assert.strictEqual(classify({ plannedDay: "2026-09-10", actualDay: "2026-09-11" }), "late");
});

test("sheet dates: serial numbers are IST wall-clock, text becomes null", () => {
  const d = parseSheetDate(serial(2026, 9, 28, 23, 30));
  assert.strictEqual(dayKey(d), "2026-09-28"); // raat 11:30 IST bhi usi din
  assert.strictEqual(dayKey(parseSheetDate(serial(2026, 9, 28, 0, 15))), "2026-09-28");
  assert.strictEqual(dayKey(parseSheetDate("05/10/2026")), "2026-10-05");
  assert.strictEqual(dayKey(parseSheetDate("05/10/2026 18:45")), "2026-10-05");
  for (const v of ["No Req", "Not Required", "NOT REQUIRED", "", null, undefined, 0]) {
    assert.strictEqual(parseSheetDate(v), null, `value ${v}`);
  }
});

test("TAT: days, hours, and Sunday skip", () => {
  const sat = new Date("2026-09-26T05:00:00Z"); // Saturday 10:30 IST
  assert.strictEqual(dayKey(addTat(sat, 1, "days")), "2026-09-27"); // Sunday
  assert.strictEqual(dayKey(addTat(sat, 1, "days", true)), "2026-09-28"); // Monday
  assert.strictEqual(dayKey(addTat(sat, 2, "days", true)), "2026-09-29");
  assert.strictEqual(dayKey(addTat(sat, 3, "hours")), "2026-09-26");
  assert.strictEqual(dayKey(addTat(sat, 24, "hours", true)), "2026-09-28");
});

test("buildRows: Planned khaali skip, filter, row numbers", () => {
  const link = { firstDataRow: 7, filterCol: "K", filterValues: ["Manish Master", "BABLU MASTER"] };
  const columns = {
    planned: [[serial(2026, 9, 1, 10)], [""], ["No Req"], [serial(2026, 9, 2)], [serial(2026, 9, 3)]],
    actual: [[serial(2026, 9, 2, 9)], [], [], [], [serial(2026, 9, 3)]],
    filter: [["MANISH MASTER"], ["MANISH MASTER"], ["BABLU MASTER"], ["Rajesh Master"], [" bablu master "]],
  };
  const rows = buildRows(link, columns);
  assert.deepStrictEqual(
    rows.map((r) => [r.sheetRow, r.plannedDay, r.actualDay, r.status]),
    [
      [7, "2026-09-01", "2026-09-02", "done"],
      [11, "2026-09-03", "2026-09-03", "done"],
    ]
  );

  const noFilter = buildRows({ firstDataRow: 8, filterCol: "" }, columns);
  assert.strictEqual(noFilter.length, 3);
  assert.strictEqual(noFilter[1].status, "pending");
});

test("spreadsheet id from URL or raw id", () => {
  const id = "1S47AOSawl0RYqY4N9a3dq7bH5fwo75fhgWrAcVonT6o";
  assert.strictEqual(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=2080554327`), id);
  assert.strictEqual(extractSpreadsheetId(id), id);
  assert.strictEqual(extractSpreadsheetId("Vendor Payment"), null);
});
