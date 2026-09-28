// FMS engine v2: calendar, conditions, doer lookup and the Repeat Spare Part escalation ladder,
// checked against the dates the real sheet shows.
const test = require("node:test");
const assert = require("node:assert");
const { dayKey } = require("../services/dates");
const { normalizeCalendar, addTatCal } = require("../services/calendar");
const { evaluate, compare } = require("../services/fms/conditions");
const { resolveDoer, directory } = require("../services/fms/doers");
const engine = require("../services/fms/engine");
const { normalizeProcess } = require("../services/fms/definition");
const repeatSpare = require("../templates/repeatSpare");

// IST wall-clock time -> Date
const ist = (y, m, d, hh = 0, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm) - 330 * 60 * 1000);
const istText = (date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(date)
    .replace(",", "");

const cal = normalizeCalendar({ weekOff: [0], start: "09:00", end: "18:00", holidays: ["2026-10-02"] });

test("working calendar: days keep the time of day, skip Sundays and holidays, clamp to working hours", () => {
  const w = (base, tat, unit = "days") => istText(addTatCal(base, tat, unit, cal, "working"));
  assert.strictEqual(w(ist(2026, 9, 10, 14, 30), 1), "11/09 14:30"); // Thu -> Fri
  assert.strictEqual(w(ist(2026, 9, 10, 20, 30), 1), "11/09 18:00"); // after hours counts as 6 PM
  assert.strictEqual(w(ist(2026, 9, 10, 7, 0), 1), "11/09 09:00"); // before hours counts as 9 AM
  assert.strictEqual(w(ist(2026, 9, 12, 11, 0), 1), "14/09 11:00"); // Sat -> Mon
  assert.strictEqual(w(ist(2026, 9, 13, 11, 0), 1), "14/09 18:00"); // made on Sunday -> due Monday
  assert.strictEqual(w(ist(2026, 10, 1, 10, 0), 1), "03/10 10:00"); // Fri 2 Oct is a holiday
  assert.strictEqual(w(ist(2026, 9, 10, 16, 0), 4, "hours"), "11/09 11:00"); // 2 h today + 2 h tomorrow
  assert.strictEqual(w(ist(2026, 9, 12, 20, 0), 2, "hours"), "14/09 11:00"); // over Sunday
  assert.strictEqual(w(ist(2026, 9, 10, 10, 0), 90, "minutes"), "10/09 11:30");
  assert.strictEqual(w(ist(2026, 9, 14, 0, 0), -2), "11/09 09:00"); // T - 2 working days from Monday
});

test("calendar modes: 24x7 like =A8+2, and calendar days that skip Sundays (v1)", () => {
  assert.strictEqual(istText(addTatCal(ist(2026, 9, 12, 10), 2, "days", cal, "calendar")), "14/09 10:00");
  assert.strictEqual(istText(addTatCal(ist(2026, 9, 12, 10), 1, "days", cal, "calendar_skip")), "14/09 10:00");
  assert.strictEqual(istText(addTatCal(ist(2026, 9, 12, 22), 3, "hours", cal, "calendar_skip")), "14/09 01:00");
});

test("conditions: text ignores case and spaces, numbers compare as numbers, groups nest", () => {
  assert.ok(compare(" Permenant  Solved", "=", "permenant solved"));
  assert.ok(compare("3", ">", 2));
  assert.ok(!compare("", ">", 2));
  assert.ok(compare("2026-09-10", "<", "2026-09-11"));
  assert.ok(compare("Coal", "in", "Coal, Colour Chemical"));
  assert.ok(compare(undefined, "empty"));

  const cond = {
    all: [
      { any: [{ src: "field", key: "frq", op: ">", value: 2 }, { src: "field", key: "rate", op: ">", value: 3000 }] },
      { src: "step", step: "s3", key: "status", op: "!=", value: "Permanent Solved" },
    ],
  };
  const ctx = (data, s3) => ({ data, steps: { s3 } });
  assert.strictEqual(evaluate(cond, ctx({ frq: 3, rate: 100 }, { status: "pending" })), true);
  assert.strictEqual(evaluate(cond, ctx({ frq: 1, rate: 5000 }, { status: "done", values: { status: "Permanent Solved" } })), false);
  // three-valued: unknown while step 3 is open, false as soon as the entry fields rule it out
  assert.strictEqual(evaluate(cond, ctx({ frq: 3, rate: 100 }, { status: "pending" }), false), null);
  assert.strictEqual(evaluate(cond, ctx({ frq: 1, rate: 100 }, { status: "pending" }), false), false);
});

const users = [
  "Ankitbhai",
  "Pradeep Bhai",
  "Paresh Bhai",
  "Nikunjbhai",
  "Ayush Sir",
  "Bhaveshbhai",
  "Sunil Singh",
  "Madhukar Luhar",
  "Pradipbhai Bhai Deshmukh",
].map((name, i) => ({ _id: String(i + 1).padStart(24, "0"), name, active: true }));
const dir = directory(users);
const idOf = (name) => users.find((u) => u.name === name)._id;

test("machine-wise doer: machine + item group, spellings, prefix match and fallback", () => {
  const rule = repeatSpare.build(dir).steps[1].doer;
  const who = (machine_no, item_group) => resolveDoer(rule, { machine_no, item_group }, dir);
  assert.strictEqual(who("JET-5", "Mechanical"), idOf("Sunil Singh")); // sheet row says "JET 5"
  assert.strictEqual(who("jet 30", "Electrical"), idOf("Madhukar Luhar"));
  assert.strictEqual(who("STENTER-4", "Electrical"), idOf("Madhukar Luhar")); // row "STENTER"
  assert.strictEqual(who("PRINTING-7", "Mechanical"), idOf("Pradipbhai Bhai Deshmukh")); // row "PRINTING"
  assert.strictEqual(who("JET-45", "Mechanical"), idOf("Pradeep Bhai")); // not in the table -> fallback
  assert.strictEqual(who("JET-12", ""), idOf("Sunil Singh")); // no item group: first row for the machine
  assert.strictEqual(who("JET-12", "Electrical"), idOf("Pradeep Bhai")); // PAPPU BHAI is not a user yet
});

test("computed field and value checks", () => {
  const p = repeatSpare.build(dir);
  const values = engine.computeFields(p.fields, { last_issue_date: "2026-08-20" }, ist(2026, 9, 10, 10));
  assert.strictEqual(values.days_in_diff, 21);

  const fields = p.steps[1].fields;
  assert.throws(() => engine.cleanValues(fields, { status: "Problem Solved" }), /Remarks" is required/);
  assert.deepStrictEqual(engine.cleanValues(fields, { status: " permanent solved ", remarks: "ok", action_taken: "Changed bearing" }), {
    status: "Permanent Solved",
    remarks: "ok",
    action_taken: "Changed bearing",
  });
  assert.throws(() => engine.cleanValues(fields, { status: "Maybe", remarks: "x", action_taken: "y" }), /Choose one of the options/);
  assert.throws(() => engine.cleanValue({ label: "Photo link", type: "link" }, "drive.google.com/x"), /must be a link/);
  assert.strictEqual(engine.cleanValue({ label: "Old part received", type: "yesno" }, "y"), "Yes");
});

// ---- Repeat Spare Part ladder ----

function entry(data, { mode = "working", start = ist(2026, 9, 10, 10, 0) } = {}) {
  const process = normalizeProcess(repeatSpare.build(dir), { activeIds: new Set(users.map((u) => u._id)) });
  process.calendar.mode = mode;
  const job = { startDate: start, data: engine.computeFields(process.fields, data, start) };
  const tasks = Object.fromEntries(process.steps.map((s) => [s.key, { status: "waiting" }]));
  const run = (now) => engine.advance({ process, job, tasks, now, calendar: cal, doerOf: (st, d) => resolveDoer(st.doer, d, dir) });
  const done = (key, now, values) => {
    Object.assign(tasks[key], { status: "done", actual: now, actualDay: dayKey(now), resolvedAt: now, values });
    run(now);
  };
  run(start);
  const days = () => Object.fromEntries(Object.entries(tasks).map(([k, t]) => [k, t.status === "pending" || t.status === "done" ? t.plannedDay : t.status]));
  return { process, job, tasks, run, done, days };
}

const JET30 = { item_name: "Bearing 6205", machine_no: "JET-30", item_group: "Mechanical", last_issue_date: "2026-08-20", rate: 1200 };

test("Repeat Spare, calendar days: the same planned dates as the sheet (10/09 entry, Frq 6)", () => {
  const e = entry({ ...JET30, repeat_frq: 6 }, { mode: "calendar" });
  assert.deepStrictEqual(e.days(), { s1: "2026-09-11", s2: "2026-09-12", s3: "waiting", s4: "waiting", s5: "waiting", s6: "waiting" });
  assert.strictEqual(istText(e.tasks.s3.triggerAt), "13/09 00:00"); // escalates the day after Step 2's planned day
  assert.strictEqual(e.tasks.s2.doer, idOf("Sunil Singh"));
  assert.strictEqual(e.tasks.s1.doer, idOf("Ankitbhai"));

  e.run(ist(2026, 9, 12, 23, 59));
  assert.strictEqual(e.tasks.s3.status, "waiting");
  e.run(ist(2026, 9, 13, 0, 5));
  assert.deepStrictEqual(e.days(), { s1: "2026-09-11", s2: "2026-09-12", s3: "2026-09-14", s4: "waiting", s5: "2026-09-17", s6: "waiting" });
  e.run(ist(2026, 9, 15, 1));
  e.run(ist(2026, 9, 18, 1));
  // S4 16/09 and S5 17/09 as in the sheet; S6 20/09 (the sheet never shows S6 because of its formula bug)
  assert.deepStrictEqual(e.days(), { s1: "2026-09-11", s2: "2026-09-12", s3: "2026-09-14", s4: "2026-09-16", s5: "2026-09-17", s6: "2026-09-20" });
  assert.strictEqual(e.tasks.s5.doer, idOf("Ayush Sir"));
});

test("Repeat Spare, working days: Sundays are not counted", () => {
  const e = entry({ ...JET30, repeat_frq: 6 });
  e.run(ist(2026, 9, 25));
  assert.deepStrictEqual(e.days(), { s1: "2026-09-11", s2: "2026-09-12", s3: "2026-09-15", s4: "2026-09-17", s5: "2026-09-18", s6: "2026-09-22" });
});

test("Repeat Spare, Frq 1 and a cheap part: steps 4-6 are skipped at once, Step 3 still escalates", () => {
  const e = entry({ ...JET30, repeat_frq: 1 }, { mode: "calendar" });
  assert.deepStrictEqual(e.days(), { s1: "2026-09-11", s2: "2026-09-12", s3: "waiting", s4: "skipped", s5: "skipped", s6: "skipped" });
  e.done("s1", ist(2026, 9, 11, 9), { old_part_received: "Yes" });
  e.done("s2", ist(2026, 9, 11, 15), { status: "Problem Solved", remarks: "Temporary fix", action_taken: "Tightened" });
  assert.strictEqual(e.tasks.s3.status, "waiting"); // waits for Step 2's planned day to pass
  e.run(ist(2026, 9, 13, 8));
  // planned from Step 2's actual (11/09 15:00) + 2 days, like IF(Q<>"",Q+2,...)
  assert.strictEqual(istText(e.tasks.s3.planned), "13/09 15:00");
  e.done("s3", ist(2026, 9, 13, 16), { status: "Permanent Solved", remarks: "Replaced shaft", action_taken: "Shaft changed" });
  assert.ok(engine.allResolved(e.tasks));
});

test("Repeat Spare, a part above Rs 3000 reaches Nikunjbhai even at Frq 1", () => {
  const e = entry({ ...JET30, rate: 5000, repeat_frq: 1 }, { mode: "calendar" });
  e.run(ist(2026, 9, 15, 1));
  assert.deepStrictEqual(e.days(), { s1: "2026-09-11", s2: "2026-09-12", s3: "2026-09-14", s4: "2026-09-16", s5: "skipped", s6: "skipped" });
  assert.strictEqual(e.tasks.s4.doer, idOf("Nikunjbhai"));
});

test("Repeat Spare, Permanent Solved at Step 2 ends the ladder", () => {
  const e = entry({ ...JET30, repeat_frq: 6 });
  e.done("s1", ist(2026, 9, 11, 9), {});
  e.done("s2", ist(2026, 9, 11, 12), { status: "Permanent Solved", remarks: "ok", action_taken: "New motor" });
  assert.deepStrictEqual(e.days(), { s1: "2026-09-11", s2: "2026-09-12", s3: "skipped", s4: "skipped", s5: "skipped", s6: "skipped" });
  assert.strictEqual(e.tasks.s3.skipReason, "condition");
  assert.strictEqual(e.tasks.s4.skipReason, "dependency");
  assert.ok(engine.allResolved(e.tasks));
});

test("Repeat Spare: Permanent Solved after the escalation started stops it, like the sheet", () => {
  const e = entry({ ...JET30, repeat_frq: 6 }, { mode: "calendar" });
  e.run(ist(2026, 9, 13, 0, 5));
  assert.strictEqual(e.tasks.s3.status, "pending");
  assert.strictEqual(e.tasks.s5.status, "pending");
  e.done("s1", ist(2026, 9, 13, 9), {});
  e.done("s2", ist(2026, 9, 13, 10), { status: "Permanent Solved", remarks: "late but fixed", action_taken: "New gearbox" });
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(e.tasks).map(([k, t]) => [k, t.skipReason || t.status])),
    { s1: "done", s2: "done", s3: "cancelled", s4: "dependency", s5: "cancelled", s6: "dependency" }
  );
  assert.ok(engine.allResolved(e.tasks));
});

