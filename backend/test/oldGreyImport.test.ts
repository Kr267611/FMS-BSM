// Google Sheet FMS import of "FMS_Old_Grey_to_Program": the header block (What / Who / How / TAT row), the
// Rules tab that turns each stage's Status into the next stage, =DATE(…,5), WORKDAY.INTL, a stage after one of two
// stages and the 30-day escalation – read from the sheet's real header and formulas (the data rows are made up).
import test = require("node:test");
import assert = require("node:assert");
import sheetFmsLib = require("../services/sheetFms");
const { planFms, applyFormulas, entryRows, definition, settleRows, matchUser, userCandidates } = sheetFmsLib;
import sheetInspectLib = require("../services/sheetInspect");
const { colLetter } = sheetInspectLib;
import definitionLib = require("../services/fms/definition");
const { normalizeProcess } = definitionLib;
import calendarLib = require("../services/calendar");
const { normalizeCalendar } = calendarLib;
import F = require("../services/sheetFormula");
import D = require("../services/sheetDoers");
import doersLib = require("../services/fms/doers");
const { resolveDoer, directory } = doersLib;

const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const row = (cells) => {
  const out = [];
  for (const [c, v] of Object.entries(cells)) out[colIndex(c)] = v;
  return Array.from(out, (v) => v ?? "");
};
const STAGES = ["W", "AC", "AI", "AP", "AV", "BB", "BH", "BN"];
const each = (vals) => Object.fromEntries(STAGES.map((c, i) => [c, vals[i]]));

// ---- the header rows, as the sheet shows them ----
const ENTRY_HEAD = ["Date", "No of Days without program", "Master Name", "Party Markha", "Party Name", "Inward Date", "Lot number", "Quality", "Total Taka", "Total Lot Meter", "Bal Taka", "METER", "Outward Taka", "Run Bal", "Lot Count", "LOCATION FINDING (CRM - HELP OF CHHOTAN)", "Location", "Remarks", "Final Status", "Dispatch Date", "Lot no", "Duplicate?"];
const BLOCK = ["Plan", "Actual", "Status", "Next Stage", "Delay", "Remark"];
// Each stage block: Plan, Actual, Status, Next Stage, Delay, Remark; Stage 3 (AI..AO) has a seventh, Photo Link
const headCells: Record<string, string> = Object.fromEntries(ENTRY_HEAD.map((h, i) => [colLetter(i), h]));
for (const c of STAGES) BLOCK.forEach((h, k) => (headCells[colLetter(colIndex(c) + k)] = h));
headCells.AO = "Photo Link";
const header = row(headCells);
const top = [
  row({ A: "24/11/2026 23:03", C: "FMS – Old Grey to Program (120+ days grey without program)", ...each(STAGES.map((_, i) => `Stage ${i + 1}`)) }),
  row({
    A: "What",
    B: "120 days before wala grey without  Program List",
    ...each([
      "120 days before wala grey stock from Decent Software",
      "Share list with Master - What to do with Grey taka",
      "Customer se verification karke final decision - Letter signing / GR / Claim (grey age above 150 days)",
      "GR / Take grey in Mill A/C register / Adjustment with other party or quality",
      "Help Ticket - Solve Chhotan problem",
      "Take grey in Mill A/C register",
      "Make entry in Decent Software",
      "Help Ticket - Chhotan ka plan 30 days se upar ho to",
    ]),
  }),
  row({ A: "Who", B: "PC", ...each(["Jyoti", "Master", "CRR", "Chhotan", "Mukesh / Vinod", "Chhotan", "Mahesh (Excise)", "Mukesh / Vinod"]) }),
  row({ A: "How", B: "To Take ERP Data", ...each(["ERP (Decent Software) se report nikal ke Lead Data me paste", "-", "Take print out, take Master, CRR & Customer sign", "First check Master + Client sign for GR", "-", "-", "-", "Auto: S4 Plan ke 30 din baad bhi S4 pending / late ho to khulega"]) }),
  row(each(["5th of month", "15", "15", "10", "7", "10", "2", "7"])),
  header,
];
const topF = [row({ A: "=NOW()" })];

