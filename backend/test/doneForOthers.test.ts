// "Done for others": a checklist, delegation or FMS step is marked Done / Not Required by its doer. Someone else
// only with the "Done for others" tick, and only for the people they reach. Changing checklists, managing a
// delegation or editing FMS entries (the PC's default ticks) does not give it; reopening a step still needs
// FMS Entries (edit), not this tick.
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";

let srv, server, base;
const cookies: Record<string, any> = {};
const ids: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_done_for_others_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
});
test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});
async function login(username, password = "Pass12345") {
  const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  cookies[username] = res.headers.getSetCookie().find((c) => c.startsWith("fms_session=")).split(";")[0];
}
async function call(who, p, { method = "GET", body }: any = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: cookies[who] || "" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}
const post = (who, p, body = {}) => call(who, p, { method: "POST", body });
const give = (who, permissions) => call("admin", `/users/${ids[who]}`, { method: "PUT", body: { permissions } });

let tasks: Record<string, any> = {};
test("setup: Store (HOD, PC, doer Ravi), QC (doer Amit); a checklist, a delegation and an FMS step for each doer", async () => {
  await login("admin", "Admin1234");
  ids.store = (await post("admin", "/org/departments", { name: "Store" })).data._id;
  ids.qc = (await post("admin", "/org/departments", { name: "QC" })).data._id;
  for (const [k, role, dept] of [["hod", "hod", ids.store], ["pc", "pc", ids.store], ["ravi", "doer", ids.store], ["amit", "doer", ids.qc]]) {
    const u = await post("admin", "/users", { name: k, username: k, password: "Pass12345", role, department: dept });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
    await login(k);
  }
  // no week-off, so a daily checklist has a task today on any day
  assert.strictEqual((await call("admin", "/settings/calendar", { method: "PUT", body: { weekOff: [], start: "09:00", end: "18:00", holidays: [] } })).status, 200);
  // two steps that both start with the entry: Ravi's (Store) and Amit's (QC)
  const step = (key, name, user) => ({ key, name, doer: { mode: "fixed", user }, start: { mode: "entry" }, tat: 1, tatUnit: "days", fields: [] });
  const p = await post("admin", "/processes", { name: "Store FMS", steps: [step("s1", "Issue", ids.ravi), step("s2", "Check", ids.amit)], fields: [] });
  assert.strictEqual(p.status, 201, p.data.message);
  ids.process = p.data._id;
  const job = await post("admin", "/jobs", { process: ids.process, data: {} });
  assert.strictEqual(job.status, 201, job.data.message);
  ids.job = job.data._id;

  for (const doer of ["ravi", "amit"]) {
    // the PC makes the checklist and assigns the delegation: their default ticks
    const c = await post("pc", "/checklists", { name: `Oiling ${doer}`, doer: ids[doer], frequency: { type: "daily" } });
    assert.strictEqual(c.status, doer === "ravi" ? 201 : 403, c.data.message); // Amit is not the Store PC's
    if (doer === "amit") assert.strictEqual((await post("admin", "/checklists", { name: "Oiling amit", doer: ids.amit, frequency: { type: "daily" } })).status, 201);
    const d = await post(doer === "ravi" ? "pc" : "admin", "/delegations", { title: `Quote ${doer}`, doer: ids[doer], planned: new Date(Date.now() + 2 * 86400000) });
    assert.strictEqual(d.status, 201, d.data.message);
  }
  const list = async (who) => (await call("admin", `/tasks?doer=${ids[who]}`)).data.tasks;
  for (const who of ["ravi", "amit"]) {
    const mine = await list(who);
    tasks[who] = { checklist: mine.filter((t) => t.kind === "checklist"), delegation: mine.find((t) => t.kind === "delegation"), step: mine.find((t) => t.kind === "app") };
  }
  assert.ok(tasks.ravi.checklist.length >= 1 && tasks.ravi.delegation && tasks.ravi.step, "Ravi has a checklist task, a delegation and an FMS step");
  assert.ok(tasks.amit.step && tasks.amit.checklist.length >= 1, "Amit too");
});

