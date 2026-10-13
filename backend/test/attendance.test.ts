// HRMS attendance: shift times, night shifts, a day's result (present / late / half / absent / missed punch /
// leave / week-off), the late-policy cut, the geo-fence, biometric file times, and the API: punch, register,
// manual mark, biometric import
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";
import att = require("../services/attendance");
import calendarLib = require("../services/calendar");
const { fromIst } = calendarLib;

const at = (day, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return fromIst(day, h * 60 + m);
};
const general = att.shiftInfo({ start: "09:30", end: "18:30", graceMinutes: 10, earlyGraceMinutes: 10, fullDayMinutes: 480, halfDayMinutes: 240 });
const night = att.shiftInfo({ start: "22:00", end: "06:00", graceMinutes: 10, earlyGraceMinutes: 10, fullDayMinutes: 420, halfDayMinutes: 210 });
const D = "2027-03-02"; // a Tuesday
const later = new Date(Date.parse("2027-03-10T00:00:00Z"));

test("shift: length, night shift, defaults from the company hours", () => {
  assert.deepStrictEqual([general.length, general.overnight], [540, false]);
  assert.deepStrictEqual([night.length, night.overnight], [480, true]);
  const none = att.shiftInfo(null, { startMin: 600, endMin: 1080 });
  assert.deepStrictEqual([none.name, none.startMin, none.full, none.half], ["Company hours", 600, 480, 240]);
});

test("a night shift's morning punch belongs to the night it started", () => {
  assert.strictEqual(att.dayOfPunch(at("2027-03-03", "06:05"), night), "2027-03-02");
  assert.strictEqual(att.dayOfPunch(at("2027-03-02", "21:55"), night), "2027-03-02");
  assert.strictEqual(att.dayOfPunch(at("2027-03-03", "06:05"), general), "2027-03-03");
});

test("a day: on time, late, early going, half day, absent, missed punch", () => {
  const p = (...t) => t.map((x) => ({ at: at(D, x) }));
  const ok = att.evaluateDay({ day: D, sh: general, punches: p("09:35", "18:40"), now: later });
  assert.deepStrictEqual([ok.status, ok.late, ok.early, ok.workMinutes], ["P", false, false, 545]);
  const late = att.evaluateDay({ day: D, sh: general, punches: p("09:50", "18:35"), now: later });
  assert.deepStrictEqual([late.status, late.late, late.lateMinutes], ["P", true, 20]);
  const early = att.evaluateDay({ day: D, sh: general, punches: p("09:30", "17:40"), now: later });
  assert.deepStrictEqual([early.status, early.early, early.earlyMinutes], ["P", true, 50]);
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, punches: p("09:30", "14:00"), now: later }).status, "H");
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, punches: p("09:30", "11:00"), now: later }).status, "A");
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, punches: [], now: later }).status, "A");
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, punches: p("09:30"), now: later }).status, "MP");
  // the same day while it is still going on
  const midday = at(D, "12:00");
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, punches: p("09:30"), now: midday }).status, "IN");
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, punches: [], now: midday }).status, "");
});

test("a day: leave, half-day leave, week-off, work on a day off, a manager's mark", () => {
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, leave: "full", now: later }).status, "L");
  const halfLeave = att.evaluateDay({ day: D, sh: general, leave: "half", punches: [{ at: at(D, "13:30") }, { at: at(D, "18:30") }], now: later });
  assert.deepStrictEqual([halfLeave.status, halfLeave.halfLeave, halfLeave.late], ["P", true, false]);
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, off: "WO", now: later }).status, "WO");
  assert.strictEqual(att.evaluateDay({ day: D, sh: general, off: "HO", leave: "full", now: later }).status, "HO");
  const sunday = att.evaluateDay({ day: D, sh: general, off: "WO", punches: [{ at: at(D, "10:30") }, { at: at(D, "19:00") }], now: later });
  assert.deepStrictEqual([sunday.status, sunday.offDayWork, sunday.late], ["P", true, false]);
  const marked = att.evaluateDay({ day: D, sh: general, manual: { status: "P" }, now: later });
  assert.deepStrictEqual([marked.status, marked.manual], ["P", true]);
});

