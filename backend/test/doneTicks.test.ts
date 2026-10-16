// The Done tick: a checklist task, delegation or FMS step is marked Done / Not Required by its own doer. Someone
// else only with the Done tick of that page (Checklists, Delegations, FMS Entries – one each), and only for the
// people they reach. Changing checklists, managing a delegation or editing FMS entries (the PC's default ticks) does
// not give it; reopening a step still needs FMS Entries (edit). The one-day "Done for others" row is moved over.
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
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_done_ticks_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
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
// the PC's default ticks of the three pages, plus Done where asked
const PC = { checklist: ["view", "add", "edit"], delegation: ["view", "add", "edit"], fmsEntries: ["view", "add", "edit"] };
const withDone = (...pages) => Object.fromEntries(Object.entries(PC).map(([m, a]) => [m, pages.includes(m) ? [...a, "done"] : a]));

const tasks: Record<string, any> = {};
test("setup: Store (HOD, PC, doer Ravi), QC (doer Amit); checklists, a delegation and an FMS step for each doer", async () => {
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
  const job = await post("admin", "/jobs", { process: p.data._id, data: {} });
  assert.strictEqual(job.status, 201, job.data.message);
  ids.job = job.data._id;

  // the PC makes Ravi's checklists and assigns his delegation (their default ticks); Amit is not the Store PC's
  for (const name of ["Oiling", "Cleaning"]) assert.strictEqual((await post("pc", "/checklists", { name, doer: ids.ravi, frequency: { type: "daily" } })).status, 201);
  assert.strictEqual((await post("pc", "/checklists", { name: "Oiling amit", doer: ids.amit, frequency: { type: "daily" } })).status, 403);
  assert.strictEqual((await post("admin", "/checklists", { name: "Oiling amit", doer: ids.amit, frequency: { type: "daily" } })).status, 201);
  assert.strictEqual((await post("pc", "/delegations", { title: "Quote ravi", doer: ids.ravi, planned: new Date(Date.now() + 2 * 86400000) })).status, 201);
  for (const who of ["ravi", "amit"]) {
    const mine = (await call("admin", `/tasks?doer=${ids[who]}`)).data.tasks;
    const checklists = mine.filter((t) => t.kind === "checklist");
    tasks[who] = { checklist: checklists, oiling: checklists.find((t) => t.checklist?.name === "Oiling"), cleaning: checklists.find((t) => t.checklist?.name === "Cleaning"), delegation: mine.find((t) => t.kind === "delegation"), step: mine.find((t) => t.kind === "app") };
  }
  assert.ok(tasks.ravi.checklist.length === 2 && tasks.ravi.oiling && tasks.ravi.cleaning, "Ravi has two checklist tasks today");
  assert.ok(tasks.ravi.delegation && tasks.ravi.step, "and a delegation and an FMS step");
  assert.ok(tasks.amit.step && tasks.amit.checklist.length === 1, "Amit too");
});

test("without a Done tick: the PC and the HOD cannot mark the doer's checklist, delegation or FMS step", async () => {
  for (const who of ["pc", "hod"]) {
    for (const [t, page] of [[tasks.ravi.oiling, "Checklists"], [tasks.ravi.delegation, "Delegations"], [tasks.ravi.step, "FMS Entries"]]) {
      const r = await post(who, `/tasks/${t._id}/done`);
      assert.strictEqual(r.status, 403, `${who} on ${t.kind}: ${r.data.message}`);
      assert.match(r.data.message, new RegExp(`"Done" tick of ${page}`));
    }
    assert.strictEqual((await post(who, `/tasks/${tasks.ravi.oiling._id}/not-required`, { remarks: "Machine stopped" })).status, 403);
    assert.strictEqual((await post(who, `/tasks/${tasks.ravi.step._id}/not-required`, { remarks: "Not needed" })).status, 403);
  }
  // the entry panel says the same
  const step = (await call("pc", `/jobs/${ids.job}`)).data.tasks.find((t) => String(t._id) === String(tasks.ravi.step._id));
  assert.strictEqual(step.canAct, false);
  assert.match(step.notAllowed, /"Done" tick of FMS Entries/);
  assert.strictEqual(step.canReopen, true); // FMS Entries (edit) and Ravi is among the PC's people
});

test("the doer always marks their own task, and nobody else's", async () => {
  const r = await post("ravi", `/tasks/${tasks.ravi.oiling._id}/done`, { remarks: "Oiled" });
  assert.strictEqual(r.status, 200, r.data.message);
  assert.strictEqual(String(r.data.doneBy), String(ids.ravi));
  assert.strictEqual((await post("ravi", `/tasks/${tasks.amit.step._id}/done`)).status, 403);
  assert.strictEqual((await post("ravi", `/tasks/${tasks.amit.checklist[0]._id}/done`)).status, 403);
});

test("the Checklists list carries each checklist's open task for its Done button", async () => {
  const list = (await call("pc", "/checklists")).data;
  const byName = Object.fromEntries(list.map((c) => [c.name, c]));
  assert.strictEqual(byName.Oiling.openTask, null); // Ravi marked today's oiling just now
  assert.strictEqual(String(byName.Cleaning.openTask?._id), String(tasks.ravi.cleaning._id));
  assert.strictEqual(byName.Cleaning.openTask.count, 1);
  assert.strictEqual(String(byName.Cleaning.openTask.doer), String(ids.ravi));
  assert.ok(!byName["Oiling amit"], "the Store PC does not see the QC checklist");
});

