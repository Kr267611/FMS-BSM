// Checklists and delegations through the API: schedules, generation, forms, auto-close, bulk upload,
// deadline changes, reopen and the MIS rows they produce.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "node_modules", ".cache", "mongodb-memory-server");
const { MongoMemoryServer } = require("mongodb-memory-server-core");

let srv, server, base;
const DAY = 24 * 60 * 60 * 1000;
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_tasks_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
});

test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});

async function call(p, { session, method = "GET", body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json", ...(session ? { Cookie: session } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : await res.text();
  return { status: res.status, data };
}
async function login(username, password = "Pass12345") {
  const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  return (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("fms_session=")).split(";")[0];
}

const people = {};
const sessions = {};
let today, tomorrow, Task, Checklist, dates;

test("setup: users, and a calendar with no week-off so the test runs the same on any day", async () => {
  Task = require("../models/Task");
  Checklist = require("../models/Checklist");
  dates = require("../services/dates");
  today = dates.todayKey();
  tomorrow = dates.addDaysKey(today, 1);
  sessions.admin = await login("admin", "Admin1234");
  for (const [username, name, role] of [
    ["sunil", "Sunil Singh", "doer"],
    ["ankit", "Ankitbhai", "doer"],
    ["mpc", "Maint PC", "pc"],
  ]) {
    const r = await call("/users", { session: sessions.admin, method: "POST", body: { name, username, password: "Pass12345", role } });
    assert.strictEqual(r.status, 201, r.data.message);
    people[username] = r.data._id;
    sessions[username] = await login(username);
  }
  const cal = await call("/settings/calendar", { session: sessions.admin, method: "PUT", body: { weekOff: [], start: "09:00", end: "18:00", holidays: [] } });
  assert.strictEqual(cal.status, 200, cal.data.message);
});

test("checklist form is checked, and the schedule preview lists the next due days", async () => {
  const bad = (body) => call("/checklists", { session: sessions.admin, method: "POST", body });
  assert.match((await bad({ frequency: { type: "daily" }, doer: people.sunil })).data.message, /name/);
  assert.match((await bad({ name: "Oiling", frequency: { type: "weekly", days: [] }, doer: people.sunil })).data.message, /weekday/);
  assert.match((await bad({ name: "Oiling", frequency: { type: "daily" } })).data.message, /doer/);
  assert.match((await bad({ name: "Oiling", frequency: { type: "monthly", dates: [] }, doer: people.sunil })).data.message, /date of the month/);

  const p = await call("/checklists/preview", { session: sessions.admin, method: "POST", body: { frequency: { type: "weekly", days: [1] } } });
  assert.strictEqual(p.status, 200, p.data.message);
  assert.strictEqual(p.data.schedule, "Every Mon");
  assert.strictEqual(p.data.days.length, 8);
  for (const d of p.data.days) {
    assert.strictEqual(new Date(d + "T00:00:00Z").getUTCDay(), 1);
    assert.ok(d >= today);
  }

  // a PC only gives checklists to people they oversee
  const scoped = await call("/checklists", { session: sessions.mpc, method: "POST", body: { name: "Oiling", frequency: { type: "daily" }, doer: people.sunil } });
  assert.strictEqual(scoped.status, 403);
  // a doer cannot make checklists
  assert.strictEqual((await call("/checklists", { session: sessions.sunil })).status, 403);
});

let oiling;
test("a daily checklist makes today's task and, with 'create before', tomorrow's – never twice", async () => {
  const r = await call("/checklists", {
    session: sessions.admin,
    method: "POST",
    body: {
      name: "JET section oiling",
      how: "Oil all JET gearboxes and note the level.",
      doer: people.sunil,
      frequency: { type: "daily" },
      dueTime: "11:00",
      createBefore: 1,
      priority: "high",
      fields: [{ label: "Oil level (%)", type: "number", required: true }],
    },
  });
  assert.strictEqual(r.status, 201, r.data.message);
  oiling = r.data._id;
  const tasks = await Task.find({ checklist: oiling }).sort({ plannedDay: 1 }).lean();
  assert.deepStrictEqual(tasks.map((t) => t.plannedDay), [today, tomorrow]);
  assert.strictEqual(tasks[0].status, "pending");
  assert.strictEqual(tasks[0].priority, "high");
  assert.strictEqual(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(tasks[0].planned), "11:00");

  const { sweepAll } = require("../services/sweep");
  await sweepAll();
  await sweepAll();
  assert.strictEqual(await Task.countDocuments({ checklist: oiling }), 2);

  const list = await call("/checklists", { session: sessions.admin });
  const row = list.data.find((c) => c._id === oiling);
  assert.strictEqual(row.schedule, "Every day");
  assert.strictEqual(row.nextDue, today);
  assert.strictEqual(row.doer.name, "Sunil Singh");
});

test("the doer fills the checklist form; Not Required needs a reason", async () => {
  const mine = await call("/tasks", { session: sessions.sunil });
  const t = mine.data.tasks.filter((x) => x.kind === "checklist");
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].checklist.how, "Oil all JET gearboxes and note the level.");
  assert.deepStrictEqual(t[0].formFields.map((f) => f.label), ["Oil level (%)"]);

  const [first, second] = t;
  assert.match((await call(`/tasks/${first._id}/done`, { session: sessions.sunil, method: "POST", body: {} })).data.message, /Oil level/);
  assert.strictEqual((await call(`/tasks/${first._id}/done`, { session: sessions.ankit, method: "POST", body: { values: { oil_level: 80 } } })).status, 403);
  const done = await call(`/tasks/${first._id}/done`, { session: sessions.sunil, method: "POST", body: { values: { oil_level: 80 }, remarks: "All ok" } });
  assert.strictEqual(done.status, 200, done.data.message);
  assert.strictEqual(done.data.values.oil_level, 80);
  assert.strictEqual(done.data.actualDay, today);
  assert.strictEqual((await call(`/tasks/${first._id}/done`, { session: sessions.sunil, method: "POST", body: { values: { oil_level: 80 } } })).status, 400);

  assert.match((await call(`/tasks/${second._id}/not-required`, { session: sessions.sunil, method: "POST", body: { remarks: "" } })).data.message, /why/);
  const na = await call(`/tasks/${second._id}/not-required`, { session: sessions.sunil, method: "POST", body: { remarks: "Section shut for maintenance" } });
  assert.strictEqual(na.data.status, "na");

  // a PC / admin can reopen it
  const back = await call(`/tasks/${second._id}/reopen`, { session: sessions.admin, method: "POST" });
  assert.strictEqual(back.data.status, "pending");
});