test("a night shift: 22:05 to 06:00 next morning is present (5 minutes is within the grace)", () => {
  const r = att.evaluateDay({ day: D, sh: night, punches: [{ at: at(D, "22:05") }, { at: at("2027-03-03", "06:00") }], now: later });
  assert.deepStrictEqual([r.status, r.late, r.workMinutes], ["P", false, 475]);
});

test("month summary: present days and the late-policy cut", () => {
  const cells = [
    ...Array(5).fill({ status: "P", late: true, workMinutes: 500 }),
    { status: "P", late: false, early: true, workMinutes: 470 },
    { status: "H", workMinutes: 300 },
    { status: "A" },
    { status: "P", halfLeave: true, workMinutes: 300 },
    { status: "WO" },
  ];
  const s = att.monthSummary(cells, { freeLates: 3, every: 2, penalty: "half" });
  assert.deepStrictEqual([s.P, s.H, s.A, s.WO, s.late, s.presentDays, s.cutDays], [7, 1, 1, 1, 5, 7, 0.5]); // 5 late - 3 free = 2 -> one group
  assert.strictEqual(att.monthSummary(cells, { freeLates: 3, every: 2, penalty: "full", countEarly: true }).cutDays, 1); // 6 marks
  assert.strictEqual(att.monthSummary(cells, null).cutDays, 0);
});

test("distance and biometric date / time formats (IST)", () => {
  assert.strictEqual(att.distanceM({ lat: 21.17, lng: 72.83 }, { lat: 21.17, lng: 72.83 }), 0);
  const d = att.distanceM({ lat: 21.17, lng: 72.83 }, { lat: 21.171, lng: 72.83 });
  assert.ok(d > 100 && d < 120, String(d)); // ~111 m
  const want = +at("2026-10-13", "09:31");
  for (const [date, time] of [["13/10/2026", "09:31"], ["2026-10-13", "9:31 AM"], ["13-10-2026 09:31:00", ""], ["13.10.2026", "09:31"]]) {
    assert.strictEqual(Math.floor(+att.parseIstDateTime(date, time) / 60000) * 60000, want, `${date} ${time}`);
  }
  assert.strictEqual(+att.parseIstDateTime("13/10/2026", "9:31 PM"), +at("2026-10-13", "21:31"));
  assert.strictEqual(att.parseIstDateTime("31/02/2026", "09:00"), null);
  assert.strictEqual(att.parseIstDateTime("13/10/2026", "25:00"), null);
});

// ---------- the API ----------
let srv, server, base;
const cookies: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_attendance_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
});
test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});
async function login(username, password) {
  const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  cookies[username] = res.headers.getSetCookie().find((c) => c.startsWith("fms_session=")).split(";")[0];
}
async function call(who, p, { method = "GET", body }: any = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: cookies[who] || "" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: ((await res.json()) as any) };
}
const SELFIE = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64");
const OFFICE = { lat: 21.17, lng: 72.83 };
const ids: Record<string, any> = {};

