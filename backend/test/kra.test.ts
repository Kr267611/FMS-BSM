// KRA / KPI: policy checks, achievement, the monthly scorecard worked out from the tasks (MIS rules), who sees
// whose scorecard, and changes counting from next month while a passed month keeps its version
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";
import kra = require("../services/kra");

test("achievement: higher / lower is better, MIS score on its own scale, 0–120 %", () => {
  assert.strictEqual(kra.achievement("onTimePct", 40, 80), 50);
  assert.strictEqual(kra.achievement("onTimePct", 100, 80), 120); // capped
  assert.strictEqual(kra.achievement("avgDelay", 4, 2), 50);
  assert.strictEqual(kra.achievement("avgDelay", 0, 2), 120);
  assert.strictEqual(kra.achievement("pendingCount", 0, 0), 100);
  assert.strictEqual(kra.achievement("pendingCount", 1, 0), 0);
  assert.strictEqual(kra.achievement("misScore", -40, null), 60);
  assert.strictEqual(kra.achievement("misScore", -150, null), 0);
  assert.strictEqual(kra.achievement("onTimePct", null, 80), null); // nothing to count
  // parts with no value do not count; their weight is shared out again
  assert.strictEqual(kra.weighted([{ achievement: 80, weight: 50 }, { achievement: null, weight: 50 }]), 80);
  assert.strictEqual(kra.weighted([{ achievement: null, weight: 100 }]), null);
  assert.strictEqual(kra.addMonths("2026-12", 1), "2027-01");
  assert.deepStrictEqual(kra.monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
});

let srv, server, base, User, Task, KraPolicy;
const cookies: Record<string, any> = {};
const ids: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_kra_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
  User = require("../models/User");
  Task = require("../models/Task");
  KraPolicy = require("../models/KraPolicy");
});
test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});
async function login(username, password = "1234") {
  const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  cookies[username] = res.headers.getSetCookie().find((c) => c.startsWith("fms_session=")).split(";")[0];
}
async function call(who, p, { method = "GET", body }: any = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: cookies[who] || "" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}
const last = kra.addMonths(kra.monthOf(), -1); // a month that has fully passed
const day = (d) => `${last}-${String(d).padStart(2, "0")}`;

test("setup: Store (HOD + two doers), MIS (one doer), an FMS, last month's tasks", async () => {
  await login("admin", "Admin1234");
  ids.store = (await call("admin", "/org/departments", { method: "POST", body: { name: "Store" } })).data._id;
  ids.mis = (await call("admin", "/org/departments", { method: "POST", body: { name: "MIS" } })).data._id;
  for (const [k, role, dept] of [["hod", "hod", ids.store], ["ravi", "doer", ids.store], ["sita", "doer", ids.store], ["amit", "doer", ids.mis]]) {
    const u = await call("admin", "/users", { method: "POST", body: { name: k, username: k, password: "1234", role, department: dept } });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
    await login(k);
  }
  const p = await call("admin", "/processes", { method: "POST", body: { name: "Store FMS", active: false, fields: [], steps: [{ key: "s1", name: "Issue", doer: { mode: "fixed" }, start: { mode: "entry" }, tat: 1, tatUnit: "days", fields: [] }] } });
  assert.strictEqual(p.status, 201, p.data.message);
  ids.fms = p.data._id;
  const at = (d, h = 10) => new Date(`${day(d)}T${String(h).padStart(2, "0")}:00:00+05:30`);
  const task = (doer, kind, planned, actual, extra = {}) => ({ kind, doer, label: `${kind} task`, plannedDay: day(planned), planned: at(planned), status: actual ? "done" : "pending", ...(actual ? { actual: at(actual), actualDay: day(actual) } : {}), ...extra });
  await Task.insertMany([
    // Ravi: 4 checklist tasks – 2 on time, 1 late, 1 never done – and 1 FMS step done late
    task(ids.ravi, "checklist", 5, 5),
    task(ids.ravi, "checklist", 6, 6),
    task(ids.ravi, "checklist", 7, 9),
    task(ids.ravi, "checklist", 8, null),
    task(ids.ravi, "app", 10, 13, { process: ids.fms, stepKey: "s1" }),
    // not counted: Not Required, and another month
    task(ids.ravi, "checklist", 11, null, { status: "na" }),
  ]);
});

const POLICY = () => ({
  name: "Store Staff",
  appliesTo: { departments: [ids.store] },
  kras: [
    {
      name: "Timely work",
      weight: 60,
      kpis: [
        { name: "All work on time", metric: "onTimePct", kind: "all", target: 80, weight: 50 },
        { name: "Store FMS on time", metric: "onTimePct", kind: "fms", process: ids.fms, target: 90, weight: 50 },
      ],
    },
    {
      name: "Discipline",
      weight: 40,
      kpis: [
        { metric: "pendingCount", target: 0 },
        { metric: "misScore" },
      ],
    },
  ],
});