test("changing a checklist remakes the later days only; switching off removes them", async () => {
  const r = await call("/checklists", {
    session: sessions.admin,
    method: "POST",
    body: { name: "Boiler pressure log", doer: people.sunil, frequency: { type: "daily" }, createBefore: 2 },
  });
  const id = r.data._id;
  assert.strictEqual(await Task.countDocuments({ checklist: id }), 3);

  const edit = await call(`/checklists/${id}`, { session: sessions.admin, method: "PUT", body: { ...r.data, doer: people.ankit } });
  assert.strictEqual(edit.status, 200, edit.data.message);
  const tasks = await Task.find({ checklist: id }).sort({ plannedDay: 1 }).lean();
  assert.deepStrictEqual(tasks.map((t) => [t.plannedDay, String(t.doer)]), [
    [today, people.sunil],
    [tomorrow, people.ankit],
    [dates.addDaysKey(today, 2), people.ankit],
  ]);

  const off = await call(`/checklists/${id}`, { session: sessions.admin, method: "PUT", body: { ...r.data, doer: people.ankit, active: false } });
  assert.strictEqual(off.data.active, false);
  assert.deepStrictEqual((await Task.find({ checklist: id }).lean()).map((t) => t.plannedDay), [today]);

  // it has a task in the MIS already, so it can only be switched off, not deleted
  assert.match((await call(`/checklists/${id}`, { session: sessions.admin, method: "DELETE" })).data.message, /Switch it off/);

  // switched back on: no backlog, it continues from today
  await call(`/checklists/${id}`, { session: sessions.admin, method: "PUT", body: { ...r.data, doer: people.ankit, active: true } });
  assert.strictEqual(await Task.countDocuments({ checklist: id }), 3);
});

test("a checklist that was never due can be deleted", async () => {
  const r = await call("/checklists", {
    session: sessions.admin,
    method: "POST",
    body: { name: "Year-end stock count", doer: people.ankit, frequency: { type: "monthly", dates: [31], every: 12 }, start: dates.addDaysKey(today, 40) },
  });
  assert.strictEqual(r.status, 201, r.data.message);
  assert.strictEqual(await Task.countDocuments({ checklist: r.data._id }), 0);
  assert.strictEqual((await call(`/checklists/${r.data._id}`, { session: sessions.admin, method: "DELETE" })).status, 200);
});

