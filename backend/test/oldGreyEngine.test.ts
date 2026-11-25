// FMS engine: a status-routed FMS like "Old Grey to Program" (each stage's Status picks the next stage, as the
// sheet's Rules tab does), a fixed day of the month, a stage after one of two stages, and an escalation that
// opens only when a stage is still not done 30 days after its planned day.
import test = require("node:test");
import assert = require("node:assert");
import datesLib = require("../services/dates");
const { dayKey } = datesLib;
import calendarLib = require("../services/calendar");
const { normalizeCalendar } = calendarLib;
import engine = require("../services/fms/engine");
import definitionLib = require("../services/fms/definition");
const { normalizeProcess } = definitionLib;
import Process = require("../models/Process");

const ist = (y, m, d, hh = 0, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm) - 330 * 60 * 1000);
const cal = normalizeCalendar({ weekOff: [0], start: "09:00", end: "18:00", holidays: [] });

const status = (options) => [{ key: "status", label: "Status", type: "select", options }];
const route = (step, list) => ({ all: [{ src: "step", step, key: "status", op: "in", value: list }] });

// The FMS as the import makes it from the sheet
const body = {
  name: "Old Grey to Program",
  active: false, // a draft: no doers needed for this test
  calendar: { mode: "working" },
  fields: [
    { key: "date", label: "Date", type: "date" },
    { key: "master_name", label: "Master Name", type: "text" },
  ],
  steps: [
    { key: "s1", name: "120 days grey stock", start: { mode: "entry" }, plan: { from: "monthDay", day: 5 }, tat: 0, fields: status(["Done"]) },
    { key: "s2", name: "Share list with Master", start: { mode: "afterDone", step: "s1" }, when: route("s1", "Done"), tat: 15, fields: status(["GR", "MISSING", "DAMAGED", "PRG BAL", "PAYMENT ISSUE", "UNDERLOT", "MILL A/C"]) },
    { key: "s3", name: "Customer verification", start: { mode: "afterDone", step: "s2" }, when: route("s2", "GR,MISSING,DAMAGED,PRG BAL,MILL A/C"), tat: 15, fields: status(["LETTER SIGNED BY CUSTOMER", "GR", "CLAIM APPROVED BY MD", "ADJUST", "MILL AC"]) },
    { key: "s4", name: "GR / Mill A/C", start: { mode: "afterDone", step: "s3" }, when: route("s3", "GR,ADJUST,MILL AC"), tat: 10, fields: status(["DONE", "HELP TICKET", "MILL AC"]) },
    { key: "s5", name: "Help Ticket", start: { mode: "afterDone", step: "s4" }, when: route("s4", "HELP TICKET"), tat: 7, fields: status(["SOLVED"]) },
    { key: "s6", name: "Mill A/C register", start: { mode: "afterDone", step: "s4" }, when: route("s4", "MILL AC"), tat: 10, fields: status(["DONE"]) },
    {
      key: "s7",
      name: "Entry in Decent Software",
      start: { mode: "afterDone", step: "s5", also: ["s6"] },
      when: { any: [{ src: "step", step: "s5", key: "status", op: "in", value: "SOLVED" }, { src: "step", step: "s6", key: "status", op: "in", value: "DONE" }] },
      tat: 2,
      fields: status(["DONE"]),
    },
    { key: "s8", name: "Escalation", start: { mode: "afterDue", step: "s4", days: 30, ifLate: true }, plan: { from: "stepPlanned", step: "s4", offset: 30 }, tat: 7, fields: status(["SOLVED"]) },
  ],
};
const process = normalizeProcess(body);

