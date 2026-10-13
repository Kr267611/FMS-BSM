// Help Ticket: categories, raise -> auto-assign -> working -> solved -> confirmed / reopened, unassigned
// tickets, cancel, Done from My Tasks, auto-close, the MIS row and the report
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";

let srv, server, base;
const cookies: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_tickets_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
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
const cat = (name) => ids.cats.find((c) => c.name === name)._id;

test("setup: the usual categories are there; only admins change them; a solver for Maintenance", async () => {
  await login("admin", "Admin1234");
  for (const [k, name] of [["op", "Operator"], ["fitter", "Fitter"], ["hr", "HR Person"]]) {
    const u = await call("admin", "/users", { method: "POST", body: { name, username: k, password: "1234", role: "doer" } });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
    await login(k, "1234");
  }
  ids.cats = (await call("op", "/tickets/categories")).data;
  assert.deepStrictEqual(ids.cats.map((c) => c.name), ["Electrical", "HR", "IT", "Maintenance", "Other", "Store"]);
  assert.strictEqual((await call("op", "/tickets/categories", { method: "POST", body: { name: "Mine", tatHours: 4 } })).status, 403);
  const m = ids.cats.find((c) => c.name === "Maintenance");
  const upd = await call("admin", `/tickets/categories/${m._id}`, { method: "PUT", body: { ...m, solver: ids.fitter, tatHours: 4 } });
  assert.strictEqual(upd.status, 200, upd.data.message);
  assert.match((await call("admin", "/tickets/categories", { method: "POST", body: { name: "X", tatHours: 0 } })).data.message, /TAT/);
});

test("raise -> goes to the category's solver with a solve-by time; only the solver works on it", async () => {
  assert.match((await call("op", "/tickets", { method: "POST", body: { category: cat("Maintenance"), title: "x" } })).data.message, /few words/);
  const r = await call("op", "/tickets", { method: "POST", body: { category: cat("Maintenance"), title: "JET-5 motor is overheating", description: "Since morning", location: "JET-5", priority: "high" } });
  assert.strictEqual(r.status, 201, r.data.message);
  assert.strictEqual(r.data.code, "HT-0001");
  assert.strictEqual(String(r.data.solver), ids.fitter);
  assert.ok(r.data.planned);
  ids.t1 = r.data._id;
  const Task = require("../models/Task");
  const task = await Task.findOne({ ticket: ids.t1 }).lean();
  assert.deepStrictEqual([task.kind, String(task.doer), task.status, task.priority], ["ticket", ids.fitter, "pending", "high"]);
  assert.match(task.label, /^HT-0001 · JET-5/);

  assert.strictEqual((await call("fitter", "/tickets?view=assigned")).data.length, 1);
  assert.strictEqual((await call("op", "/tickets?view=mine")).data.length, 1);
  assert.strictEqual((await call("hr", `/tickets/${ids.t1}`)).status, 403); // not theirs
  assert.strictEqual((await call("op", `/tickets/${ids.t1}/solve`, { method: "POST", body: { solution: "done" } })).status, 403);
  const started = await call("fitter", `/tickets/${ids.t1}/start`, { method: "POST" });
  assert.strictEqual(started.data.status, "working", started.data.message);
  assert.match((await call("fitter", `/tickets/${ids.t1}/solve`, { method: "POST", body: { solution: "" } })).data.message, /what was done/);
  const solved = await call("fitter", `/tickets/${ids.t1}/solve`, { method: "POST", body: { solution: "Changed the bearing, cleaned the fan" } });
  assert.strictEqual(solved.data.status, "solved", solved.data.message);
  assert.strictEqual(solved.data.can.confirm, false); // the fitter cannot confirm their own work
  const done = await Task.findOne({ ticket: ids.t1 }).lean();
  assert.deepStrictEqual([done.status, String(done.doneBy)], ["done", ids.fitter]);
});

test("the person who raised it confirms (with a rating) or reopens it; reopening opens the task again", async () => {
  const seen = (await call("op", `/tickets/${ids.t1}`)).data;
  assert.deepStrictEqual([seen.can.confirm, seen.can.reopen], [true, true]);
  assert.match((await call("op", `/tickets/${ids.t1}/reopen`, { method: "POST", body: { reason: "" } })).data.message, /still wrong/);
  const re = await call("op", `/tickets/${ids.t1}/reopen`, { method: "POST", body: { reason: "Still hot after an hour" } });
  assert.deepStrictEqual([re.data.status, re.data.reopenCount], ["working", 1]);
  const Task = require("../models/Task");
  assert.strictEqual((await Task.findOne({ ticket: ids.t1 }).lean()).status, "pending");
  await call("fitter", `/tickets/${ids.t1}/solve`, { method: "POST", body: { solution: "Replaced the motor" } });
  const closed = await call("op", `/tickets/${ids.t1}/confirm`, { method: "POST", body: { rating: 4 } });
  assert.deepStrictEqual([closed.data.status, closed.data.rating], ["closed", 4]);
  assert.deepStrictEqual(closed.data.history.map((h) => h.action), ["raised", "assigned", "working", "solved", "reopened", "solved", "confirmed"]);
});