// ---- the formulas of every data row ({r} = the row) ----
const nextStage = (status, stage) => `=IF(TRIM(${status}{r})="","",IFERROR(INDEX(Rules!$D:$D,MATCH("S${stage}|"&TRIM(${status}{r}),Rules!$A:$A,0)),"CHECK STATUS"))`;
const FORMULAS = {
  B: '=IF(F{r}="","",TODAY()-F{r})',
  S: '=IF(A{r}="","",IF(ISNUMBER(SEARCH("CLOSED",Z{r})),"CLOSED at S1 - "&Y{r},IF(AND(N(W{r})>0,N(X{r})=0),"S1 pending - Jyoti","Check")))',
  W: '=IF(A{r}="","",DATE(YEAR(A{r}),MONTH(A{r}),5))',
  X: '=IF(N(W{r})=0,"",IF(TRIM(Y{r})="","",IF(N(X{r})>0,X{r},$A$1)))',
  Z: nextStage("Y", 1),
  AC: '=IF(N(Z{r})=2,WORKDAY.INTL(X{r},$AC$5,"0000001"),"")',
  AF: nextStage("AE", 2),
  AI: '=IF(N(AF{r})=3,WORKDAY.INTL(AD{r},$AI$5,"0000001"),"")',
  AL: nextStage("AK", 3),
  AP: '=IF(N(AL{r})=4,WORKDAY.INTL(AJ{r},$AP$5,"0000001"),"")',
  AS: nextStage("AR", 4),
  AV: '=IF(N(AS{r})=5,WORKDAY.INTL(AQ{r},$AV$5,"0000001"),"")',
  AY: nextStage("AX", 5),
  BB: '=IF(N(AS{r})=6,WORKDAY.INTL(AQ{r},$BB$5,"0000001"),"")',
  BE: nextStage("BD", 6),
  BH: '=IF(N(AY{r})=7,WORKDAY.INTL(AW{r},$BH$5,"0000001"),IF(N(BE{r})=7,WORKDAY.INTL(BC{r},$BH$5,"0000001"),""))',
  BK: nextStage("BJ", 7),
  BN: '=IF(N(AP{r})=0,"",IF(INT(IF(N(AQ{r})=0,TODAY(),AQ{r}))>AP{r}+Rules!$G$2,WORKDAY.INTL(AP{r}+Rules!$G$2,$BN$5,"0000001"),""))',
  BQ: nextStage("BP", 8),
};

// The Rules tab: "S2|GR" -> stage 3, "S2|PAYMENT ISSUE" -> CLOSED; G2 = the escalation days
const RULES = [
  ["S1", "Done", "2"],
  ["S2", "GR", "3"],
  ["S2", "MISSING", "3"],
  ["S2", "DAMAGED", "3"],
  ["S2", "PRG BAL", "3"],
  ["S2", "PAYMENT ISSUE", "CLOSED"],
  ["S2", "UNDERLOT", "CLOSED"],
  ["S2", "MILL A/C", "3"],
  ["S3", "LETTER SIGNED BY CUSTOMER", "CLOSED WITH PHOTO ATTACHMENT"],
  ["S3", "GR", "4"],
  ["S3", "CLAIM APPROVED BY MD", "CLOSED WITH PHOTO ATTACHMENT"],
  ["S3", "ADJUST", "4"],
  ["S3", "MILL AC", "4"],
  ["S4", "DONE", "CLOSED (ONLY AFTER GR IN SOFTWARE)"],
  ["S4", "HELP TICKET", "5"],
  ["S4", "MILL AC", "6"],
  ["S5", "SOLVED", "7"],
  ["S6", "DONE", "7"],
  ["S7", "DONE", "CLOSED"],
  ["S8", "SOLVED", "4"],
];
const ext = {
  Rules: [
    ["Key (auto)", "Stage", "Status", "Stage Move To", "", "Setting", "Value"],
    ...RULES.map(([s, st, to], i) => [`${s}|${st}`, s, st, to, "", i === 0 ? "S8 escalation: S4 Plan ke kitne din baad (days)" : "", i === 0 ? "30" : ""]),
  ],
};