test("bulk upload: check first, then create; names are matched to users", async () => {
  const rows = [
    { task: "Compressor drain", doer: "Sunil Singh", frequency: "Weekly", days: "Mon, Thu", due_time: "10:30 AM", group: "Maintenance" },
    { task: "Fire extinguisher check", doer: "ankit", frequency: "Quarterly", dates: "1", start: "01/01/2026", proof: "Yes" },
    { task: "Ghost task", doer: "Nobody", frequency: "Daily" },
    { task: "Odd schedule", doer: "Sunil Singh", frequency: "Sometimes" },
  ];
  const check = await call("/checklists/bulk", { session: sessions.admin, method: "POST", body: { rows } });
  assert.strictEqual(check.status, 200, check.data.message);
  assert.strictEqual(check.data.dryRun, true);
  assert.deepStrictEqual(check.data.results.map((r) => r.ok), [true, true, false, false]);
  assert.strictEqual(check.data.results[0].schedule, "Every Mon, Thu");
  assert.strictEqual(check.data.results[1].schedule, "Every 3 months on 1");
  assert.match(check.data.results[2].error, /Nobody/);
  assert.match(check.data.results[3].error, /Sometimes/);
  assert.strictEqual(await Checklist.countDocuments({ name: "Compressor drain" }), 0);

  const made = await call("/checklists/bulk", { session: sessions.admin, method: "POST", body: { rows: rows.slice(0, 2), dryRun: false } });
  assert.strictEqual(made.data.ok, 2);
  const c = await Checklist.findOne({ name: "Compressor drain" }).populate("group").lean();
  assert.strictEqual(c.dueTime, "10:30");
  assert.strictEqual(c.group.name, "Maintenance");
  const fire = await Checklist.findOne({ name: "Fire extinguisher check" }).lean();
  assert.strictEqual(fire.fields[0].type, "photo");
  assert.strictEqual(fire.fields[0].required, true);
  assert.strictEqual(String(fire.doer), people.ankit);

  // uploading the same file again does not make duplicates
  const again = await call("/checklists/bulk", { session: sessions.admin, method: "POST", body: { rows: rows.slice(0, 2) } });
  assert.deepStrictEqual(again.data.results.map((r) => r.ok), [false, false]);
  assert.match(again.data.results[0].error, /already has a checklist/);
  const twice = await call("/checklists/bulk", { session: sessions.admin, method: "POST", body: { rows: [rows[2], { ...rows[0], doer: "ankit" }, { ...rows[0], doer: "ankit" }] } });
  assert.match(twice.data.results[2].error, /already in this file/);
});

let job;
test("delegation: assigned with a deadline; proof photo required when asked for", async () => {
  const bad = await call("/delegations", { session: sessions.admin, method: "POST", body: { title: "Quote", doer: people.sunil, planned: new Date(Date.now() - DAY) } });
  assert.match(bad.data.message, /past/);
  assert.strictEqual((await call("/delegations", { session: sessions.sunil, method: "POST", body: { title: "Quote", doer: people.ankit, planned: new Date(Date.now() + DAY) } })).status, 403);

  const r = await call("/delegations", {
    session: sessions.admin,
    method: "POST",
    body: { title: "Get 3 quotes for the JET-12 gearbox", details: "From approved vendors only", doer: people.sunil, planned: new Date(Date.now() + DAY), priority: "critical", proofRequired: true },
  });
  assert.strictEqual(r.status, 201, r.data.message);
  job = r.data;
  const mine = await call("/tasks?kind=delegation", { session: sessions.sunil });
  assert.strictEqual(mine.data.tasks.length, 1);
  assert.strictEqual(mine.data.tasks[0].assignedBy.name, "Admin");
  assert.deepStrictEqual(mine.data.tasks[0].formFields.map((f) => f.type), ["photo"]);
  assert.match((await call(`/tasks/${job._id}/not-required`, { session: sessions.sunil, method: "POST", body: { remarks: "No need" } })).data.message, /cannot be marked Not Required/);
});