test("policy checks: weights add up to 100, a target for each KPI, % targets 1–100, someone it is for", async () => {
  const bad = async (change) => (await call("admin", "/kra/policies", { method: "POST", body: { ...POLICY(), name: "x", ...change(POLICY()) } })).data.message;
  assert.match(await bad((p) => ({ kras: [{ ...p.kras[0], weight: 50 }, p.kras[1]] })), /add up to 90/);
  assert.match(await bad((p) => ({ kras: [{ ...p.kras[0], kpis: [{ metric: "onTimePct", kind: "all" }] }, p.kras[1]] })), /target/);
  assert.match(await bad((p) => ({ kras: [{ ...p.kras[0], kpis: [{ metric: "onTimePct", target: 120, weight: 100 }] }, p.kras[1]] })), /between 1 and 100/);
  assert.match(await bad(() => ({ appliesTo: {} })), /who this policy is for/);
  assert.match(await bad((p) => ({ kras: [{ ...p.kras[0], kpis: [{ ...p.kras[0].kpis[0], weight: 30 }, p.kras[0].kpis[1]] }, p.kras[1]] })), /KPI weights must add up to 100/);
  // a doer cannot make one
  assert.strictEqual((await call("ravi", "/kra/policies", { method: "POST", body: POLICY() })).status, 403);
});

test("the scorecard of last month, counted like the MIS", async () => {
  const made = await call("admin", "/kra/policies", { method: "POST", body: POLICY() });
  assert.strictEqual(made.status, 201, made.data.message);
  ids.policy = made.data._id;
  // a new policy counts from this month; for this test it counted from last month
  await KraPolicy.updateOne({ _id: ids.policy }, { $set: { "versions.0.from": last } });

  const card = (await call("ravi", `/kra/scorecard?month=${last}`)).data;
  const [timely, discipline] = card.kras;
  // all work: 5 planned, 2 on time -> 40 % of 80 = 50 %; Store FMS: 1 step, late -> 0 %; KRA = 25 %
  assert.deepStrictEqual(timely.kpis.map((k) => [k.actual, k.achievement]), [[40, 50], [0, 0]]);
  assert.strictEqual(timely.achievement, 25);
  // 1 pending against 0 -> 0 %; MIS score −(50×2 + 100×1)/5 = −40 -> 60 %; KRA = 30 %
  assert.deepStrictEqual(discipline.kpis.map((k) => [k.actual, k.achievement]), [[1, 0], [-40, 60]]);
  assert.strictEqual(discipline.achievement, 30);
  assert.strictEqual(card.overall, 27); // 25 × 60 % + 30 × 40 %
  assert.deepStrictEqual([card.policy.name, card.policy.by], ["Store Staff", "department"]);

  // Sita has the policy but no work last month: nothing to count, no score
  assert.strictEqual((await call("admin", `/kra/scorecard?user=${ids.sita}&month=${last}`)).data.overall, null);
  // Amit (MIS) has no policy
  assert.strictEqual((await call("amit", `/kra/scorecard?month=${last}`)).data.none, true);
});

test("who sees whose scorecard: one's own always, the HOD their department, the admin everyone", async () => {
  assert.strictEqual((await call("ravi", `/kra/scorecard?user=${ids.sita}&month=${last}`)).status, 403);
  assert.strictEqual((await call("ravi", `/kra/scorecards?month=${last}`)).status, 403);
  const hod = (await call("hod", `/kra/scorecards?month=${last}`)).data.scorecards.map((c) => c.user.name);
  assert.deepStrictEqual(hod.sort(), ["hod", "ravi", "sita"]); // Store only; the HOD's own policy too
  assert.strictEqual((await call("hod", `/kra/scorecard?user=${ids.amit}&month=${last}`)).status, 403);
  const all = (await call("admin", `/kra/scorecards?month=${last}`)).data.scorecards;
  assert.strictEqual(all[0].user.name, "ravi"); // best score first, no score last
});

test("a change counts from next month; this month only with a reason; a person's own policy wins", async () => {
  const p = POLICY();
  p.kras[0].kpis[0].target = 40; // easier
  assert.strictEqual((await call("admin", `/kra/policies/${ids.policy}`, { method: "PUT", body: { kras: p.kras } })).status, 200);
  const saved = await KraPolicy.findById(ids.policy).lean();
  assert.deepStrictEqual(saved.versions.map((v) => v.from), [last, kra.addMonths(kra.monthOf(), 1)]);
  assert.strictEqual((await call("ravi", `/kra/scorecard?month=${last}`)).data.overall, 27); // the passed month keeps its version
  assert.match((await call("admin", `/kra/policies/${ids.policy}`, { method: "PUT", body: { kras: p.kras, effective: "now" } })).data.message, /why/);
  // a policy for Ravi himself takes over from the department's
  const own = await call("admin", "/kra/policies", { method: "POST", body: { ...POLICY(), name: "Ravi", appliesTo: { users: [ids.ravi] } } });
  assert.strictEqual(own.status, 201, own.data.message);
  await KraPolicy.updateOne({ _id: own.data._id }, { $set: { "versions.0.from": last } });
  assert.deepStrictEqual((await call("ravi", `/kra/scorecard?month=${last}`)).data.policy.by, "person");
});