// ---- three made-up entries ----
const ENTRIES = [
  { A: "05/11/2026", C: "AVINASH MASTER", G: "21466", W: "05/11/2026", X: "10/11/2026 10:00", Y: "Done", Z: "2", AC: "27/11/2026" }, // S2 open
  { A: "05/11/2026", C: "RAJESH MASTER", G: "21467", W: "05/11/2026" }, // S1 open
  { A: "05/11/2026", C: "AVINASH MASTER", G: "21468", W: "05/11/2026", X: "06/11/2026 09:00", Y: "Done", Z: "2", AC: "24/11/2026", AD: "20/11/2026 12:00", AE: "PAYMENT ISSUE", AF: "CLOSED" },
];
const fmt = ENTRIES.map(row);
const raw = fmt;
const rowsF = ENTRIES.map((_, i) => row(Object.fromEntries(Object.entries(FORMULAS).map(([c, f]) => [c, f.replace(/\{r\}/g, String(7 + i))]))));

const plan = applyFormulas(planFms(top, fmt, raw), top, topF, rowsF, ext);
const byKey = Object.fromEntries(plan.steps.map((s) => [s.key, s]));

test("each step's name, doer, How and TAT come from the What / Who / How / TAT rows", () => {
  assert.strictEqual(plan.firstDataRow, 7);
  assert.deepStrictEqual(
    plan.steps.map((s) => [s.plannedCol, s.actualCol, s.doerHint, s.tat]),
    [
      ["W", "X", "Jyoti", 0],
      ["AC", "AD", "Master", 15],
      ["AI", "AJ", "CRR", 15],
      ["AP", "AQ", "Chhotan", 10],
      ["AV", "AW", "Mukesh / Vinod", 7],
      ["BB", "BC", "Chhotan", 10],
      ["BH", "BI", "Mahesh (Excise)", 2],
      ["BN", "BO", "Mukesh / Vinod", 7],
    ]
  );
  assert.strictEqual(byKey.s1.name, "120 days before wala grey stock from Decent Software");
  assert.strictEqual(byKey.s2.name, "Share list with Master - What to do with Grey taka");
  assert.strictEqual(byKey.s1.how, "ERP (Decent Software) se report nikal ke Lead Data me paste");
  assert.strictEqual(byKey.s2.how, ""); // "-" in the sheet
  assert.strictEqual(byKey.s1.when, "5th of month");
});

test("Next Stage is worked out from the Rules tab, so the doer only picks the Status (every status the Rules tab knows)", () => {
  assert.deepStrictEqual(byKey.s1.fields.map((f) => f.label), ["Status", "Remark"]);
  assert.deepStrictEqual(byKey.s3.fields.map((f) => f.label), ["Status", "Remark", "Photo Link"]);
  const status = byKey.s2.fields.find((f) => f.key === "status");
  assert.strictEqual(status.type, "select");
  assert.deepStrictEqual(status.options, ["GR", "MISSING", "DAMAGED", "PRG BAL", "PAYMENT ISSUE", "UNDERLOT", "MILL A/C"]);
  assert.deepStrictEqual(byKey.s2.routes.map((r) => [r.col, r.tab, r.map.length]), [["AF", "Rules", 7]]);
});

