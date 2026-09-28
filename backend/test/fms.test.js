// FMS engine v2 through the API: template, entries, step forms with photos, escalation sweep,
// Status by PC, corrections, export, calendar settings and the v1 -> v2 upgrade.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "node_modules", ".cache", "mongodb-memory-server");
const { MongoMemoryServer } = require("mongodb-memory-server-core");

let srv, server, base;
const DAY = 24 * 60 * 60 * 1000;
// Smallest JPEG
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234" });
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
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data, type };
}
async function login(username, password = "Pass12345") {
  const res = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("fms_session="));
  return cookie.split(";")[0];
}

const people = {};
let admin, processId;
const byKey = (job) => Object.fromEntries(job.tasks.map((t) => [t.stepKey, t]));

test("setup: users named as in the sheet", async () => {
  admin = await login("admin", "Admin1234");
  for (const [username, name, role] of [
    ["ankit", "Ankitbhai", "doer"],
    ["pradeep", "Pradeep Bhai", "doer"],
    ["paresh", "Paresh Bhai", "doer"],
    ["nikunj", "Nikunjbhai", "doer"],
    ["ayush", "Ayush Sir", "doer"],
    ["bhavesh", "Bhaveshbhai", "doer"],
    ["sunil", "Sunil Singh", "doer"],
    ["pcuser", "Maint PC", "pc"],
  ]) {
    const r = await call("/users", { session: admin, method: "POST", body: { name, username, password: "Pass12345", role } });
    assert.strictEqual(r.status, 201, r.data.message);
    people[username] = r.data._id;
  }
});

test("Repeat Spare Part template: doers matched by name, saves as an active FMS", async () => {
  const list = await call("/processes/templates", { session: admin });
  assert.ok(list.data.find((t) => t.id === "repeat-spare-part"));
  const draft = (await call("/processes/templates/repeat-spare-part", { session: admin })).data;
  assert.strictEqual(draft.active, true);
  assert.strictEqual(draft.steps[0].doer.user, people.ankit);
  assert.strictEqual(draft.steps[1].doer.fallback, people.pradeep);
  const saved = await call("/processes", { session: admin, method: "POST", body: { ...draft, pc: people.pcuser } });
  assert.strictEqual(saved.status, 201, saved.data.message);
  processId = saved.data._id;
  assert.strictEqual(saved.data.steps.length, 6);

  // A doer cannot change the FMS
  const doer = await login("sunil");
  assert.strictEqual((await call(`/processes/${processId}`, { session: doer, method: "PUT", body: draft })).status, 403);
});

const JET5 = { item_name: "Bearing 6205", machine_no: "JET-5", item_group: "Mechanical", last_issue_date: "2026-08-01", rate: 1200 };

test("preview shows who gets each step and the calculated fields", async () => {
  const r = await call("/jobs/preview", { session: admin, method: "POST", body: { process: processId, data: { ...JET5, repeat_frq: 1 } } });
  assert.strictEqual(r.status, 200);
  const s = Object.fromEntries(r.data.steps.map((x) => [x.key, x]));
  assert.strictEqual(s.s1.doer.name, "Ankitbhai");
  assert.strictEqual(s.s2.doer.name, "Sunil Singh"); // JET 5 mechanical = head fitter
  assert.strictEqual(s.s4.status, "skipped");
  assert.ok(r.data.values.days_in_diff > 0);
});

let fresh, late;
test("new entries: required fields, a late entry escalates at once, a fresh one waits", async () => {
  const missing = await call("/jobs", { session: admin, method: "POST", body: { process: processId, data: { item_name: "x" } } });
  assert.strictEqual(missing.status, 400);

  const a = await call("/jobs", { session: admin, method: "POST", body: { process: processId, data: { ...JET5, repeat_frq: 6 } } });
  assert.strictEqual(a.status, 201, a.data.message);
  fresh = (await call(`/jobs/${a.data._id}`, { session: admin })).data;
  let t = byKey(fresh);
  assert.deepStrictEqual([t.s1.status, t.s2.status, t.s3.status, t.s5.status], ["pending", "pending", "waiting", "waiting"]);
  assert.ok(new Date(t.s3.triggerAt) > new Date(), "Step 3 escalates after Step 2's planned day");
  assert.strictEqual(t.s2.doer.name, "Sunil Singh");

  const b = await call("/jobs", {
    session: admin,
    method: "POST",
    body: { process: processId, data: { ...JET5, repeat_frq: 6 }, startDate: new Date(Date.now() - 30 * DAY).toISOString() },
  });
  late = (await call(`/jobs/${b.data._id}`, { session: admin })).data;
  t = byKey(late);
  assert.deepStrictEqual(Object.values(t).map((x) => x.status), Array(6).fill("pending"));
  assert.strictEqual(t.s6.doer.name, "Bhaveshbhai");
});