test("each page has its own Done tick: Checklists' alone marks checklists, not delegations or FMS steps", async () => {
  assert.strictEqual((await give("pc", withDone("checklist"))).status, 200);
  const r = await post("pc", `/tasks/${tasks.ravi.cleaning._id}/done`, { remarks: "Cleaned, Ravi was on the floor" });
  assert.strictEqual(r.status, 200, r.data.message);
  assert.strictEqual(String(r.data.doneBy), String(ids.pc));
  assert.strictEqual((await post("pc", `/tasks/${tasks.ravi.delegation._id}/done`)).status, 403);
  assert.strictEqual((await post("pc", `/tasks/${tasks.ravi.step._id}/done`)).status, 403);
  // still only for the PC's own people
  assert.strictEqual((await post("pc", `/tasks/${tasks.amit.checklist[0]._id}/done`)).status, 403);
});

test("with the Delegations and FMS Entries Done ticks: the PC marks Ravi's delegation and step, but not Amit's", async () => {
  assert.strictEqual((await give("pc", withDone("checklist", "delegation", "fmsEntries"))).status, 200);
  const d = await post("pc", `/tasks/${tasks.ravi.delegation._id}/done`, { remarks: "Quote received on WhatsApp" });
  assert.strictEqual(d.status, 200, d.data.message);
  assert.strictEqual(String(d.data.doneBy), String(ids.pc));
  assert.strictEqual((await post("pc", `/tasks/${tasks.ravi.step._id}/done`)).status, 200);
  const amit = (await call("pc", `/jobs/${ids.job}`)).data.tasks.find((t) => String(t._id) === String(tasks.amit.step._id));
  assert.deepStrictEqual([amit.canAct, /reach/.test(amit.notAllowed)], [false, true], "Amit is outside the PC's people");
  assert.strictEqual((await post("pc", `/tasks/${tasks.amit.step._id}/done`)).status, 403);
});

test("reopening a step still goes by FMS Entries (edit); without the tick the PC is back to the doer-only rule", async () => {
  assert.strictEqual((await post("hod", `/tasks/${tasks.ravi.step._id}/reopen`)).status, 200);
  assert.strictEqual((await post("hod", `/tasks/${tasks.ravi.step._id}/done`)).status, 403); // reopened, but not his to mark
  assert.strictEqual((await give("pc", {})).status, 200);
  assert.strictEqual((await post("pc", `/tasks/${tasks.ravi.step._id}/done`)).status, 403);
  assert.strictEqual((await post("admin", `/tasks/${tasks.ravi.step._id}/done`)).status, 200); // the admin can always
});

test("migration: the old 'Done for others' row becomes the Done tick of the three pages, on the user", async () => {
  const mongoose = require("mongoose");
  const oid = (id) => new mongoose.Types.ObjectId(String(id));
  const User = require("../models/User");
  const Setting = require("../models/Setting");
  const { Department } = require("../models/Org");
  const { migrateDoneTicks } = require("../services/migrations");
  // what yesterday's version stored: on a user (with their own Checklists ticks), and on the QC department
  await User.collection.updateOne({ _id: oid(ids.pc) }, { $set: { permissions: { doneForOthers: ["edit"], checklist: ["view"] } } });
  await User.collection.updateOne({ _id: oid(ids.hod) }, { $set: { permissions: { doneForOthers: [] } } }); // taken away again
  await Department.collection.updateOne({ _id: oid(ids.qc) }, { $set: { permissions: { doneForOthers: ["edit"] } } });
  await Setting.deleteOne({ key: "migration.doneTicks" });
  await migrateDoneTicks();
  const perms = async (k) => (await User.findById(ids[k]).lean()).permissions;
  // the PC keeps their own Checklists view and gets Done next to what they had on each page
  assert.deepStrictEqual(await perms("pc"), { checklist: ["view", "done"], delegation: ["view", "add", "edit", "done"], fmsEntries: ["view", "add", "edit", "done"] });
  assert.strictEqual(await perms("hod"), undefined); // nothing given, nothing left
  // Amit had it through the QC department: now on him; the department no longer has the old row
  assert.deepStrictEqual(await perms("amit"), { checklist: ["done"], delegation: ["done"], fmsEntries: ["view", "add", "done"] });
  assert.strictEqual((await Department.findById(ids.qc).lean()).permissions, undefined);
  assert.strictEqual(await perms("ravi"), undefined); // never had it
  // the moved tick still stops at the people one reaches: the Store PC may not mark the QC checklist
  assert.strictEqual((await post("pc", `/tasks/${tasks.amit.checklist[0]._id}/done`)).status, 403);
  // runs once
  await User.collection.updateOne({ _id: oid(ids.ravi) }, { $set: { permissions: { doneForOthers: ["edit"] } } });
  await migrateDoneTicks();
  assert.deepStrictEqual(await perms("ravi"), { doneForOthers: ["edit"] });
});