test("without the tick: the PC and the HOD cannot mark the doer's checklist, delegation or FMS step", async () => {
  for (const who of ["pc", "hod"]) {
    for (const t of [tasks.ravi.checklist[0], tasks.ravi.delegation, tasks.ravi.step]) {
      const r = await post(who, `/tasks/${t._id}/done`);
      assert.strictEqual(r.status, 403, `${who} on ${t.kind}: ${r.data.message}`);
      assert.match(r.data.message, /Done for others/);
    }
    assert.strictEqual((await post(who, `/tasks/${tasks.ravi.checklist[0]._id}/not-required`, { remarks: "Machine stopped" })).status, 403);
    assert.strictEqual((await post(who, `/tasks/${tasks.ravi.step._id}/not-required`, { remarks: "Not needed" })).status, 403);
  }
  // the entry panel says the same
  const step = (await call("pc", `/jobs/${ids.job}`)).data.tasks.find((t) => String(t._id) === String(tasks.ravi.step._id));
  assert.strictEqual(step.canAct, false);
  assert.match(step.notAllowed, /Done for others/);
  assert.strictEqual(step.canReopen, true); // FMS Entries (edit) and Ravi is among the PC's people
});

test("the doer always marks their own task", async () => {
  const r = await post("ravi", `/tasks/${tasks.ravi.checklist[0]._id}/done`, { remarks: "Oiled" });
  assert.strictEqual(r.status, 200, r.data.message);
  assert.strictEqual(String(r.data.doneBy), String(ids.ravi));
  // and not someone else's
  assert.strictEqual((await post("ravi", `/tasks/${tasks.amit.step._id}/done`)).status, 403);
});

test("with the tick: the PC marks Ravi's delegation and FMS step, but not Amit's (QC is not the PC's)", async () => {
  assert.strictEqual((await give("pc", { doneForOthers: ["edit"] })).status, 200);
  const d = await post("pc", `/tasks/${tasks.ravi.delegation._id}/done`, { remarks: "Quote received on WhatsApp" });
  assert.strictEqual(d.status, 200, d.data.message);
  assert.strictEqual(String(d.data.doneBy), String(ids.pc));
  const s = await post("pc", `/tasks/${tasks.ravi.step._id}/done`);
  assert.strictEqual(s.status, 200, s.data.message);
  const panel = (await call("pc", `/jobs/${ids.job}`)).data.tasks;
  assert.strictEqual(panel.find((t) => String(t._id) === String(tasks.amit.step._id)).canAct, false, "Amit is outside the PC's people");
  assert.match(panel.find((t) => String(t._id) === String(tasks.amit.step._id)).notAllowed, /reach/);
  assert.strictEqual((await post("pc", `/tasks/${tasks.amit.step._id}/done`)).status, 403);
  assert.strictEqual((await post("pc", `/tasks/${tasks.amit.checklist[0]._id}/done`)).status, 403);
});

test("reopening a step still goes by FMS Entries (edit): the HOD reopens without Done for others, the doer's own work is untouched", async () => {
  const r = await post("hod", `/tasks/${tasks.ravi.step._id}/reopen`);
  assert.strictEqual(r.status, 200, r.data.message);
  // after the reopen it is pending again, and the HOD (no tick) still cannot mark it done
  assert.strictEqual((await post("hod", `/tasks/${tasks.ravi.step._id}/done`)).status, 403);
  // the tick taken away again: the PC is back to the doer-only rule
  assert.strictEqual((await give("pc", {})).status, 200);
  assert.strictEqual((await post("pc", `/tasks/${tasks.ravi.step._id}/done`)).status, 403);
  // the admin can always
  assert.strictEqual((await post("admin", `/tasks/${tasks.ravi.step._id}/done`)).status, 200);
});