test("Status by PC closes the entry; reopening it restores the steps", () => {
  const e = entry({ ...JET30, repeat_frq: 6 }, { mode: "calendar" });
  const at = ist(2026, 9, 11, 12);
  engine.closeEntry(e.tasks, at);
  e.job.closeStatus = "Permanent Solved";
  e.run(at);
  assert.strictEqual(e.tasks.s1.status, "done");
  assert.ok(e.tasks.s1.autoClosed);
  assert.strictEqual(e.tasks.s3.skipReason, "closed");
  assert.ok(engine.allResolved(e.tasks));

  engine.reopenEntry(e.tasks);
  e.job.closeStatus = null;
  e.run(ist(2026, 9, 13, 1));
  assert.deepStrictEqual(e.days(), { s1: "2026-09-11", s2: "2026-09-12", s3: "2026-09-14", s4: "waiting", s5: "2026-09-17", s6: "waiting" });
});

test("reopen: every later step that depends on a step is found", () => {
  const p = normalizeProcess(repeatSpare.build(dir), { activeIds: new Set(users.map((u) => u._id)) });
  assert.deepStrictEqual([...engine.dependentsOf(p.steps, "s2")].sort(), ["s3", "s4", "s5", "s6"]);
  assert.deepStrictEqual([...engine.dependentsOf(p.steps, "s1")], []);
});