function entry(day) {
  const start = new Date(`${day}T00:00:00+05:30`);
  const job: Record<string, any> = { startDate: start, data: { date: day, master_name: "AVINASH MASTER" } };
  const tasks = Object.fromEntries(process.steps.map((s) => [s.key, { status: "waiting" }]));
  const run = (now) => engine.advance({ process, job, tasks, now, calendar: cal });
  const done = (key, now, value) => {
    Object.assign(tasks[key], { status: "done", actual: now, actualDay: dayKey(now), resolvedAt: now, values: { status: value } });
    run(now);
  };
  const view = () => Object.fromEntries(Object.entries<any>(tasks).map(([k, t]) => [k, t.status === "pending" || t.status === "done" ? t.plannedDay : t.skipReason || t.status]));
  return { job, tasks, run, done, view };
}

test("the definition keeps the new rules, and the database keeps them too", () => {
  assert.deepStrictEqual(process.steps[0].plan, { from: "monthDay", day: 5 });
  assert.deepStrictEqual(process.steps[6].start, { mode: "afterDone", step: "s5", also: ["s6"] });
  assert.deepStrictEqual(process.steps[7].start, { mode: "afterDue", step: "s4", days: 30, ifLate: true });
  assert.deepStrictEqual(process.steps[7].plan, { from: "stepPlanned", step: "s4", offset: 30 });
  const saved = new Process(process).toObject();
  assert.deepStrictEqual(saved.steps[0].plan, { from: "monthDay", day: 5 });
  assert.deepStrictEqual([saved.steps[6].start.also, saved.steps[7].start.days, saved.steps[7].start.ifLate, saved.steps[7].plan.offset], [["s6"], 30, true, 30]);
});

test("the builder refuses rules that cannot work", () => {
  const bad = (patch) => () => normalizeProcess({ ...body, steps: body.steps.map((s, i) => (i === patch.i ? { ...s, ...patch.s } : s)) });
  assert.throws(bad({ i: 0, s: { plan: { from: "monthDay", day: 32 } } }), /day of the month/);
  assert.throws(bad({ i: 6, s: { start: { mode: "afterDone", step: "s5", also: ["s8"] } } }), /steps that come before it/);
  assert.throws(bad({ i: 7, s: { start: { mode: "afterDue", step: "s4", days: -1 } } }), /0 to 400 days/);
  assert.throws(bad({ i: 7, s: { plan: { from: "stepPlanned", step: "s4", offset: 2.5 } } }), /whole days/);
});

test("Stage 1 is planned on the 5th of the entry's month, even when the 5th is a Sunday", () => {
  const e = entry("2026-11-24");
  e.run(ist(2026, 11, 24, 10));
  assert.deepStrictEqual(e.view(), { s1: "2026-11-05", s2: "waiting", s3: "waiting", s4: "waiting", s5: "waiting", s6: "waiting", s7: "waiting", s8: "waiting" });
  const sunday = entry("2026-04-20"); // 5 April 2026 is a Sunday
  sunday.run(ist(2026, 4, 20, 10));
  assert.strictEqual(sunday.tasks.s1.plannedDay, "2026-04-05");
});

test("a CLOSED status ends the entry: no later stage starts, nothing is left open", () => {
  const e = entry("2026-11-24");
  e.run(ist(2026, 11, 24, 10));
  e.done("s1", ist(2026, 11, 24, 11), "Done");
  // 15 working days (Sundays off) after 24/11, like WORKDAY.INTL(X7,15,"0000001")
  assert.strictEqual(e.tasks.s2.plannedDay, "2026-12-11");
  e.done("s2", ist(2026, 12, 1, 11), "PAYMENT ISSUE");
  assert.deepStrictEqual(e.view(), { s1: "2026-11-05", s2: "2026-12-11", s3: "condition", s4: "condition", s5: "condition", s6: "condition", s7: "condition", s8: "dependency" });
  assert.ok(engine.allResolved(e.tasks));
});

