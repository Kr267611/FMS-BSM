// FMS Entries column filters (like a sheet's filter view): values, blanks, contains, number and date ranges,
// step state and doer, sorting, the values list, the export following the filters, unknown keys ignored
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
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_entry_filters_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
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
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* CSV */
  }
  return { status: res.status, data };
}
const list = async (f, extra = "") => (await call("admin", `/jobs?process=${ids.p}&status=&f=${encodeURIComponent(JSON.stringify(f))}${extra}`)).data;
const nos = (d) => d.jobs.map((j) => Number(j.jobNo)).sort((a, b) => a - b);

test("setup: an FMS with a dropdown, a number, a date, a person; four entries", async () => {
  await login("admin", "Admin1234");
  for (const k of ["vinod", "rajesh"]) {
    const u = await call("admin", "/users", { method: "POST", body: { name: k, username: k, password: "1234", role: "doer" } });
    ids[k] = u.data._id;
  }
  const p = await call("admin", "/processes", {
    method: "POST",
    body: {
      name: "Costing",
      active: true,
      calendar: { mode: "calendar" },
      fields: [
        { key: "master", label: "Master", type: "select", options: ["GUDDU MASTER", "MANISH MASTER"] },
        { key: "meter", label: "Meter", type: "number" },
        { key: "bill_date", label: "Bill date", type: "date" },
        { key: "party", label: "Party", type: "text" },
        { key: "checker", label: "Checker", type: "user" },
      ],
      steps: [
        { key: "s1", name: "Check", doer: { mode: "field", field: "checker", fallback: ids.vinod }, start: { mode: "entry" }, tat: 1, tatUnit: "days", fields: [] },
        { key: "s2", name: "Confirm", doer: { mode: "fixed", user: ids.rajesh }, start: { mode: "afterDone", step: "s1" }, tat: 1, tatUnit: "days", fields: [] },
      ],
    },
  });
  assert.strictEqual(p.status, 201, p.data.message);
  ids.p = p.data._id;
  const old = new Date(Date.now() - 10 * 86400000).toISOString(); // planned 9 days ago: overdue
  const rows = [
    { data: { master: "GUDDU MASTER", meter: 1200, bill_date: "2026-08-03", party: "JHC", checker: ids.vinod }, startDate: old },
    { data: { master: "MANISH MASTER", meter: 2600, bill_date: "2026-08-10", party: "GDSM", checker: ids.rajesh } },
    { data: { master: "GUDDU MASTER", meter: 3100, bill_date: "2026-09-01", party: "JHC", checker: ids.vinod } },
    { data: { meter: 500, party: "GAT", checker: ids.vinod } }, // no master
  ];
  for (const r of rows) assert.strictEqual((await call("admin", "/jobs", { method: "POST", body: { process: ids.p, ...r } })).status, 201);
  // entry 3: step 1 done today (on time) -> step 2 starts
  const e3 = (await list({})).jobs.find((j) => j.jobNo === "3");
  const t = e3.tasks.find((x) => x.stepKey === "s1");
  assert.strictEqual((await call("admin", `/tasks/${t._id}/done`, { method: "POST", body: {} })).status, 200);
});

test("entry columns: values (and blanks), contains, number range, date range – together", async () => {
  assert.deepStrictEqual(nos(await list({ fields: { master: { in: ["GUDDU MASTER"] } } })), [1, 3]);
  assert.deepStrictEqual(nos(await list({ fields: { master: { in: ["(blank)", "MANISH MASTER"] } } })), [2, 4]);
  assert.deepStrictEqual(nos(await list({ fields: { party: { text: "jh" } } })), [1, 3]);
  assert.deepStrictEqual(nos(await list({ fields: { meter: { min: 1000, max: 3000 } } })), [1, 2]);
  assert.deepStrictEqual(nos(await list({ fields: { bill_date: { from: "2026-08-05", to: "2026-08-31" } } })), [2]);
  assert.deepStrictEqual(nos(await list({ fields: { master: { in: ["GUDDU MASTER"] }, meter: { min: 2000 } } })), [3]);
  assert.deepStrictEqual(nos(await list({ fields: { checker: { in: [ids.rajesh] } } })), [2]);
  // a key that is not a field of this FMS is ignored, not used as a database path
  assert.strictEqual((await list({ fields: { $where: { in: ["x"] }, "data.x": { text: "a" } } })).total, 4);
});

test("step columns: state and doer; several steps must all match", async () => {
  assert.deepStrictEqual(nos(await list({ steps: { s1: { states: ["overdue"] } } })), [1]);
  assert.deepStrictEqual(nos(await list({ steps: { s1: { states: ["doneOnTime"] } } })), [3]);
  assert.deepStrictEqual(nos(await list({ steps: { s1: { states: ["pending"] } } })), [1, 2, 4]);
  assert.deepStrictEqual(nos(await list({ steps: { s2: { states: ["notStarted"] } } })), [1, 2, 4]);
  assert.deepStrictEqual(nos(await list({ steps: { s2: { states: ["pending", "dueToday"] } } })), [3]);
  assert.deepStrictEqual(nos(await list({ steps: { s1: { doers: [ids.rajesh] } } })), [2]);
  assert.deepStrictEqual(nos(await list({ steps: { s1: { states: ["pending"], doers: [ids.vinod] }, s2: { states: ["notStarted"] } } })), [1, 4]);
  assert.strictEqual((await list({ steps: { s1: { states: ["doneLate"] } } })).total, 0);
});

