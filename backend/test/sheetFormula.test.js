// Sheet formulas -> step rules, with the real formulas of "Repeat Spare part DAILY FMS" (tab SPARE PART)
const test = require("node:test");
const assert = require("node:assert");
const { parseCommon, translate, fieldFormula, closureColumn, commonFormula } = require("../services/sheetFormula");

const cols = {
  A: { kind: "entryDate", key: "date" },
  E: { kind: "field", key: "last_issue_date", date: true },
  F: { kind: "field", key: "rate" },
  I: { kind: "field", key: "repeat_frq" },
  J: { kind: "field", key: "status_by_pc" },
  K: { kind: "planned", step: "s1" },
  L: { kind: "actual", step: "s1" },
  N: { kind: "stepField", step: "s1", key: "yes_no" },
  P: { kind: "planned", step: "s2" },
  Q: { kind: "actual", step: "s2" },
  S: { kind: "stepField", step: "s2", key: "status" },
  V: { kind: "planned", step: "s3" },
  W: { kind: "actual", step: "s3" },
  AB: { kind: "planned", step: "s4" },
  AC: { kind: "actual", step: "s4" },
  AE: { kind: "stepField", step: "s4", key: "status" },
  AH: { kind: "planned", step: "s5" },
  AM: { kind: "planned", step: "s6" },
};
const HEAD = { K5: 1, P5: 2, V5: 2, AB5: 2, AH5: 3, AM5: 3, B1: 0.375 };
const ctx = { cols, head: (c, r) => HEAD[`${c}${r}`], isToday: (c, r) => c === "A" && r === 1, dataRow: 100000 };
const rule = (f) => translate(parseCommon(f), ctx);

test("step 1: entry + 1 day in working hours", () => {
  const r = rule('=if(A{r},if(and(hour(A{r}+K$5)>9,(hour(A{r}+K$5)<18)),A{r}+K$5,workday.intl(int(A{r}),1,"0000001")+hour(A{r}+K$5-$B$1)/24+minute(A{r})/1440),"")');
  assert.deepStrictEqual([r.start, r.plan, r.tat, r.working, r.when], [{ mode: "entry" }, { from: "entry" }, 1, true, undefined]);
});

test("step 2: entry + 2 days, next to step 1", () => {
  const r = rule('=if(A{r},A{r}+2,"")');
  assert.deepStrictEqual([r.start, r.plan, r.tat, r.working], [{ mode: "entry" }, { from: "entry" }, 2, false]);
});

test("step 3: escalation the day after step 2's planned date, unless step 2 is permanently solved", () => {
  const r = rule('=IF(OR(S{r}=" Permenant Solved",P{r}=""),"",IF($A$1-P{r}>0,IF(Q{r}<>"",(Q{r}+$V$5),P{r}+2),""))');
  assert.deepStrictEqual(r.start, { mode: "afterDue", step: "s2" });
  assert.deepStrictEqual(r.plan, { from: "stepActualOrPlanned", step: "s2" });
  assert.strictEqual(r.tat, 2);
  assert.deepStrictEqual(r.when, { all: [{ src: "step", step: "s2", key: "status", op: "!=", value: " Permenant Solved" }] });
});

test("step 4: repeated more than twice or costly, after step 3's planned date", () => {
  const r = rule('=IF(V{r}="","",IF(OR(I{r}>2,F{r}>3000),IF($A$1-V{r}>0,V{r}+$AB$5,""),""))');
  assert.deepStrictEqual([r.start, r.plan, r.tat], [{ mode: "afterDue", step: "s3" }, { from: "stepPlanned", step: "s3" }, 2]);
  assert.deepStrictEqual(r.when, {
    all: [{ any: [{ src: "field", key: "repeat_frq", op: ">", value: 2 }, { src: "field", key: "rate", op: ">", value: 3000 }] }],
  });
});

test("step 5: with step 3, only when repeated 3 or more times", () => {
  const r = rule('=IF(OR(I{r}="",V{r}=""),"",IF(I{r}>=3,V{r}+$AH$5,""))');
  assert.deepStrictEqual([r.start, r.plan, r.tat], [{ mode: "withStart", step: "s3" }, { from: "stepPlanned", step: "s3" }, 3]);
  assert.deepStrictEqual(r.when, {
    all: [{ src: "field", key: "repeat_frq", op: "notEmpty" }, { src: "field", key: "repeat_frq", op: ">=", value: 3 }],
  });
});

test("step 6: after step 4's planned date, from its actual (or planned while open)", () => {
  const r = rule('=IF(OR(AE{r}="Permenant Solved",AB{r}=""),"",IF($A$1-AB{r}>0,AC{r}+$AB$5,""))');
  assert.deepStrictEqual([r.start, r.plan, r.tat], [{ mode: "afterDue", step: "s4" }, { from: "stepActualOrPlanned", step: "s4" }, 2]);
  assert.strictEqual(r.notes.length, 1);
});

test("Days in Diff, Status by PC and the common formula of a column", () => {
  assert.deepStrictEqual(fieldFormula(parseCommon("=A{r}-E{r}"), ctx), { op: "days", a: "last_issue_date", b: "@entry" });
  assert.strictEqual(closureColumn(parseCommon('=if(L{r},L{r},IF(J{r}<>"",$A$1,if(N{r}<>"","","")))'), ctx), "J");
  assert.strictEqual(closureColumn(parseCommon('=if(L{r},L{r},if(N{r}<>"",$A$1,""))'), ctx), null);
  assert.strictEqual(commonFormula(["=A8+2", "=A9+2", "=A10+3", "", 5], 8), "=A{r}+2");
});
