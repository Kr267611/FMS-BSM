// Finding the steps of a Google Sheet FMS from its top rows (Planned / Actual columns, header row, step name)
const test = require("node:test");
const assert = require("node:assert");
const { findSteps, colLetter } = require("../services/sheetInspect");

test("column letters", () => {
  assert.deepStrictEqual([0, 25, 26, 33, 51, 52, 701, 702].map(colLetter), ["A", "Z", "AA", "AH", "AZ", "BA", "ZZ", "AAA"]);
});

test("finds each 5-column step block below its name, doer and TAT", () => {
  const rows = [];
  rows[0] = ["", "Repeat Spare Parts Entry"];
  rows[3] = ["", "", "", "", "", "Update to AYUSH SIR", "", "", "", "", "Check by PC"];
  rows[4] = ["", "", "", "", "", "Ayush", "", "", "", "", "Riya"];
  rows[5] = ["", "", "", "", "", "3", "", "", "", "", "4"];
  rows[6] = ["Date", "Item", "Machine", "Location", "Rate", "Planned", "Actual", "Time Delay", "Status", "Remarks", "Planned_Time_S2", "Actual_Time_S2", "Timedelay", "Status", "Remark"];
  const r = findSteps(rows);
  assert.strictEqual(r.headerRow, 7);
  assert.deepStrictEqual(
    r.steps.map((s) => [s.plannedCol, s.actualCol, s.name]),
    [
      ["F", "G", "Update to AYUSH SIR"],
      ["K", "L", "Check by PC · Riya"],
    ]
  );
});

test("Actual defaults to the column after Planned; no Planned header means no steps", () => {
  const r = findSteps([["Date", "Party", "Plan Date", "Done On"]]);
  assert.deepStrictEqual([r.headerRow, r.steps[0].plannedCol, r.steps[0].actualCol], [1, "C", "D"]);
  assert.deepStrictEqual(findSteps([["Date", "Party"]]), { headerRow: null, steps: [] });
});