test("with no sort the entries run #1, #2, #3… like a sheet's rows; the entry date sort still works", async () => {
  // entry 1 has the oldest entry date, so newest-first would put it last
  assert.deepStrictEqual((await list({})).jobs.map((j) => j.jobNo), ["1", "2", "3", "4"]);
  assert.deepStrictEqual((await list({}, "&sort=jobNo:desc")).jobs.map((j) => j.jobNo), ["4", "3", "2", "1"]);
  assert.strictEqual((await list({}, "&sort=startDate:asc")).jobs[0].jobNo, "1");
  assert.notStrictEqual((await list({}, "&sort=startDate:desc")).jobs[0].jobNo, "1");
  // more than 9 entries: #10 comes after #9, not after #1
  for (let i = 0; i < 8; i++) assert.strictEqual((await call("admin", "/jobs", { method: "POST", body: { process: ids.p, data: { meter: 1, party: `X${i}` } } })).status, 201);
  const page = (await call("admin", `/jobs?process=${ids.p}&status=&limit=200`)).data;
  assert.deepStrictEqual(page.jobs.map((j) => Number(j.jobNo)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const csv = (await call("admin", `/jobs/export?process=${ids.p}&status=`)).data;
  assert.deepStrictEqual(csv.trim().split(/\r?\n/).slice(1, 4).map((l) => l.split(",")[0].replace(/"/g, "")), ["1", "2", "3"]);
  // back to the four entries the other tests count on
  for (const j of page.jobs.filter((x) => Number(x.jobNo) > 4)) assert.strictEqual((await call("admin", `/jobs/${j._id}`, { method: "DELETE" })).status, 200);
});

test("sorting by a column, the values list, and the export following the filters", async () => {
  const asc = await list({}, "&sort=meter:asc");
  assert.deepStrictEqual(asc.jobs.map((j) => j.data.meter), [500, 1200, 2600, 3100]);
  assert.deepStrictEqual((await list({}, "&sort=meter:desc")).jobs[0].data.meter, 3100);
  const masters = (await call("admin", `/jobs/values?process=${ids.p}&field=master`)).data;
  assert.deepStrictEqual(masters.map((v) => [v.label, v.count]), [["GUDDU MASTER", 2], ["MANISH MASTER", 1], ["(blank)", 1]]);
  const checkers = (await call("admin", `/jobs/values?process=${ids.p}&field=checker`)).data;
  assert.deepStrictEqual(checkers.map((v) => v.label).sort(), ["rajesh", "vinod"]);
  const doers = (await call("admin", `/jobs/values?process=${ids.p}&step=s1`)).data;
  assert.deepStrictEqual(doers.map((v) => [v.label, v.count]), [["rajesh", 1], ["vinod", 3]]);
  assert.strictEqual((await call("admin", `/jobs/values?process=${ids.p}&field=nothing`)).status, 400);
  const csv = (await call("admin", `/jobs/export?process=${ids.p}&status=&f=${encodeURIComponent(JSON.stringify({ fields: { master: { in: ["GUDDU MASTER"] } } }))}`)).data;
  assert.strictEqual(csv.trim().split(/\r?\n/).length, 3); // header + 2 entries
  // the open / closed tab and the search still work with the filters
  assert.strictEqual((await call("admin", `/jobs?process=${ids.p}&status=open&q=gdsm&f=${encodeURIComponent(JSON.stringify({ fields: { meter: { min: 1 } } }))}`)).data.total, 1);
});

test("step dates and delay, and the PC's Final Status", async () => {
  const all = (await list({})).jobs;
  const e1 = all.find((j) => j.jobNo === "1").tasks.find((t) => t.stepKey === "s1");
  // entry 1 was planned 9 days ago and is still open: 9 days late
  assert.deepStrictEqual(nos(await list({ steps: { s1: { delayMin: 5 } } })), [1]);
  assert.deepStrictEqual(nos(await list({ steps: { s1: { delayMax: 0 } } })), [2, 3, 4]);
  assert.deepStrictEqual(nos(await list({ steps: { s1: { plannedFrom: e1.plannedDay, plannedTo: e1.plannedDay } } })), [1]);
  const e3 = all.find((j) => j.jobNo === "3").tasks.find((t) => t.stepKey === "s1");
  assert.deepStrictEqual(nos(await list({ steps: { s1: { actualFrom: e3.actualDay, actualTo: e3.actualDay } } })), [3]);
  // the PC closes entry 4; Final Status filters by it, "(blank)" = not closed
  const e4 = all.find((j) => j.jobNo === "4");
  assert.strictEqual((await call("admin", `/jobs/${e4._id}/close`, { method: "POST", body: { status: "Closed" } })).status, 200);
  assert.deepStrictEqual(nos(await list({ close: { in: ["Closed"] } })), [4]);
  assert.deepStrictEqual(nos(await list({ close: { in: ["(blank)"] } })), [1, 2, 3]);
  const finals = (await call("admin", `/jobs/values?process=${ids.p}&field=_close`)).data;
  assert.deepStrictEqual(finals.map((v) => [v.label, v.count]), [["Closed", 1], ["(blank)", 3]]);
});