test("a category with nobody to solve it waits to be assigned; an admin assigns it", async () => {
  const r = await call("op", "/tickets", { method: "POST", body: { category: cat("HR"), title: "Salary slip for September" } });
  assert.strictEqual(r.data.solver, null);
  ids.t2 = r.data._id;
  assert.strictEqual((await call("admin", "/tickets?view=unassigned")).data.length, 1);
  assert.strictEqual((await call("op", `/tickets/${ids.t2}/assign`, { method: "POST", body: { solver: ids.hr } })).status, 403);
  const a = await call("admin", `/tickets/${ids.t2}/assign`, { method: "POST", body: { solver: ids.hr } });
  assert.strictEqual(a.data.solver.name, "HR Person", a.data.message);
  assert.ok(a.data.planned && a.data.task);
  // the solver marks it Done from My Tasks: the ticket is solved with those remarks
  const fin = await call("hr", `/tasks/${a.data.task}/done`, { method: "POST", body: { remarks: "Sent on WhatsApp" } });
  assert.strictEqual(fin.status, 200, fin.data.message);
  const t2 = (await call("op", `/tickets/${ids.t2}`)).data;
  assert.deepStrictEqual([t2.status, t2.solution], ["solved", "Sent on WhatsApp"]);
  assert.match((await call("hr", `/tasks/${a.data.task}/not-required`, { method: "POST", body: { remarks: "nope" } })).data.message, /help ticket/);
});

test("cancel before it is solved: the solver's task is not counted", async () => {
  const r = await call("op", "/tickets", { method: "POST", body: { category: cat("Maintenance"), title: "Door lock broken" } });
  const c = await call("op", `/tickets/${r.data._id}/cancel`, { method: "POST", body: { reason: "Fixed it myself" } });
  assert.strictEqual(c.data.status, "cancelled", c.data.message);
  const Task = require("../models/Task");
  assert.strictEqual((await Task.findOne({ ticket: r.data._id }).lean()).status, "na");
  const note = await call("fitter", `/tickets/${r.data._id}/comment`, { method: "POST", body: { note: "ok" } });
  assert.strictEqual(note.data.history.at(-1).note, "ok");
});

test("solved and not confirmed: closed after the settings' days", async () => {
  const tickets = require("../services/tickets");
  const Ticket = require("../models/Ticket");
  assert.strictEqual(await tickets.autoClose(new Date()), 0); // t2 was solved just now
  assert.strictEqual(await tickets.autoClose(new Date(Date.now() + 4 * 86400000)), 1);
  const t2 = await Ticket.findById(ids.t2).lean();
  assert.deepStrictEqual([t2.status, t2.autoClosed], ["closed", true]);
});

test("MIS: one 'Help Tickets' row; the setting can keep new tickets out of it; the report", async () => {
  const Task = require("../models/Task");
  const scoring = require("../services/scoring");
  const today = require("../services/dates").dayKey(new Date());
  // the solve-by can fall on the next working day (a ticket raised in the evening); the MIS never counts days ahead
  await Task.updateOne({ ticket: ids.t1 }, { $set: { plannedDay: today } });
  const mis = await scoring.misReport({ from: today, to: today, doerId: ids.fitter });
  const fitter = mis.doers?.[0] || mis;
  const rows = (fitter.rows || []).map((r) => r.label);
  assert.ok(rows.includes("Help Tickets"), JSON.stringify(rows));

  await call("admin", "/tickets/settings", { method: "PUT", body: { countInMis: false, autoCloseDays: 3 } });
  const r = await call("op", "/tickets", { method: "POST", body: { category: cat("Maintenance"), title: "Fan noise" } });
  assert.strictEqual((await Task.findOne({ ticket: r.data._id }).lean()).unscored, true);
  await call("admin", "/tickets/settings", { method: "PUT", body: { countInMis: true, autoCloseDays: 3 } });

  const rep = (await call("admin", "/tickets/report")).data;
  assert.strictEqual(rep.total, 4);
  const maint = rep.byCategory.find((c) => c.name === "Maintenance");
  assert.deepStrictEqual([maint.raised, maint.solved, maint.open], [3, 1, 1]);
  assert.strictEqual(rep.bySolver.find((s) => s.name === "Fitter").rating, 4);
  // search by number or words, within what you may see
  assert.strictEqual((await call("op", "/tickets?view=mine&q=HT-0002")).data[0].title, "Salary slip for September");
  assert.strictEqual((await call("fitter", "/tickets?view=assigned&q=salary")).data.length, 0);
});
