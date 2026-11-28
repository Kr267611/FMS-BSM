// Sheet Links: all the steps of a sheet at once, and no two links counting the same sheet rows
// (Google is not connected in tests: the links are saved and their sync reports the missing service account)
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";

let srv, server, base, cookie, SheetLink;
const ids: Record<string, any> = {};
const URL = "https://docs.google.com/spreadsheets/d/1TestSheetIdForBulkLinks0000/edit#gid=0";

test.before(async () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_sheet_bulk_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
  SheetLink = require("../models/SheetLink");
});
test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});
async function call(p, { method = "GET", body }: any = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: cookie || "" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}
const bulk = (links) => call("/sheets/bulk", { method: "POST", body: { sheetUrl: URL, tabName: "FMS", firstDataRow: 7, links } });
const step5 = { plannedCol: "AV", actualCol: "AW", filterCol: "C" };

test("all steps at once: one link per row, a split step with a filter per doer", async () => {
  const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "Admin1234" }) });
  cookie = res.headers.getSetCookie().find((c) => c.startsWith("fms_session=")).split(";")[0];
  for (const k of ["mukesh", "vinod", "ayush"]) {
    const u = await call("/users", { method: "POST", body: { name: k, username: k, password: "1234", role: "doer" } });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
  }
  const r = await bulk([
    { name: "Old Grey – Stage 1", doer: ids.ayush, plannedCol: "W", actualCol: "X" },
    { name: "Old Grey – Help Ticket – mukesh", doer: ids.mukesh, ...step5, filterValues: ["MANISH MASTER", "BABLU SHERA MASTER"] },
    { name: "Old Grey – Help Ticket – vinod", doer: ids.vinod, ...step5, filterValues: ["KALPESH MASTER", "GUDDU MASTER"] },
  ]);
  assert.strictEqual(r.status, 201, r.data.message);
  assert.deepStrictEqual(r.data.results.map((x) => [x.name, x.ok]), [
    ["Old Grey – Stage 1", false],
    ["Old Grey – Help Ticket – mukesh", false],
    ["Old Grey – Help Ticket – vinod", false],
  ]);
  assert.match(r.data.results[0].error, /service account/i); // saved; the sync says what is missing
  const saved = await SheetLink.find().sort({ name: 1 }).lean();
  assert.deepStrictEqual(saved.map((l) => [l.tabName, l.plannedCol, l.filterCol, l.filterValues.length, String(l.doer)]), [
    ["FMS", "AV", "C", 2, ids.mukesh],
    ["FMS", "AV", "C", 2, ids.vinod],
    ["FMS", "W", "", 0, ids.ayush],
  ]);
});

test("nothing is saved when one row would count rows already counted, or two rows clash", async () => {
  const before = await SheetLink.countDocuments();
  // Stage 1 is already linked
  let r = await bulk([
    { name: "New step", doer: ids.ayush, plannedCol: "AC", actualCol: "AD" },
    { name: "Stage 1 again", doer: ids.vinod, plannedCol: "W", actualCol: "X" },
  ]);
  assert.strictEqual(r.status, 400);
  assert.match(r.data.message, /Row 2 \(Stage 1 again\).*same rows as the link "Old Grey – Stage 1"/);
  // two new rows of one step, one without a filter
  r = await bulk([
    { name: "Stage 8 a", doer: ids.mukesh, plannedCol: "BN", actualCol: "BO", filterCol: "C", filterValues: ["MANISH MASTER"] },
    { name: "Stage 8 b", doer: ids.vinod, plannedCol: "BN", actualCol: "BO" },
  ]);
  assert.strictEqual(r.status, 400);
  assert.match(r.data.message, /count the same rows/);
  // two rows with one name
  r = await bulk([
    { name: "Same", doer: ids.mukesh, plannedCol: "BB", actualCol: "BC" },
    { name: "same", doer: ids.vinod, plannedCol: "BH", actualCol: "BI" },
  ]);
  assert.strictEqual(r.status, 400);
  assert.match(r.data.message, /named/);
  // a row without a doer
  r = await bulk([{ name: "No doer", plannedCol: "BB", actualCol: "BC" }]);
  assert.strictEqual(r.status, 400);
  assert.match(r.data.message, /Row 1 \(No doer\): Choose a doer/);
  assert.strictEqual(await SheetLink.countDocuments(), before);
});

test("one link at a time is checked the same way; editing a link doesn't clash with itself", async () => {
  const one = { sheetUrl: URL, tabName: "FMS", firstDataRow: 7, doer: ids.vinod, ...step5 };
  let r = await call("/sheets", { method: "POST", body: { ...one, name: "Help Ticket – all", filterCol: "", filterValues: "" } });
  assert.strictEqual(r.status, 400);
  assert.match(r.data.message, /same rows as the link/);

  const vinod = await SheetLink.findOne({ doer: ids.vinod, plannedCol: "AV" }).lean();
  // the same link saved again (or with one more master of its own) is fine
  r = await call(`/sheets/${vinod._id}`, { method: "PUT", body: { ...one, name: vinod.name, filterValues: "KALPESH MASTER, GUDDU MASTER, AVINASH MASTER" } });
  assert.strictEqual(r.status, 200, r.data.message);
  // taking one of Mukesh's masters is not
  r = await call(`/sheets/${vinod._id}`, { method: "PUT", body: { ...one, name: vinod.name, filterValues: "KALPESH MASTER, MANISH MASTER" } });
  assert.strictEqual(r.status, 400);
  assert.match(r.data.message, /Old Grey – Help Ticket – mukesh/);
});
