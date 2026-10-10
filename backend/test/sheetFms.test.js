// Google Sheet FMS -> FMS: entry form, steps (TAT, doer, Status / Remarks), and each row's step status
const test = require("node:test");
const assert = require("node:assert");
const { planFms, rowTasks, entryRows, matchUser } = require("../services/sheetFms");

const top = [];
top[0] = ["", "Repeat Spare Parts Entry"];
top[3] = ["", "", "", "Accountable Person ( PRADEEP BHAI )", "", "", "", "", "", "Update to AYUSH SIR"];
top[4] = ["", "", "", "", "", "", "", "", "", "AYUSH SIR"];
top[5] = ["", "", "", "2", "", "", "", "", "", "3"];
top[6] = ["Date", "Item Name", "Rate", "Planned", "Actual", "Time Delay", "Status", "Remarks", "", "Planned", "Actual", "Time Delay", "Status", "Remarks"];
// data rows: formatted text and raw values (dates as sheet serial numbers)
const fmt = [
  ["06/06/2024", "VALVE", "764.31", "08/06/2024", "09/06/2024", "1", "Done", "ok", "", "11/06/2024", "", "", "Follow up"],
  ["07/06/2024", "BEARING", "120", "09/06/2024", "", "", "", "", "", "", ""],
  ["08/06/2024", "BELT", "50", "", "", "", "", "", "", "", ""],
  [],
  ["09/06/2024", "SEAL", "10", "No Req", "", "", "", "", "", "", ""],
];
const raw = fmt.map((r) => r.map((v) => (/^\d\d\/\d\d\/\d{4}$/.test(v) ? 45449 + Number(v.slice(0, 2)) - 6 : /^[\d.]+$/.test(v) ? Number(v) : v)));

test("reads the entry form and the steps from the header block", () => {
  const plan = planFms(top, fmt, raw);
  assert.strictEqual(plan.firstDataRow, 8);
  assert.deepStrictEqual(plan.fields.map((f) => [f.col, f.label, f.type]), [["A", "Date", "date"], ["B", "Item Name", "text"], ["C", "Rate", "number"]]);
  assert.deepStrictEqual(
    plan.steps.map((s) => [s.name, s.doerHint, s.plannedCol, s.actualCol, s.tat, s.fields.map((f) => f.label)]),
    [
      ["Accountable Person ( PRADEEP BHAI )", "PRADEEP BHAI", "D", "E", 2, ["Status", "Remarks"]],
      ["Update to AYUSH SIR", "AYUSH SIR", "J", "K", 3, ["Status", "Remarks"]],
    ]
  );
});

test("each row comes in with its steps as in the sheet; empty rows are left out", () => {
  const plan = planFms(top, fmt, raw);
  const rows = entryRows(plan, fmt, raw);
  assert.deepStrictEqual(rows.map((r) => r.sheetRow), [8, 9, 10, 12]);
  assert.deepStrictEqual(rows[0].data, { date: "2024-06-06", item_name: "VALVE", rate: 764.31 });
  const status = rows.map((r) => rowTasks(plan, r.frow, r.rrow).map((t) => t.status));
  // done + pending · pending + not started · left out by the sheet's condition · No Req
  assert.deepStrictEqual(status, [["done", "pending"], ["pending", "waiting"], ["skipped", "skipped"], ["na", "skipped"]]);
  const first = rowTasks(plan, rows[0].frow, rows[0].rrow)[0];
  assert.deepStrictEqual([first.values, first.remarks], [{ status: "Done", remarks: "ok" }, "ok"]);
});

test("the sheet's names are matched to users without Sir / Bhai", () => {
  const users = [{ _id: 1, name: "Ayush" }, { _id: 2, name: "Nikunj Patel" }, { _id: 3, name: "Paresh" }];
  assert.deepStrictEqual(["AYUSH SIR", "NIKUNJBHAI", "Paresh Bhai", "Riya"].map((h) => matchUser(h, users)?._id ?? null), [1, 2, 3, null]);
});