test("every stage gets its rule from the sheet's formula", () => {
  const rule = (k) => byKey[k].rule;
  const route = (step, value) => ({ all: [{ src: "step", step, key: "status", op: "in", value }] });
  assert.deepStrictEqual(rule("s1"), { start: { mode: "entry" }, plan: { from: "monthDay", day: 5 } });
  assert.deepStrictEqual(rule("s2"), { start: { mode: "afterDone", step: "s1" }, plan: { from: "stepActual", step: "s1" }, when: route("s1", "Done") });
  assert.deepStrictEqual(rule("s3").when, route("s2", "GR,MISSING,DAMAGED,PRG BAL,MILL A/C"));
  assert.deepStrictEqual(rule("s4").when, route("s3", "GR,ADJUST,MILL AC"));
  assert.deepStrictEqual(rule("s5").when, route("s4", "HELP TICKET"));
  assert.deepStrictEqual(rule("s6"), { start: { mode: "afterDone", step: "s4" }, plan: { from: "stepActual", step: "s4" }, when: route("s4", "MILL AC") });
  assert.deepStrictEqual(rule("s7"), {
    start: { mode: "afterDone", step: "s5", also: ["s6"] },
    plan: { from: "stepActual", step: "s5" },
    when: { all: [{ any: [{ src: "step", step: "s5", key: "status", op: "in", value: "SOLVED" }, { src: "step", step: "s6", key: "status", op: "in", value: "DONE" }] }] },
  });
  assert.deepStrictEqual(rule("s8"), { start: { mode: "afterDue", step: "s4", days: 30, ifLate: true }, plan: { from: "stepPlanned", step: "s4", offset: 30 } });
  assert.deepStrictEqual(plan.steps.map((s) => s.tat), [0, 15, 15, 10, 7, 10, 2, 7]);
  assert.strictEqual(plan.calendar, "working"); // WORKDAY.INTL: Sundays off
  assert.ok(plan.steps.every((s) => s.rule), "no stage is left without a rule");
});

test("the entries come in as in the sheet; a CLOSED status closes the entry", () => {
  const def = normalizeProcess({ ...definition(plan, "FMS", { name: "Old Grey" }), active: false });
  assert.strictEqual(def.steps[0].how, "ERP (Decent Software) se report nikal ke Lead Data me paste");
  const rows = entryRows(plan, fmt, raw);
  assert.deepStrictEqual(rows.map((r) => r.sheetRow), [7, 8, 9]);
  const cal = normalizeCalendar({ weekOff: [0], start: "09:00", end: "18:00", holidays: [] });
  const now = new Date("2026-11-25T12:00:00+05:30");
  const { rows: out } = settleRows({ process: def, rows, plan, now, calendar: cal });
  const view = (r) => Object.fromEntries(Object.entries<any>(r.tasks).map(([k, t]) => [k, t.status === "skipped" ? `skipped:${t.skipReason}` : t.status]));
  assert.deepStrictEqual(view(out[0]), { s1: "done", s2: "pending", s3: "waiting", s4: "waiting", s5: "waiting", s6: "waiting", s7: "waiting", s8: "waiting" });
  assert.strictEqual(out[0].tasks.s1.values.status, "Done");
  assert.strictEqual(out[0].tasks.s2.plannedDay, "2026-11-27");
  assert.deepStrictEqual(view(out[1]).s1, "pending");
  assert.deepStrictEqual(view(out[2]), { s1: "done", s2: "done", s3: "skipped:condition", s4: "skipped:condition", s5: "skipped:condition", s6: "skipped:condition", s7: "skipped:condition", s8: "skipped:dependency" });
  assert.deepStrictEqual(out.map((r) => r.open), [true, true, false]);
});