test("delegation: the doer asks for a new deadline before it passes, at most twice; the assigner decides", async () => {
  const ask = (days, reason = "Vendor on leave") =>
    call(`/delegations/${job._id}/revision`, { session: sessions.sunil, method: "POST", body: { planned: new Date(new Date(job.planned).getTime() + days * DAY), reason } });
  assert.match((await ask(2, "")).data.message, /why/);
  assert.strictEqual((await ask(2)).status, 200);
  assert.match((await ask(3)).data.message, /already waiting/);
  assert.strictEqual((await call(`/delegations/${job._id}/revision/approve`, { session: sessions.sunil, method: "POST" })).status, 403);
  const ok = await call(`/delegations/${job._id}/revision/approve`, { session: sessions.admin, method: "POST", body: { note: "Fine" } });
  assert.strictEqual(new Date(ok.data.planned).getTime(), new Date(job.planned).getTime() + 2 * DAY);

  assert.strictEqual((await ask(3)).status, 200);
  await call(`/delegations/${job._id}/revision/reject`, { session: sessions.admin, method: "POST" });
  assert.strictEqual((await ask(4)).status, 200);
  await call(`/delegations/${job._id}/revision/approve`, { session: sessions.admin, method: "POST" });
  assert.match((await ask(6)).data.message, /moved 2 times/);

  const detail = await call(`/delegations/${job._id}`, { session: sessions.admin });
  assert.deepStrictEqual(detail.data.revisions.map((r) => r.status), ["approved", "rejected", "approved"]);
  assert.strictEqual(detail.data.canManage, true);
  assert.ok(detail.data.log.length >= 7);
});

test("delegation: done with proof; reopened by the assigner keeps its deadline", async () => {
  assert.match((await call(`/tasks/${job._id}/done`, { session: sessions.sunil, method: "POST", body: {} })).data.message, /Proof/);
  const up = await call("/files", { session: sessions.sunil, method: "POST", body: { data: JPEG, name: "quotes.jpg" } });
  const done = await call(`/tasks/${job._id}/done`, { session: sessions.sunil, method: "POST", body: { values: { proof: [up.data.id] }, remarks: "3 quotes attached" } });
  assert.strictEqual(done.status, 200, done.data.message);

  assert.strictEqual((await call(`/tasks/${job._id}/reopen`, { session: sessions.sunil, method: "POST" })).status, 403);
  const before = (await Task.findById(job._id).lean()).planned.getTime();
  const back = await call(`/tasks/${job._id}/reopen`, { session: sessions.admin, method: "POST", body: { remarks: "Only 2 quotes" } });
  assert.strictEqual(back.data.status, "pending");
  assert.strictEqual(back.data.reopenCount, 1);
  assert.strictEqual(new Date(back.data.planned).getTime(), before);
});

test("delegation: after the deadline the doer and deadline are locked and it cannot be deleted (admin excepted)", async () => {
  const d = require("../services/delegations");
  const User = require("../models/User");
  const pc = await User.findById(people.mpc).lean();
  const sunil = await User.findById(people.sunil).lean();
  const admin = await User.findOne({ username: "admin" }).lean();
  const t = await d.createDelegation(pc, { title: "Send the breakdown report", doer: people.sunil, planned: new Date(Date.now() + 60 * 60 * 1000) });
  const later = { now: new Date(Date.now() + 2 * 60 * 60 * 1000) };

  await assert.rejects(d.requestRevision(t._id, sunil, { planned: new Date(Date.now() + DAY), reason: "Busy" }, later), /already passed/);
  await assert.rejects(d.updateDelegation(t._id, pc, { doer: people.ankit }, later), /doer can no longer be changed/);
  await assert.rejects(d.updateDelegation(t._id, pc, { planned: new Date(Date.now() + DAY) }, later), /can no longer be moved/);
  await assert.rejects(d.deleteDelegation(t._id, pc, later), /Only an admin/);
  // before the deadline the assigner may still change it
  const { task } = await d.updateDelegation(t._id, pc, { doer: people.ankit });
  assert.strictEqual(String(task.doer), people.ankit);
  await d.deleteDelegation(t._id, admin, later);
  assert.strictEqual(await Task.exists({ _id: t._id }), null);
});