test("setup: a branch with a geo-fence, a shift, a late policy, people", async () => {
  await login("admin", "Admin1234");
  const br = await call("admin", "/org/branches", { method: "POST", body: { name: "Surat Mill" } });
  assert.strictEqual(br.status, 201, br.data.message);
  ids.branch = br.data._id;
  const fence = await call("admin", `/attendance/branches/${ids.branch}/fence`, { method: "PUT", body: { ...OFFICE, radius: 150 } });
  assert.strictEqual(fence.data.location.radius, 150, fence.data.message);
  const sh = await call("admin", "/attendance/shifts", { method: "POST", body: { name: "General", start: "09:30", end: "18:30", graceMinutes: 10, earlyGraceMinutes: 10, fullDayMinutes: 480, halfDayMinutes: 240 } });
  assert.strictEqual(sh.status, 201, sh.data.message);
  ids.shift = sh.data._id;
  assert.strictEqual((await call("admin", "/attendance/shifts", { method: "POST", body: { name: "Bad", start: "9:30", end: "18:30" } })).status, 400);
  const lp = await call("admin", "/attendance/late-policies", { method: "POST", body: { name: "Staff late", freeLates: 3, every: 3, penalty: "half" } });
  assert.strictEqual(lp.status, 201, lp.data.message);
  ids.late = lp.data._id;
  for (const [k, name] of [["ravi", "Ravi"], ["neha", "Neha"]]) {
    const u = await call("admin", "/users", { method: "POST", body: { name, username: k, password: "1234", role: "doer", branch: ids.branch } });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
    await login(k, "1234");
  }
  const asg = await call("admin", "/hr/assignment", { method: "PUT", body: { users: [ids.ravi, ids.neha], shift: ids.shift, latePolicy: ids.late } });
  assert.strictEqual(asg.data.changed, 2, asg.data.message);
  assert.strictEqual((await call("admin", `/attendance/code/${ids.ravi}`, { method: "PUT", body: { code: "E101" } })).data.employeeCode, "E101");
  assert.strictEqual((await call("admin", `/attendance/code/${ids.neha}`, { method: "PUT", body: { code: "e101" } })).status, 400); // codes are unique
  assert.strictEqual((await call("ravi", "/attendance/shifts", { method: "POST", body: { name: "Mine", start: "09:00", end: "17:00" } })).status, 403);
});

test("punch: needs GPS and a selfie, blocks outside the fence, not twice in a minute", async () => {
  assert.match((await call("ravi", "/attendance/punch", { method: "POST", body: { photo: SELFIE } })).data.message, /location/);
  assert.match((await call("ravi", "/attendance/punch", { method: "POST", body: { ...OFFICE } })).data.message, /selfie/);
  const far = await call("ravi", "/attendance/punch", { method: "POST", body: { lat: 21.18, lng: 72.83, photo: SELFIE } });
  assert.strictEqual(far.status, 400);
  assert.match(far.data.message, /m from Surat Mill/);
  const ok = await call("ravi", "/attendance/punch", { method: "POST", body: { ...OFFICE, accuracy: 12, photo: SELFIE } });
  assert.strictEqual(ok.status, 201, ok.data.message);
  assert.deepStrictEqual([ok.data.kind, ok.data.outside, ok.data.distance], ["in", false, 0]);
  assert.match((await call("ravi", "/attendance/punch", { method: "POST", body: { ...OFFICE, photo: SELFIE } })).data.message, /a moment ago/);

  const me = (await call("ravi", "/attendance/me")).data;
  assert.strictEqual(me.shift.name, "General");
  assert.strictEqual(me.today.punches.length, 1);
  assert.strictEqual(me.today.next, "out");
  assert.strictEqual(me.branch.fenced, true);
  assert.strictEqual(me.latePolicy.name, "Staff late");
});

test("outside the fence is allowed and flagged when the settings say so", async () => {
  await call("admin", "/attendance/settings", { method: "PUT", body: { gpsRequired: true, selfieRequired: false, outside: "flag" } });
  const r = await call("neha", "/attendance/punch", { method: "POST", body: { lat: 21.18, lng: 72.83 } });
  assert.strictEqual(r.status, 201, r.data.message);
  assert.strictEqual(r.data.outside, true);
  await call("admin", "/attendance/settings", { method: "PUT", body: { gpsRequired: true, selfieRequired: true, outside: "block" } });
});

test("attendance can start from a date: earlier days are not absent", async () => {
  const saved = (await call("admin", "/attendance/settings", { method: "PUT", body: { gpsRequired: true, selfieRequired: true, outside: "block", since: "2026-03-05" } })).data;
  assert.strictEqual(saved.since, "2026-03-05");
  assert.strictEqual((await call("admin", "/attendance/settings", { method: "PUT", body: { since: "5/3/2026" } })).data.since, ""); // not a date
  await call("admin", "/attendance/settings", { method: "PUT", body: { gpsRequired: true, selfieRequired: true, outside: "block" } });
});