test("the entry form: Final Status (worked out from the steps) is left out; a dropdown lists every value of the column", () => {
  assert.ok(!plan.fields.some((f) => f.label === "Final Status"));
  assert.deepStrictEqual(plan.fromSteps, [{ col: "S", label: "Final Status" }]);
  assert.ok(plan.fields.some((f) => f.label === "No of Days without program" && f.sheetFormula));
  // 450 rows: the master named only after the first 400 rows is in the list too
  // ("4" pasted into Master Name on a few rows is not a choice)
  const many = Array.from({ length: 450 }, (_, i) => row({ A: "05/11/2026", C: i === 449 ? "YOGESH MASTER" : i < 3 ? "4" : i % 2 ? "AVINASH MASTER" : "MANISH MASTER", G: String(30000 + i) }));
  const master = planFms(top, many, many).fields.find((f) => f.label === "Master Name");
  assert.deepStrictEqual([master.type, master.options], ["select", ["AVINASH MASTER", "MANISH MASTER", "YOGESH MASTER"]]);
});

test("numbers in the Master Name column are not people: left out of the names, their entries go to the Otherwise doer", () => {
  const rows = [{ data: { master_name: "AVINASH MASTER" } }, { data: { master_name: "4" } }, { data: { master_name: "4" } }, { data: { master_name: "11.0" } }, { data: { master_name: "PAPPU MASTER" } }];
  const src = { type: "field", field: "master_name" };
  assert.deepStrictEqual([...D.namesOf(src, rows, []).keys()], ["AVINASH MASTER", "PAPPU MASTER"]);
  assert.deepStrictEqual([...D.notNamesOf(src, rows).entries()], [["4", 2], ["11.0", 1]]);
  const rule = D.doerRule(src, { fallback: "fallbackUser", people: { "AVINASH MASTER": "avinashUser" }, rows });
  assert.deepStrictEqual(rule.map.map((r) => r.match[0]), ["AVINASH MASTER", "PAPPU MASTER"]);
  assert.strictEqual(rule.fallback, "fallbackUser");
  // later too: any number in Master Name (5, 6, 11…) gives the step to the Otherwise doer
  const ids = ["a1a1a1a1a1a1a1a1a1a1a1a1", "f0f0f0f0f0f0f0f0f0f0f0f0"];
  const dir = directory([{ _id: ids[0], name: "Avinash", active: true }, { _id: ids[1], name: "Jyoti", active: true }]);
  const live = { mode: "map", keys: ["master_name"], map: [{ match: ["AVINASH MASTER"], user: ids[0] }], fallback: ids[1] };
  assert.deepStrictEqual(["AVINASH MASTER", "5", "6", "11", "4.0"].map((m) => resolveDoer(live, { master_name: m }, dir)), [ids[0], ids[1], ids[1], ids[1], ids[1]]);
});

test("a step with its own table: Master Name gives S2 to the master, and S5 to Mukesh or Vinod by master", () => {
  const ids = { avinash: "a1a1a1a1a1a1a1a1a1a1a1a1", rajesh: "b2b2b2b2b2b2b2b2b2b2b2b2", mukesh: "c3c3c3c3c3c3c3c3c3c3c3c3", vinod: "d4d4d4d4d4d4d4d4d4d4d4d4", jyoti: "e5e5e5e5e5e5e5e5e5e5e5e5" };
  const rows = entryRows(plan, fmt, raw); // masters: AVINASH (rows 7, 9), RAJESH (row 8)
  const body = {
    name: "Old Grey",
    people: { "AVINASH MASTER": ids.avinash, "RAJESH MASTER": ids.rajesh }, // the shared table: S2's doers
    steps: {
      s2: { source: { type: "field", field: "master_name" }, doer: ids.jyoti },
      s5: { source: { type: "field", field: "master_name" }, doer: ids.mukesh, people: { "AVINASH MASTER": ids.vinod, "RAJESH MASTER": ids.mukesh } },
    },
  };
  const def = normalizeProcess({ ...definition(plan, "FMS", body, { rows }), active: false }, { activeIds: new Set<any>(Object.values(ids)) });
  const dir = directory(Object.values(ids).map((id) => ({ _id: id, name: id, active: true })));
  const doerOf = (key, master) => resolveDoer(def.steps.find((s) => s.key === key).doer, { master_name: master }, dir);
  assert.deepStrictEqual([doerOf("s2", "AVINASH MASTER"), doerOf("s2", "RAJESH MASTER")], [ids.avinash, ids.rajesh]);
  assert.deepStrictEqual([doerOf("s5", "AVINASH MASTER"), doerOf("s5", "RAJESH MASTER"), doerOf("s5", "4")], [ids.vinod, ids.mukesh, ids.mukesh]);
});