test("MIS: checklists by name, delegations in one row, auto-closed checklist counts as pending", async () => {
  // due today, auto-closes at midnight
  const r = await call("/checklists", {
    session: sessions.admin,
    method: "POST",
    body: { name: "Store floor cleaning", doer: people.ankit, frequency: { type: "daily" }, autoCloseDays: 0 },
  });
  const t = await Task.findOne({ checklist: r.data._id, plannedDay: today }).lean();
  assert.ok(t.closeAt > new Date());
  const { sweepChecklists } = require("../services/checklists");
  const swept = await sweepChecklists(new Date(t.closeAt.getTime() + 1000));
  assert.ok(swept.expired >= 1);
  assert.strictEqual((await Task.findById(t._id).lean()).status, "expired");
  // auto-closed tasks leave the pending list and cannot be done any more
  assert.ok(!(await call("/tasks", { session: sessions.ankit })).data.tasks.some((x) => x._id === String(t._id)));
  assert.match((await call(`/tasks/${t._id}/done`, { session: sessions.ankit, method: "POST", body: {} })).data.message, /auto-closed/);

  // a delegation due today, done on time
  const del = await call("/delegations", { session: sessions.admin, method: "POST", body: { title: "Call the gearbox vendor", doer: people.ankit, planned: new Date(Date.now() + 60 * 1000) } });
  await call(`/tasks/${del.data._id}/done`, { session: sessions.ankit, method: "POST", body: {} });

  const mis = await call(`/mis?from=${today}&to=${today}`, { session: sessions.admin });
  const ankit = mis.data.doers.find((x) => x.doer.name === "Ankitbhai");
  const row = (label) => ankit.rows.find((x) => x.label === label);
  assert.deepStrictEqual(
    { planned: row("Store floor cleaning").planned, pending: row("Store floor cleaning").pending, autoClosed: row("Store floor cleaning").autoClosed, score: row("Store floor cleaning").score },
    { planned: 1, pending: 1, autoClosed: 1, score: -100 }
  );
  assert.deepStrictEqual({ planned: row("Delegations").planned, onTime: row("Delegations").onTime, kind: row("Delegations").kind }, { planned: 1, onTime: 1, kind: "delegation" });
  assert.strictEqual(ankit.rows[0].kind, "checklist"); // checklists first, then delegations, then FMS

  const sunil = mis.data.doers.find((x) => x.doer.name === "Sunil Singh");
  const oilRow = sunil.rows.find((x) => x.label === "JET section oiling");
  assert.deepStrictEqual({ planned: oilRow.planned, onTime: oilRow.onTime }, { planned: 1, onTime: 1 });

  const daily = await call(`/mis/daily?doer=${people.ankit}&from=${today}&to=${today}&label=Delegations`, { session: sessions.admin });
  assert.strictEqual(daily.data.days[0].planned, 1);
});

test("MIS: a pending task counts only once its due time has passed", async () => {
  const { misReport } = require("../services/scoring");
  const due = new Date(Date.now() + 60 * 1000);
  const r = await call("/delegations", { session: sessions.admin, method: "POST", body: { title: "Check the dryer temperature log", doer: people.mpc, planned: due } });
  assert.strictEqual(r.status, 201, r.data.message);
  const row = async (now) => (await misReport({ from: today, to: today, doerId: people.mpc, now })).doers[0]?.rows.find((x) => x.label === "Delegations");
  assert.strictEqual(await row(new Date(due.getTime() - 60 * 60 * 1000)), undefined); // not due yet: not counted
  assert.deepStrictEqual((({ planned, pending, score }) => ({ planned, pending, score }))(await row(new Date(due.getTime() + 60 * 1000))), { planned: 1, pending: 1, score: -100 });
});

test("Team Leader sees only their team; any password of 4+ characters works", async () => {
  const tl = await call("/users", { session: sessions.admin, method: "POST", body: { name: "Line TL", username: "linetl", password: "1234", role: "tl" } });
  assert.strictEqual(tl.status, 201, tl.data.message);
  assert.match((await call("/users", { session: sessions.admin, method: "POST", body: { name: "X", username: "xx", password: "123" } })).data.message, /at least 4/);
  await call(`/users/${people.sunil}`, { session: sessions.admin, method: "PUT", body: { teamLeader: tl.data._id } });
  const s = await login("linetl", "1234");
  assert.strictEqual((await call(`/tasks?doer=${people.sunil}`, { session: s })).status, 200);
  assert.strictEqual((await call(`/tasks?doer=${people.ankit}`, { session: s })).status, 403);
  const me = await call("/auth/me", { session: s });
  assert.ok(me.data.permissions.delegation.includes("add"));
});
