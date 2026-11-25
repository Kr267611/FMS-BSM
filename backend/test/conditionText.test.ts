// A step's condition written in plain English / Hinglish becomes the same rule the condition boxes make
import test = require("node:test");
import assert = require("node:assert");
import ct = require("../services/fms/conditionText");
import conditions = require("../services/fms/conditions");
const { conditionFromText } = ct;

const fields = [
  { key: "repeat_frq", label: "Repeat Frq", type: "number" },
  { key: "rate", label: "Rate", type: "number" },
  { key: "pc_status", label: "Status by PC", type: "select", options: ["Solved", "Permanent Solved", "Closed", "Not Required", "READY TO DISPATCH"] },
  { key: "master", label: "Master Name", type: "text" },
  { key: "days", label: "No of Days without program", type: "number" },
  { key: "remarks", label: "Remarks", type: "text" },
  { key: "inward", label: "Inward Date", type: "date" },
  { key: "urgent", label: "Urgent", type: "yesno" },
];
const steps = [
  { key: "s1", no: 1, name: "120 days before", fields: [] },
  { key: "s2", no: 2, name: "Share list with Master", fields: [{ key: "status", label: "Status", type: "select", options: ["MILL A/C", "CLOSED", "CUSTOMER VERIFY"] }, { key: "rem", label: "Remarks", type: "text" }] },
];
const read = (t) => conditionFromText(t, { fields, steps });
const rule = (t) => {
  const r: any = read(t);
  assert.ok(!r.error, `${t} -> ${r.error}`);
  return r.when;
};

test("English: field, comparison, value; and / or", () => {
  assert.deepStrictEqual(rule("only if Repeat Frq more than 1 and Status by PC is not Solved"), {
    all: [
      { src: "field", key: "repeat_frq", op: ">", value: 1 },
      { src: "field", key: "pc_status", op: "!=", value: "Solved" },
    ],
  });
  assert.deepStrictEqual(rule("Rate >= 3000"), { all: [{ src: "field", key: "rate", op: ">=", value: 3000 }] });
  assert.deepStrictEqual(rule("Repeat frq > 2 or Rate > 3000"), { any: [{ src: "field", key: "repeat_frq", op: ">", value: 2 }, { src: "field", key: "rate", op: ">", value: 3000 }] });
  // AND binds first: (A and B) or C
  assert.deepStrictEqual(rule("Repeat frq > 2 and Rate < 100 or Urgent is yes"), {
    any: [{ all: [{ src: "field", key: "repeat_frq", op: ">", value: 2 }, { src: "field", key: "rate", op: "<", value: 100 }] }, { src: "field", key: "urgent", op: "=", value: "Yes" }],
  });
  assert.deepStrictEqual(rule("Remarks is empty"), { all: [{ src: "field", key: "remarks", op: "empty" }] });
  assert.deepStrictEqual(rule("Master Name contains guddu"), { all: [{ src: "field", key: "master", op: "contains", value: "guddu" }] });
  assert.deepStrictEqual(rule("Inward Date before 05/11/2026".replace("before", "<")), { all: [{ src: "field", key: "inward", op: "<", value: "2026-11-05" }] });
});

test("Hinglish: se zyada, na ho, khali, aur; spelling slips; or = aur", () => {
  assert.deepStrictEqual(rule("Repeat freq 1 se zyada ho aur PC status solved na ho"), {
    all: [
      { src: "field", key: "repeat_frq", op: ">", value: 1 },
      { src: "field", key: "pc_status", op: "!=", value: "Solved" },
    ],
  });
  assert.deepStrictEqual(rule("jab No of days without program 120 se jyada ho tabhi chale"), { all: [{ src: "field", key: "days", op: ">", value: 120 }] });
  assert.deepStrictEqual(rule("remarks khali na ho"), { all: [{ src: "field", key: "remarks", op: "notEmpty" }] });
  assert.deepStrictEqual(rule("rate 500 se kam"), { all: [{ src: "field", key: "rate", op: "<", value: 500 }] });
  const r: any = read("Repeat freq 1 se zyada ho or PC status solved na ho");
  assert.strictEqual(r.when.all.length, 2);
  assert.match(r.notes[0], /aur/);
});

test("two values for one field: in / not in, and options kept whole", () => {
  assert.deepStrictEqual(rule("Status by PC is not Solved or Closed"), { all: [{ src: "field", key: "pc_status", op: "notIn", value: "Solved,Closed" }] });
  assert.deepStrictEqual(rule("PC status solved ya closed na ho"), { all: [{ src: "field", key: "pc_status", op: "notIn", value: "Solved,Closed" }] });
  assert.deepStrictEqual(rule("PC status solved ya closed ho"), { all: [{ src: "field", key: "pc_status", op: "in", value: "Solved,Closed" }] });
  assert.deepStrictEqual(rule("Status by PC is Not Required"), { all: [{ src: "field", key: "pc_status", op: "=", value: "Not Required" }] });
  assert.deepStrictEqual(rule("Status by PC is not Not Required"), { all: [{ src: "field", key: "pc_status", op: "!=", value: "Not Required" }] });
  assert.deepStrictEqual(rule("Status by PC is READY TO DISPATCH"), { all: [{ src: "field", key: "pc_status", op: "=", value: "READY TO DISPATCH" }] });
  assert.deepStrictEqual(rule("Status by PC is permanent solved"), { all: [{ src: "field", key: "pc_status", op: "=", value: "Permanent Solved" }] });
});

test("an earlier step: its box, or the step done / not done", () => {
  assert.deepStrictEqual(rule("step 2 status MILL A/C ho"), { all: [{ src: "step", step: "s2", key: "status", op: "=", value: "MILL A/C" }] });
  assert.deepStrictEqual(rule("stage 2 ka status customer verify hai"), { all: [{ src: "step", step: "s2", key: "status", op: "=", value: "CUSTOMER VERIFY" }] });
  assert.deepStrictEqual(rule("step 1 done"), { all: [{ src: "step", step: "s1", key: "_status", op: "=", value: "done" }] });
  assert.deepStrictEqual(rule("step 1 nahi hua"), { all: [{ src: "step", step: "s1", key: "_status", op: "!=", value: "done" }] });
  assert.deepStrictEqual(rule("step 2 remarks khali na ho"), { all: [{ src: "step", step: "s2", key: "rem", op: "notEmpty" }] });
});

test("what cannot be read is said back, never guessed", () => {
  assert.match((read("step 5 done") as any).error, /Step 5 is not a step before this one/);
  assert.match((read("Status by PC is Pending") as any).error, /not an option of "Status by PC".*Solved/);
  assert.match((read("Rate more than abc") as any).error, /number/);
  assert.match((read("colour is red") as any).error, /Could not find|which field/);
  assert.match((read("") as any).error, /Write when/);
  assert.match((read("step 2 status MILL") as any).error || "", /^$/); // "MILL" is the start of one option only: MILL A/C
});

test("the rule it makes runs in the engine as written", () => {
  const when = rule("Repeat freq 1 se zyada ho aur PC status solved ya closed na ho");
  assert.strictEqual(conditions.evaluate(when, { data: { repeat_frq: 3, pc_status: "Permanent Solved" } }), true);
  assert.strictEqual(conditions.evaluate(when, { data: { repeat_frq: 3, pc_status: "closed" } }), false);
  assert.strictEqual(conditions.evaluate(when, { data: { repeat_frq: 1, pc_status: "" } }), false);
});