test("step form: required photo, upload, done with values; Permanent Solved ends the ladder", async () => {
  const store = await login("ankit");
  const t = byKey(fresh);
  const noPhoto = await call(`/tasks/${t.s1._id}/done`, { session: store, method: "POST", body: { values: { old_part_received: "Yes", reason: "Worn out" } } });
  assert.strictEqual(noPhoto.status, 400);
  assert.match(noPhoto.data.message, /photo" is required/i);

  const bad = await call("/files", { session: store, method: "POST", body: { data: "data:image/jpeg;base64,aGVsbG8=" } });
  assert.strictEqual(bad.status, 400);
  const up = await call("/files", { session: store, method: "POST", body: { data: JPEG, name: "old.jpg" } });
  assert.strictEqual(up.status, 201);
  const img = await fetch(`${base}/files/${up.data.id}`, { headers: { Cookie: store } });
  assert.strictEqual(img.headers.get("content-type"), "image/jpeg");
  assert.strictEqual((await fetch(`${base}/files/${up.data.id}`)).status, 401); // needs a session

  const values = { old_part_received: "Yes", old_part_photo: [up.data.id], new_part_photo: [up.data.id], reason: "Worn out" };
  assert.strictEqual((await call(`/tasks/${t.s1._id}/done`, { session: store, method: "POST", body: { values } })).status, 200);

  // Someone else's task
  assert.strictEqual((await call(`/tasks/${t.s2._id}/done`, { session: store, method: "POST", body: {} })).status, 403);

  const sunil = await login("sunil");
  const mine = (await call("/tasks", { session: sunil })).data.tasks.find((x) => x._id === t.s2._id);
  assert.strictEqual(mine.step.fields.find((f) => f.key === "status").options.length, 2, "task list carries the step form");
  const r = await call(`/tasks/${t.s2._id}/done`, {
    session: sunil,
    method: "POST",
    body: { values: { status: "Permanent Solved", remarks: "Root cause fixed", action_taken: "Changed the shaft" } },
  });
  assert.strictEqual(r.status, 200, r.data.message);
  const after = (await call(`/jobs/${fresh._id}`, { session: admin })).data;
  assert.strictEqual(after.status, "closed");
  assert.deepStrictEqual(after.tasks.map((x) => x.status), ["done", "done", "skipped", "skipped", "skipped", "skipped"]);
  assert.ok(after.history.some((h) => h.action === "task.done"));
});

test("escalation sweep starts a step when its time comes", async () => {
  const a = await call("/jobs", { session: admin, method: "POST", body: { process: processId, data: { ...JET5, repeat_frq: 3 } } });
  const { sweepDue } = require("../services/workflow");
  assert.strictEqual(await sweepDue(new Date()), 0); // Step 2 is not overdue yet
  assert.ok((await sweepDue(new Date(Date.now() + 10 * DAY))) >= 1); // ten days later
  const t = byKey((await call(`/jobs/${a.data._id}`, { session: admin })).data);
  assert.strictEqual(t.s3.status, "pending");
  assert.strictEqual(t.s5.status, "pending"); // starts together with Step 3 (Frq >= 3)
  assert.strictEqual(t.s5.doer.name, "Ayush Sir");
});

test("Status by PC closes an entry; only people who may edit entries can do it", async () => {
  const doer = await login("sunil");
  assert.strictEqual((await call(`/jobs/${late._id}/close`, { session: doer, method: "POST", body: { status: "Problem Solved" } })).status, 403);
  const pc = await login("pcuser");
  assert.strictEqual((await call(`/jobs/${late._id}/close`, { session: pc, method: "POST", body: { status: "Nope" } })).status, 400);
  const r = await call(`/jobs/${late._id}/close`, { session: pc, method: "POST", body: { status: "problem solved", remarks: "Checked" } });
  assert.strictEqual(r.status, 200, r.data.message);
  let j = (await call(`/jobs/${late._id}`, { session: admin })).data;
  assert.strictEqual(j.closeStatus, "Problem Solved");
  assert.ok(j.tasks.every((t) => t.status === "done" && t.autoClosed));
  assert.strictEqual((await call(`/tasks/${j.tasks[0]._id}/reopen`, { session: admin, method: "POST" })).status, 400);

  assert.strictEqual((await call(`/jobs/${late._id}/reopen`, { session: pc, method: "POST" })).status, 200);
  j = (await call(`/jobs/${late._id}`, { session: admin })).data;
  assert.strictEqual(j.status, "open");
  assert.ok(j.tasks.every((t) => t.status === "pending"));
});

test("correcting an entry re-checks steps that were skipped by a condition", async () => {
  const a = await call("/jobs", {
    session: admin,
    method: "POST",
    body: { process: processId, data: { ...JET5, repeat_frq: 1 }, startDate: new Date(Date.now() - 20 * DAY).toISOString() },
  });
  let t = byKey((await call(`/jobs/${a.data._id}`, { session: admin })).data);
  assert.strictEqual(t.s5.status, "skipped");
  const r = await call(`/jobs/${a.data._id}`, { session: admin, method: "PUT", body: { data: { ...JET5, repeat_frq: 4 } } });
  assert.strictEqual(r.status, 200, r.data.message);
  t = byKey((await call(`/jobs/${a.data._id}`, { session: admin })).data);
  assert.strictEqual(t.s5.status, "pending");
  assert.strictEqual(t.s4.status, "pending");
});

test("entries list, search, export and MIS skip what is not scored", async () => {
  const list = (await call(`/jobs?process=${processId}&q=bearing`, { session: admin })).data;
  assert.ok(list.total >= 4);
  assert.strictEqual((await call(`/jobs?process=${processId}&q=nothing-like-this`, { session: admin })).data.total, 0);

  const csv = await call(`/jobs/export?process=${processId}`, { session: admin });
  assert.match(csv.type, /text\/csv/);
  assert.ok(csv.data.includes("Escalate to Paresh bhai – Planned"));

  const mis = (await call(`/mis?doer=${people.paresh}&from=2026-01-01&to=2030-12-31`, { session: admin })).data;
  const row = mis.doers[0]?.total;
  assert.ok(row && row.planned >= 1, "Paresh has scored steps");
  // the fresh entry's skipped Step 3 is not counted
  const Task = require("../models/Task");
  const scored = await Task.countDocuments({ doer: people.paresh, status: { $in: ["pending", "done"] } });
  assert.ok(row.planned <= scored);
});

test("working calendar settings: admin only, holidays sorted and de-duplicated", async () => {
  const doer = await login("sunil");
  const body = { weekOff: [0], start: "09:00", end: "18:00", holidays: [{ day: "2026-10-20", name: "Diwali" }, { day: "2026-10-02", name: "Gandhi Jayanti" }, { day: "2026-10-20" }] };
  assert.strictEqual((await call("/settings/calendar", { session: doer, method: "PUT", body })).status, 403);
  const r = await call("/settings/calendar", { session: admin, method: "PUT", body });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.holidays.map((h) => h.day), ["2026-10-02", "2026-10-20"]);
  assert.strictEqual((await call("/settings/calendar", { session: admin, method: "PUT", body: { ...body, end: "08:00" } })).status, 400);
});

