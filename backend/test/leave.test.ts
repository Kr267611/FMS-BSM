// HRMS leave: working days, balance (accrual, carry forward, capacity), the policy's rules, and apply -> approve
// with buddies taking the work, reject, cancel
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";
import book = require("../services/leaveBook");
import calendarLib = require("../services/calendar");
const { normalizeCalendar } = calendarLib;

test("working days skip week-offs and holidays; a half day is 0.5", () => {
  const cal = normalizeCalendar({ weekOff: [0], holidays: ["2027-03-03"] }); // Sunday off; Wed 3 March a holiday
  assert.strictEqual(book.countDays("2027-03-01", "2027-03-07", cal), 5); // Mon-Sun minus Wed and Sun
  assert.strictEqual(book.countDays("2027-03-01", "2027-03-01", cal, { halfDay: true }), 0.5);
  assert.strictEqual(book.countDays("2027-03-07", "2027-03-07", cal, { halfDay: true }), 0); // a Sunday
});

test("credit: frontload gives the year at once, monthly a twelfth on each credit day", () => {
  const rule = { perYear: 12 };
  assert.strictEqual(book.credited({ accrual: "frontload" }, rule, 2027, "2027-01-01"), 12);
  assert.strictEqual(book.credited({ accrual: "monthly", creditDay: 1 }, rule, 2027, "2027-03-15"), 3);
  assert.strictEqual(book.credited({ accrual: "monthly", creditDay: 20 }, rule, 2027, "2027-03-15"), 2); // March not credited yet
  assert.strictEqual(book.credited({ accrual: "monthly", creditDay: 1 }, { perYear: 7 }, 2027, "2027-02-01"), 1); // 7*2/12 = 1.17 -> 1
});

test("balance: carry forward capped, capacity caps, unpaid leave has no limit", () => {
  const type = { paid: true, carryForward: true, maxCarryForward: 5 };
  const b = book.balanceOf({ policy: { accrual: "frontload" }, type, rule: { perYear: 10, carryLimit: 3 }, year: 2027, asOf: "2027-02-01", used: 4, pending: 1, prevUnused: 8 });
  assert.deepStrictEqual([b.credited, b.carried, b.available], [10, 3, 8]); // 10 + 3 - 4 - 1
  const capped = book.balanceOf({ policy: { accrual: "frontload", capacity: 6 }, type, rule: { perYear: 10 }, year: 2027, asOf: "2027-02-01", prevUnused: 8 });
  assert.strictEqual(capped.available, 6);
  assert.strictEqual(book.balanceOf({ policy: {}, type: { paid: false }, rule: { perYear: 1 }, year: 2027, asOf: "2027-01-01" }).limited, false);
});

test("when the quota runs out: unpaid (LWP), refused, or a negative balance", () => {
  const balance = { limited: true, available: 2 };
  assert.deepStrictEqual(book.checkAgainst({ days: 3, balance, policy: { exhaust: "lwp" } }), { lwpDays: 1, problems: [] });
  assert.match(book.checkAgainst({ days: 3, balance, policy: { exhaust: "reject" } }).problems[0], /Only 2 day/);
  assert.deepStrictEqual(book.checkAgainst({ days: 3, balance, policy: { exhaust: "negative", maxNegative: 1 } }).problems, []);
  assert.match(book.checkAgainst({ days: 4, balance, policy: { exhaust: "negative", maxNegative: 1 } }).problems[0], /-1 at most/);
  assert.match(book.checkAgainst({ days: 1, balance, policy: { exhaust: "lwp" }, rule: { minAtOnce: 2 } }).problems[0], /At least 2/);
  assert.match(book.checkAgainst({ days: 5, balance: { limited: false }, policy: {}, rule: { maxAtOnce: 3 } }).problems[0], /At most 3/);
});

// ---------- the API ----------
let srv, server, base;
const cookies: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_leave_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
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