test("builder validation: v1 steps still work, conditions may only look back", () => {
  const ids = new Set(["a".repeat(24), "b".repeat(24)]);
  const v1 = normalizeProcess({ name: "QC", steps: [{ name: "Inspect", doer: "a".repeat(24), tat: 1 }, { name: "Report", doer: "b".repeat(24), tat: 2 }] }, { activeIds: ids });
  assert.deepStrictEqual(v1.steps[1].start, { mode: "afterDone", step: "s1" });
  assert.strictEqual(v1.steps[1].doer.user, "b".repeat(24));

  const bad = {
    name: "X",
    steps: [
      { key: "s1", name: "One", doer: "a".repeat(24), tat: 1, when: { all: [{ src: "step", step: "s2", key: "_status", op: "=", value: "done" }] } },
      { key: "s2", name: "Two", doer: "a".repeat(24), tat: 1 },
    ],
  };
  assert.throws(() => normalizeProcess(bad, { activeIds: ids }), /must refer to a step that comes before it/);
  assert.throws(() => normalizeProcess({ name: "Y", steps: [{ name: "One", tat: 1 }] }, { activeIds: ids }), /Choose a doer/);
  assert.doesNotThrow(() => normalizeProcess({ name: "Y", active: false, steps: [{ name: "One", tat: 1 }] }, { activeIds: ids })); // draft
  assert.throws(() => normalizeProcess({ name: "Z", steps: [{ name: "One", doer: "a".repeat(24), tat: -1 }] }, { activeIds: ids }), /negative/);
});