test("v1 FMS in the database is upgraded to engine v2 and keeps working", async () => {
  const mongoose = require("mongoose");
  const db = mongoose.connection.db;
  const doerId = new mongoose.Types.ObjectId(people.sunil);
  const { insertedId: pid } = await db.collection("processes").insertOne({
    name: "Old QC",
    skipSundays: true,
    fields: [{ key: "lot", label: "Lot", type: "text", required: false }],
    steps: [
      { _id: new mongoose.Types.ObjectId(), name: "Inspect", doer: doerId, tat: 1, tatUnit: "days" },
      { _id: new mongoose.Types.ObjectId(), name: "Report", doer: doerId, tat: 2, tatUnit: "days" },
    ],
    active: true,
    jobCounter: 1,
  });
  const { insertedId: jid } = await db.collection("jobs").insertOne({ process: pid, jobNo: "1", startDate: new Date(), data: {}, status: "open" });
  const planned = new Date(Date.now() + DAY);
  const { insertedId: t1 } = await db.collection("tasks").insertOne({ kind: "app", label: "Old QC – Inspect", doer: doerId, process: pid, job: jid, stepIndex: 0, stepName: "Inspect", status: "pending", planned, plannedDay: planned.toISOString().slice(0, 10), remarks: "" });
  await db.collection("tasks").insertOne({ kind: "app", label: "Old QC – Report", doer: doerId, process: pid, job: jid, stepIndex: 1, stepName: "Report", status: "waiting", remarks: "" });

  await require("../services/migrations").runMigrations();
  const p = (await call(`/processes/${pid}`, { session: admin })).data;
  assert.strictEqual(p.version, 2);
  assert.strictEqual(p.calendar.mode, "calendar_skip");
  assert.deepStrictEqual(p.steps[1].start, { mode: "afterDone", step: "s1" });
  assert.strictEqual(p.steps[0].doer.user._id, people.sunil);

  const sunil = await login("sunil");
  assert.strictEqual((await call(`/tasks/${t1}/done`, { session: sunil, method: "POST", body: { remarks: "ok" } })).status, 200);
  const j = (await call(`/jobs/${jid}`, { session: admin })).data;
  assert.strictEqual(byKey(j).s2.status, "pending");
});