test("register: managers only; a manual mark needs a reason; the day's detail", async () => {
  assert.strictEqual((await call("ravi", "/attendance/register")).status, 403);
  const reg = (await call("admin", "/attendance/register?month=2026-03")).data;
  assert.strictEqual(reg.days.length, 31);
  const ravi = reg.people.find((p) => p.user.name === "Ravi");
  assert.strictEqual(ravi.shift, "General");
  assert.strictEqual(ravi.user.employeeCode, "E101");

  assert.match((await call("admin", "/attendance/manual", { method: "PUT", body: { user: ids.ravi, day: "2026-03-02", status: "P" } })).data.message, /reason/);
  assert.strictEqual((await call("neha", "/attendance/manual", { method: "PUT", body: { user: ids.ravi, day: "2026-03-02", status: "P", note: "was on site" } })).status, 403);
  const m = await call("admin", "/attendance/manual", { method: "PUT", body: { user: ids.ravi, day: "2026-03-02", status: "P", note: "Client visit" } });
  assert.strictEqual(m.status, 200, m.data.message);
  const cell = (await call("admin", `/attendance/register?month=2026-03&user=${ids.ravi}`)).data.people[0].cells.find((c) => c.day === "2026-03-02");
  assert.deepStrictEqual([cell.status, cell.manual, cell.note], ["P", true, "Client visit"]);
  const detail = (await call("admin", `/attendance/day?user=${ids.ravi}&day=2026-03-02`)).data;
  assert.strictEqual(detail.manual.by.name, "Admin");
  assert.strictEqual((await call("neha", `/attendance/day?user=${ids.ravi}&day=2026-03-02`)).status, 403);
  await call("admin", "/attendance/manual", { method: "PUT", body: { user: ids.ravi, day: "2026-03-02", status: "" } });
  const cleared = (await call("admin", `/attendance/register?month=2026-03&user=${ids.ravi}`)).data.people[0].cells.find((c) => c.day === "2026-03-02");
  assert.strictEqual(cleared.manual, false);
});

test("biometric file: preview, import, the same file again adds nothing", async () => {
  const rows = [
    { code: "E101", date: "03/03/2026", time: "09:45" },
    { code: "E101", date: "03/03/2026", time: "18:40" },
    { username: "neha", datetime: "2026-03-03 09:20" },
    { code: "X999", date: "03/03/2026", time: "09:00" },
    { code: "E101", date: "3/3/2026", time: "late" },
  ];
  const pre = (await call("admin", "/attendance/biometric/preview", { method: "POST", body: { rows } })).data;
  assert.deepStrictEqual([pre.count, pre.people, pre.problemCount], [3, 2, 2]);
  assert.strictEqual((await call("ravi", "/attendance/biometric/preview", { method: "POST", body: { rows } })).status, 403);
  const imp = (await call("admin", "/attendance/biometric/import", { method: "POST", body: { rows } })).data;
  assert.deepStrictEqual([imp.added, imp.skipped, imp.days], [3, 0, 2]);
  const again = (await call("admin", "/attendance/biometric/import", { method: "POST", body: { rows } })).data;
  assert.deepStrictEqual([again.added, again.skipped], [0, 3]);

  const ravi = (await call("admin", `/attendance/register?month=2026-03&user=${ids.ravi}`)).data.people[0];
  const day = ravi.cells.find((c) => c.day === "2026-03-03");
  assert.deepStrictEqual([day.status, day.late, day.lateMinutes], ["P", true, 15]);
  const neha = (await call("admin", `/attendance/register?month=2026-03&user=${ids.neha}`)).data.people[0].cells.find((c) => c.day === "2026-03-03");
  assert.strictEqual(neha.status, "MP"); // only an in-punch
  // days before they joined (no punch, no mark) are not absent
  const before = ravi.cells.find((c) => c.day === "2026-03-04");
  assert.deepStrictEqual([before.status, before.before], ["", true]);
  assert.strictEqual(ravi.summary.A, 0);
  assert.strictEqual(ravi.summary.presentDays, 1);
});

test("shift and late policy in use cannot be deleted", async () => {
  assert.match((await call("admin", `/attendance/shifts/${ids.shift}`, { method: "DELETE" })).data.message, /2 person/);
  assert.match((await call("admin", `/attendance/late-policies/${ids.late}`, { method: "DELETE" })).data.message, /2 person/);
});