test("a sheet name like AVINASH MASTER finds the user of that department", () => {
  const users = [
    { _id: 1, name: "Vinayprakash Ramujageer Singh", department: { name: "AVINASH MASTER" } },
    { _id: 2, name: "Shashinath Ramprsad Thakur", department: { name: "BABLU MASTER" } },
    { _id: 3, name: "Jyoti Sharma", department: { name: "MIS" } },
  ];
  assert.deepStrictEqual(["AVINASH MASTER", "Bablu Master", "Jyoti", "CRR"].map((h) => matchUser(h, users)?._id ?? null), [1, 2, 3, null]);
});

test("the Who of a step becomes its doer: brackets, part of a name, two people, two users of one name", () => {
  const users = [
    { _id: 1, name: "Jyoti Sharma", department: { name: "MIS" } },
    { _id: 2, name: "Mahesh Patel", department: { name: "EXCISE" } },
    { _id: 3, name: "Mahesh Kumar", department: { name: "DYEING" } },
    { _id: 4, name: "Vinod Ramprasad Patel", department: { name: "PRINTING" } },
    { _id: 5, name: "Vinod Vedpal Singh Bhalothia", department: { name: "DYEING" } },
    { _id: 6, name: "Mukesh Yadav", department: { name: "QC" } },
    { _id: 7, name: "Chhotan", department: { name: "CRM" } },
  ];
  const one = (h) => matchUser(h, users)?._id ?? null;
  const ids = (h) => userCandidates(h, users).map((u) => u._id);
  assert.strictEqual(one("Jyoti"), 1);
  assert.strictEqual(one("Chhotan"), 7);
  assert.strictEqual(one("Mahesh (Excise)"), 2); // two Maheshes: the one in Excise
  assert.strictEqual(one("Vinod Patel"), 4); // every word of the name is in "Vinod Ramprasad Patel"
  assert.strictEqual(one("Vinod"), null); // two Vinods: the page asks which
  assert.deepStrictEqual(ids("Vinod"), [4, 5]);
  assert.deepStrictEqual(ids("Mukesh / Vinod"), [6, 4, 5]); // two people: pick one of them
  assert.strictEqual(one("Mukesh / Vinod"), null);
  assert.deepStrictEqual(ids("Riya"), []);
});

test("formula reading: other tabs, N() / TRIM() / INT(), and the tabs a formula reads", () => {
  assert.deepStrictEqual(F.tabsIn(`=SUMIF('Daily Outward'!E:E,G7,'Daily Outward'!Q:Q)+Rules!$G$2`), ["Daily Outward", "Rules"]);
  assert.deepStrictEqual(F.routeOf(F.parseCommon(FORMULAS.Z)), { tab: "Rules", keyCol: "A", valueCol: "D", prefix: "S1|", inputCol: "Y" });
  assert.ok(F.sameValue("2", 2) && F.sameValue(" done", "Done") && !F.sameValue("CLOSED", "2"));
  // row 7's own formula: the 7s of N(AY7) and A7 are the row; "=7" (stage 7) and "S7|" are not
  assert.strictEqual(F.commonFormula(['=IF(N(AY7)=7,"S7|"&$A$7&A7,"")'], 7), '=IF(N(AY{r})=7,"S7|"&$A$7&A{r},"")');
  const only = [...rowsF[0]];
  const plan1 = applyFormulas(planFms(top, fmt.slice(0, 1), raw.slice(0, 1)), top, topF, [only], ext);
  assert.deepStrictEqual(plan1.steps[6].rule.when.all[0].any.map((r) => r.value), ["SOLVED", "DONE"]);
});
