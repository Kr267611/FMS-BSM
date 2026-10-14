// Bulk upload from the company employee list: check first, people already in the software are filled (not made
// twice), the designation "PC" gives the PC role, day/month/year joining dates, "M.I.S" = the MIS department
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";

let srv, server, base, User;
const cookies: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_bulk_users_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
  User = require("../models/User");
});
test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});
async function login(username, password) {
  const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  cookies[username] = res.headers.getSetCookie().find((c) => c.startsWith("fms_session="))?.split(";")[0];
  return res.status;
}
async function call(p, body) {
  const res = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Cookie: cookies.admin || "" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: ((await res.json()) as any) };
}

const ROWS = [
  { name: "SHIVAM  SHIVKUMAR SINGH", phone: "8303477671", employeeCode: "8374", joiningDate: "29/10/2025", department: "M.I.S", designation: "ASSISTANT" },
  { name: "URVASHI RAMESHBHAI AGRAWAL", phone: "9726235659", employeeCode: "8772", joiningDate: "4/12/2025", department: "M.D.O", designation: "PC" },
  { name: "NIKUNJ BHAI", phone: "7359921975", employeeCode: "6846", joiningDate: "1/6/2025", department: "MAINTENANCE DYEING", designation: "ENGINEER" },
  { name: "VINOD RAMPRASAD PATEL", phone: "8320193102", employeeCode: "76", joiningDate: "1/1/2022", department: "PRINTING", designation: "INCHARGE" },
  { name: "BAD MOBILE", phone: "12345", employeeCode: "1", joiningDate: "1/1/2022", department: "M.I.S" },
  { name: "BAD DATE", phone: "9999999999", employeeCode: "2", joiningDate: "31/2/2026", department: "M.I.S" },
];

test("check first, then create: existing people are filled, PC from the designation, M.I.S = MIS", async () => {
  await login("admin", "Admin1234");
  const mis = (await call("/org/departments", { name: "MIS" })).data._id;
  // already in the software: Shivam with his mobile (made by hand), "Nikunjbhai" without one, "Vinod" without one
  await call("/users", { name: "SHIVAM", username: "shivam", password: "1234", role: "doer", department: mis, phone: "8303477671" });
  await call("/users", { name: "Nikunjbhai", username: "nikunj", password: "1234", role: "doer" });
  await call("/users", { name: "Vinod", username: "vinod", password: "1234", role: "doer" });

  const dry = (await call("/users/bulk", { rows: ROWS, createMissing: true, dryRun: true })).data;
  const at = (line) => dry.results.find((r) => r.line === line);
  assert.deepStrictEqual([dry.dryRun, dry.created, dry.updated, dry.failed], [true, 2, 2, 2]);
  assert.deepStrictEqual([at(2).action, at(2).existing, at(2).filled], ["updated", "SHIVAM", ["employeeCode", "joiningDate"]]); // same mobile
  assert.deepStrictEqual([at(3).action, at(3).role, at(3).username, at(3).name], ["create", "pc", "9726235659", "Urvashi Rameshbhai Agrawal"]);
  assert.deepStrictEqual([at(4).action, at(4).existing], ["updated", "Nikunjbhai"]); // "NIKUNJ BHAI" = "Nikunjbhai"
  assert.match(at(5).warning, /Vinod/); // a new "Vinod Ramprasad Patel" may be the "Vinod" already here
  assert.match(at(6).error, /10-digit/);
  assert.match(at(7).error, /not a date/);
  assert.ok(!dry.newDepartments.includes("M.I.S") && dry.newDepartments.includes("M.D.O"));
  assert.strictEqual(await User.countDocuments({ phone: "9726235659" }), 0); // nothing saved by the check

  // leave Vinod Ramprasad Patel out (he is the Vinod already here), then save
  const done = (await call("/users/bulk", { rows: ROWS, createMissing: true, skip: [5] })).data;
  assert.deepStrictEqual([done.created, done.updated, done.skipped, done.failed], [1, 2, 1, 2]);
  const shivam = await User.findOne({ username: "shivam" }).lean();
  assert.deepStrictEqual([shivam.employeeCode, shivam.joiningDate, String(shivam.department), shivam.role], ["8374", "2025-10-29", String(mis), "doer"]);
  const nikunj = await User.findOne({ username: "nikunj" }).lean();
  assert.deepStrictEqual([nikunj.phone, nikunj.employeeCode, nikunj.joiningDate, nikunj.name], ["7359921975", "6846", "2025-06-01", "Nikunjbhai"]);
  const urvashi = done.results.find((r) => r.action === "created");
  assert.strictEqual(await login(urvashi.username, urvashi.tempPassword), 200); // signs in with the mobile number
  assert.strictEqual(urvashi.phone, "9726235659");
  assert.strictEqual((await User.findOne({ username: "9726235659" }).populate("department").lean()).department.name, "M.D.O");
  assert.strictEqual(await User.countDocuments({ name: /Vinod/i }), 1);

  // the same file again: nothing new, nobody twice
  const again = (await call("/users/bulk", { rows: ROWS, createMissing: true, dryRun: true, skip: [5] })).data;
  assert.deepStrictEqual([again.created, again.updated, again.same], [0, 0, 3]);
});

test('quick edit: employee code, joining date and team leader through the user form, one person per code', async () => {
  const shivam = await User.findOne({ username: 'shivam' }).lean();
  const nikunj = await User.findOne({ username: 'nikunj' }).lean();
  const put = (id, body) => fetch(base + '/users/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookies.admin }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: (await r.json()) as any }));
  const dup = await put(nikunj._id, { employeeCode: '8374' }); // Shivam has 8374
  assert.deepStrictEqual([dup.status, /already belongs/.test(dup.data.message)], [400, true]);
  const ok = await put(nikunj._id, { employeeCode: '6847', joiningDate: '2025-06-02', teamLeader: String(shivam._id) });
  assert.strictEqual(ok.status, 200, ok.data.message);
  const after = await User.findById(nikunj._id).lean();
  assert.deepStrictEqual([after.employeeCode, after.joiningDate, String(after.teamLeader)], ['6847', '2025-06-02', String(shivam._id)]);
  assert.strictEqual((await put(nikunj._id, { teamLeader: '' })).status, 200);
  assert.strictEqual((await User.findById(nikunj._id).lean()).teamLeader, undefined);
});