const ids: Record<string, any> = {};
test("setup: leave types, a policy, people", async () => {
  await login("admin", "Admin1234");
  await call("admin", "/settings/calendar", { method: "PUT", body: { weekOff: [0], start: "09:00", end: "18:00", holidays: [] } });
  for (const [k, name] of [["ravi", "Ravi"], ["buddy", "Buddy"], ["neha", "Neha"]]) {
    const u = await call("admin", "/users", { method: "POST", body: { name, username: k, password: "1234", role: "doer" } });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
    await login(k, "1234");
  }
  const cl = await call("admin", "/hr/types", { method: "POST", body: { name: "Casual Leave", code: "cl" } });
  assert.strictEqual(cl.status, 201, cl.data.message);
  assert.strictEqual(cl.data.code, "CL");
  ids.cl = cl.data._id;
  ids.sl = (await call("admin", "/hr/types", { method: "POST", body: { name: "Sick Leave", requiresDocument: true } })).data._id;
  ids.ml = (await call("admin", "/hr/types", { method: "POST", body: { name: "Maternity Leave", gender: "female" } })).data._id;
  ids.unpaid = (await call("admin", "/hr/types", { method: "POST", body: { name: "Leave Without Pay", paid: false } })).data._id;
  assert.strictEqual((await call("ravi", "/hr/types", { method: "POST", body: { name: "Mine" } })).status, 403); // only settings editors configure

  const pol = await call("admin", "/hr/policies", { method: "POST", body: { name: "Staff", accrual: "frontload", exhaust: "lwp", rules: [{ type: ids.cl, perYear: 2, maxAtOnce: 5 }, { type: ids.sl, perYear: 6 }, { type: ids.ml, perYear: 90 }] } });
  assert.strictEqual(pol.status, 201, pol.data.message);
  ids.policy = pol.data._id;
  const asg = await call("admin", "/hr/assignment", { method: "PUT", body: { users: [ids.ravi, ids.neha], policy: ids.policy } });
  assert.strictEqual(asg.data.changed, 2);
  await call("admin", "/hr/assignment", { method: "PUT", body: { users: [ids.neha], gender: "female" } });
  await call("admin", "/hr/assignment", { method: "PUT", body: { users: [ids.ravi], gender: "male" } });
});

test("my balance: the policy's days; a type only for women is not shown to a man", async () => {
  const me = (await call("ravi", "/hr/my?year=2027")).data;
  assert.strictEqual(me.policy.name, "Staff");
  const cl = me.balances.find((b) => b.type.name === "Casual Leave");
  assert.deepStrictEqual([cl.limited, cl.available], [true, 2]);
  assert.ok(!me.balances.some((b) => b.type.name === "Maternity Leave"));
  assert.ok((await call("neha", "/hr/my?year=2027")).data.balances.some((b) => b.type.name === "Maternity Leave"));
  assert.strictEqual((await call("ravi", "/hr/my?year=2027")).data.balances.find((b) => b.type.name === "Leave Without Pay").limited, false);
});

test("apply: working days counted, the day above the balance becomes unpaid, the document rule, no overlaps", async () => {
  // Mon 1 - Wed 3 March 2027: 3 working days, 2 of Casual Leave left -> 1 unpaid
  const body = { type: ids.cl, from: "2027-03-01", to: "2027-03-03", reason: "Family function" };
  const pre = (await call("ravi", "/hr/preview", { method: "POST", body })).data;
  assert.deepStrictEqual([pre.days, pre.lwpDays, pre.balance.available, pre.balance.after, pre.problems], [3, 1, 2, -1, []]);
  assert.match((await call("ravi", "/hr/preview", { method: "POST", body: { ...body, type: ids.sl } })).data.problems.join(), /document/);
  assert.match((await call("ravi", "/hr/requests", { method: "POST", body: { ...body, to: "2027-03-09" } })).data.message, /At most 5/); // 7 working days
  // a delegation for Ravi due on 2 March, to be handed to the buddy
  const d = await call("admin", "/delegations", { method: "POST", body: { title: "Count the stock", doer: ids.ravi, date: "2027-03-02", time: "15:00" } });
  assert.strictEqual(d.status, 201, d.data.message);
  ids.delegation = d.data._id;
  const made = await call("ravi", "/hr/requests", { method: "POST", body: { ...body, buddies: { delegation: ids.buddy, checklist: ids.ravi } } });
  assert.strictEqual(made.status, 201, made.data.message);
  assert.deepStrictEqual([made.data.status, made.data.days, made.data.lwpDays, made.data.buddies.checklist], ["pending", 3, 1, undefined]); // own self is not a buddy
  ids.request = made.data._id;
  assert.match((await call("ravi", "/hr/preview", { method: "POST", body: { ...body, from: "2027-03-03", to: "2027-03-04" } })).data.problems.join(), /Already asked/);
  // the waiting request counts against the balance
  assert.strictEqual((await call("ravi", "/hr/my?year=2027")).data.balances.find((b) => b.type.name === "Casual Leave").available, 0);
});