test("Mill A/C road: S4 MILL AC opens S6 (not S5); S7 counts from S6's actual; on-time S4 never escalates", () => {
  const e = entry("2026-11-24");
  e.run(ist(2026, 11, 24, 10));
  e.done("s1", ist(2026, 11, 24, 11), "Done");
  e.done("s2", ist(2026, 11, 30, 11), "GR");
  assert.strictEqual(e.tasks.s3.status, "pending");
  e.done("s3", ist(2026, 12, 2, 11), "MILL AC");
  assert.strictEqual(e.tasks.s4.plannedDay, "2026-12-14"); // 10 working days after 02/12
  e.done("s4", ist(2026, 12, 10, 11), "MILL AC");
  assert.deepStrictEqual([e.tasks.s5.skipReason, e.tasks.s6.status, e.tasks.s8.skipReason], ["condition", "pending", "condition"]);
  e.done("s6", ist(2026, 12, 15, 11), "DONE");
  assert.strictEqual(e.tasks.s7.plannedDay, "2026-12-17"); // 2 working days after S6's actual
  e.done("s7", ist(2026, 12, 16, 11), "DONE");
  assert.ok(engine.allResolved(e.tasks));
});

test("Help Ticket road: S4 HELP TICKET opens S5; S7 counts from S5's actual", () => {
  const e = entry("2026-11-24");
  e.run(ist(2026, 11, 24, 10));
  e.done("s1", ist(2026, 11, 24, 11), "Done");
  e.done("s2", ist(2026, 11, 30, 11), "DAMAGED");
  e.done("s3", ist(2026, 12, 2, 11), "ADJUST");
  e.done("s4", ist(2026, 12, 3, 11), "HELP TICKET");
  assert.deepStrictEqual([e.tasks.s5.status, e.tasks.s6.skipReason, e.tasks.s7.status], ["pending", "condition", "waiting"]);
  e.done("s5", ist(2026, 12, 8, 16), "SOLVED");
  assert.strictEqual(e.tasks.s7.plannedDay, "2026-12-10");
  e.done("s7", ist(2026, 12, 9, 11), "DONE");
  assert.ok(engine.allResolved(e.tasks));
});

test("S8 opens only when S4 is still not done 30 days after its planned day, planned from Planned + 30 + 7 working days", () => {
  const e = entry("2026-11-24");
  e.run(ist(2026, 11, 24, 10));
  e.done("s1", ist(2026, 11, 24, 11), "Done");
  e.done("s2", ist(2026, 11, 30, 11), "GR");
  e.done("s3", ist(2026, 12, 2, 11), "GR");
  assert.strictEqual(e.tasks.s4.plannedDay, "2026-12-14");
  assert.strictEqual(dayKey(e.tasks.s8.triggerAt), "2027-01-14"); // the day after 14/12 + 30
  e.run(ist(2027, 1, 13, 23, 59));
  assert.strictEqual(e.tasks.s8.status, "waiting");
  e.run(ist(2027, 1, 14, 0, 5));
  assert.strictEqual(e.tasks.s8.status, "pending");
  assert.strictEqual(e.tasks.s8.plannedDay, "2027-01-21"); // WORKDAY.INTL(13/01, 7, Sunday off)

  // S4 done late but within the 30 days: no escalation
  const ok = entry("2026-11-24");
  ok.run(ist(2026, 11, 24, 10));
  ok.done("s1", ist(2026, 11, 24, 11), "Done");
  ok.done("s2", ist(2026, 11, 30, 11), "GR");
  ok.done("s3", ist(2026, 12, 2, 11), "GR");
  ok.done("s4", ist(2027, 1, 10, 11), "DONE");
  ok.run(ist(2027, 2, 1));
  assert.strictEqual(ok.tasks.s8.skipReason, "condition");
});

test("reopening a stage finds the stages that start after it or after one of its alternatives", () => {
  assert.deepStrictEqual([...engine.dependentsOf(process.steps, "s6")], ["s7"]);
  assert.deepStrictEqual([...engine.dependentsOf(process.steps, "s4")].sort(), ["s5", "s6", "s7", "s8"]);
});
