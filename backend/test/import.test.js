// CSV import of FMS entries: column matching, sheet-style dates and numbers, duplicates, planned dates
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "node_modules", ".cache", "mongodb-memory-server");
const { MongoMemoryServer } = require("mongodb-memory-server-core");

let srv, server, base, admin, pid;

test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_import_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
});
test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});

async function call(p, { method = "GET", body } = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: admin || "" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

const ROWS = [
  { date: "4/12/2024", "inward date": "14/08/2020", "master name": "4", "party name": "JAWAHARLAL PRAVIN KUMAR", "lot number": "2829-OOO", "total taka": "1,025", extra: "x" },
  { date: "4/12/2024", "inward date": "08/04/2021", "master name": "11", "party name": "DEVESH FAB TEX", "lot number": "1006-OO", "total taka": "1" },
  { date: "4/12/2024", "inward date": "08/04/2021", "master name": "11", "party name": "DEVESH FAB TEX", "lot number": "1006-OO", "total taka": "1" },
  { date: "4/12/2024", "inward date": "not a date", "master name": "4", "party name": "X", "lot number": "9-O", "total taka": "3" },
];

test("setup: an FMS like Running Party Old Stock", async () => {
  const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "Admin1234" }) });
  admin = res.headers.getSetCookie().find((c) => c.startsWith("fms_session=")).split(";")[0];
  const me = (await call("/auth/me")).data;
  const p = await call("/processes", {
    method: "POST",
    body: {
      name: "Old Stock",
      calendar: { mode: "working" },
      fields: [
        { key: "inward_date", label: "Inward Date", type: "date", required: true },
        { key: "master_name", label: "Master Name", type: "text", required: true },
        { key: "party_name", label: "Party Name", type: "text" },
        { key: "lot_number", label: "Lot number", type: "text", required: true },
        { key: "total_taka", label: "Total Taka", type: "number" },
      ],
      steps: [{ key: "s1", name: "Share list with Master", doer: { mode: "fixed", user: me._id }, start: { mode: "entry" }, tat: 7, tatUnit: "days" }],
    },
  });
  assert.strictEqual(p.status, 201, p.data.message);
  pid = p.data._id;
});

test("check: columns matched by name, bad rows and duplicates reported, nothing saved", async () => {
  const r = await call("/jobs/import", { method: "POST", body: { process: pid, rows: ROWS, uniqueField: "lot_number" } });
  assert.strictEqual(r.status, 200, r.data.message);
  assert.deepStrictEqual(r.data.columns.matched.map((m) => m.key), ["inward_date", "master_name", "party_name", "lot_number", "total_taka"]);
  assert.strictEqual(r.data.columns.dateColumn, "date");
  assert.deepStrictEqual(r.data.columns.extra, ["extra"]);
  assert.deepStrictEqual(r.data.results.map((x) => x.ok), [true, true, false, false]);
  assert.strictEqual(r.data.results[2].duplicate, true);
  assert.match(r.data.results[3].error, /not a date/);
  assert.strictEqual((await call(`/jobs?process=${pid}&status=`)).data.total, 0);
});

test("import: entries made with the sheet's entry date; planned = entry + 7 working days; re-upload skips them", async () => {
  const r = await call("/jobs/import", { method: "POST", body: { process: pid, rows: ROWS.slice(0, 2), dryRun: false, uniqueField: "lot_number" } });
  assert.deepStrictEqual(r.data.results.map((x) => x.jobNo), ["1", "2"]);
  const list = (await call(`/jobs?process=${pid}&status=`)).data;
  const job = list.jobs.find((j) => j.jobNo === "1");
  assert.strictEqual(job.data.inward_date, "2020-08-14");
  assert.strictEqual(job.data.total_taka, 1025);
  assert.strictEqual(new Date(job.startDate).toISOString(), "2024-12-03T18:30:00.000Z"); // 4/12/2024 00:00 IST
  assert.strictEqual(job.tasks[0].plannedDay, "2024-12-12"); // as in the sheet
  const again = await call("/jobs/import", { method: "POST", body: { process: pid, rows: ROWS.slice(0, 2), dryRun: false, uniqueField: "lot_number" } });
  assert.deepStrictEqual(again.data.results.map((x) => x.duplicate), [true, true]);
});