test("approve: only a manager or admin; the leave takes the days off and the delegation goes to the buddy", async () => {
  assert.strictEqual((await call("ravi", `/hr/requests/${ids.request}/approve`, { method: "POST", body: {} })).status, 403); // not your own
  assert.strictEqual((await call("buddy", `/hr/requests/${ids.request}/approve`, { method: "POST", body: {} })).status, 403);
  const waiting = (await call("admin", "/hr/requests?view=approve")).data;
  assert.ok(waiting.some((r) => r._id === ids.request && r.canDecide));
  const ok = await call("admin", `/hr/requests/${ids.request}/approve`, { method: "POST", body: { note: "Enjoy" } });
  assert.strictEqual(ok.status, 200, ok.data.message);
  assert.deepStrictEqual([ok.data.status, ok.data.applied.handedOver], ["approved", 1]);
  const Task = require("../models/Task");
  const t = await Task.findById(ids.delegation).lean();
  assert.strictEqual(String(t.doer), ids.buddy);
  assert.match(t.log.at(-1).action, /buddy/);
  const Leave = require("../models/Leave");
  assert.ok(await Leave.exists({ user: ids.ravi, from: "2027-03-01", to: "2027-03-03" }));
  // used: the 2 paid days; the unpaid day does not use the quota
  const cl = (await call("ravi", "/hr/my?year=2027")).data.balances.find((b) => b.type.name === "Casual Leave");
  assert.deepStrictEqual([cl.used, cl.available], [2, 0]);
  assert.match((await call("admin", `/hr/requests/${ids.request}/approve`, { method: "POST", body: {} })).data.message, /already approved/);
});

test("reject needs a reason; the person can cancel a waiting request; summary", async () => {
  const r = (await call("neha", "/hr/requests", { method: "POST", body: { type: ids.ml, from: "2027-04-05", to: "2027-04-06", reason: "Check-up" } })).data;
  assert.match((await call("admin", `/hr/requests/${r._id}/reject`, { method: "POST", body: {} })).data.message, /why/);
  const rej = await call("admin", `/hr/requests/${r._id}/reject`, { method: "POST", body: { note: "Busy week" } });
  assert.strictEqual(rej.data.status, "rejected");
  const r2 = (await call("neha", "/hr/requests", { method: "POST", body: { type: ids.unpaid, from: "2027-04-12", to: "2027-04-12", halfDay: true, session: "afternoon", reason: "Bank work" } })).data;
  assert.deepStrictEqual([r2.days, r2.session], [0.5, "afternoon"]);
  assert.strictEqual((await call("ravi", `/hr/requests/${r2._id}/cancel`, { method: "POST" })).status, 403); // someone else's
  assert.strictEqual((await call("neha", `/hr/requests/${r2._id}/cancel`, { method: "POST" })).data.status, "cancelled");
  const s = (await call("admin", "/hr/summary")).data;
  assert.strictEqual(s.waiting, 0);
  assert.ok(s.noPolicy >= 2); // admin and the buddy have no policy
  // a doer's list holds only their own requests
  assert.ok((await call("ravi", "/hr/requests")).data.every((x) => x.user._id === ids.ravi));
  // a type in use cannot be deleted; a policy in use cannot be deleted
  assert.match((await call("admin", `/hr/types/${ids.cl}`, { method: "DELETE" })).data.message, /already taken|policy uses/);
  assert.match((await call("admin", `/hr/policies/${ids.policy}`, { method: "DELETE" })).data.message, /person/);
});
