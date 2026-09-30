// Checklist schedules: which days a recurring task falls due. 28 Sep 2026 is a Monday.
const test = require("node:test");
const assert = require("node:assert");
const { dueDays, nextDueDays } = require("../services/recurrence");
const { normalizeCalendar } = require("../services/calendar");

const sundayOff = normalizeCalendar({ weekOff: [0] });
const withHoliday = normalizeCalendar({ weekOff: [0], holidays: [{ day: "2026-10-02", name: "Gandhi Jayanti" }] });
const s = (frequency, extra = {}) => ({ frequency, start: "2026-01-01", onHoliday: "skip", ...extra });

test("daily: every working day, Sunday skipped", () => {
  assert.deepStrictEqual(dueDays(s({ type: "daily" }), "2026-09-27", "2026-10-04", sundayOff), [
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
  ]);
});

test("weekly on Monday and Thursday", () => {
  assert.deepStrictEqual(dueDays(s({ type: "weekly", days: [1, 4] }), "2026-09-28", "2026-10-11", sundayOff), [
    "2026-09-28",
    "2026-10-01",
    "2026-10-05",
    "2026-10-08",
  ]);
});

test("monthly on the 31st falls on the last day of shorter months", () => {
  assert.deepStrictEqual(dueDays(s({ type: "monthly", dates: [31], every: 1 }), "2026-02-01", "2026-04-30", sundayOff), [
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ]);
});

test("every 3 months on the 1st, counted from the start month", () => {
  assert.deepStrictEqual(dueDays(s({ type: "monthly", dates: [1], every: 3 }), "2026-01-01", "2026-12-31", sundayOff), [
    "2026-01-01",
    "2026-04-01",
    "2026-07-01",
    "2026-10-01",
  ]);
});

test("every 15 days from the start day", () => {
  assert.deepStrictEqual(dueDays(s({ type: "interval", every: 15 }, { start: "2026-09-01" }), "2026-09-01", "2026-10-31", sundayOff), [
    "2026-09-01",
    "2026-09-16",
    "2026-10-01",
    "2026-10-16",
    "2026-10-31",
  ]);
});

test("holiday rule: skip, next or previous working day", () => {
  const friday = (onHoliday) => s({ type: "weekly", days: [5] }, { onHoliday });
  assert.deepStrictEqual(dueDays(friday("skip"), "2026-09-28", "2026-10-09", withHoliday), ["2026-10-09"]);
  assert.deepStrictEqual(dueDays(friday("next"), "2026-09-28", "2026-10-09", withHoliday), ["2026-10-03", "2026-10-09"]);
  assert.deepStrictEqual(dueDays(friday("previous"), "2026-09-28", "2026-10-09", withHoliday), ["2026-10-01", "2026-10-09"]);
});

test("a day moved by the holiday rule is counted once, even from just outside the range", () => {
  assert.deepStrictEqual(dueDays(s({ type: "daily" }, { onHoliday: "next" }), "2026-09-27", "2026-09-29", sundayOff), ["2026-09-28", "2026-09-29"]);
  // Sunday 4 Oct moves to Monday 5 Oct
  assert.deepStrictEqual(dueDays(s({ type: "weekly", days: [0] }, { onHoliday: "next" }), "2026-10-05", "2026-10-05", sundayOff), ["2026-10-05"]);
});

test("start and end dates bound the schedule", () => {
  assert.deepStrictEqual(dueDays(s({ type: "daily" }, { start: "2026-09-30", end: "2026-10-02" }), "2026-09-28", "2026-10-05", sundayOff), [
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
  ]);
});

test("next due days for the preview", () => {
  assert.deepStrictEqual(nextDueDays(s({ type: "weekly", days: [1] }), "2026-09-29", 3, sundayOff), ["2026-10-05", "2026-10-12", "2026-10-19"]);
  assert.deepStrictEqual(nextDueDays(s({ type: "monthly", dates: [15], every: 12 }, { start: "2026-03-15" }), "2026-09-29", 2, sundayOff), ["2027-03-15", "2028-03-15"]);
});
