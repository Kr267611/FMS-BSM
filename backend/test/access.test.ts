// Access: the HR role, per-user access, department access, self-service switches, "Sees everyone",
// and that only an admin hands out company-wide reach
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";
import permissionsLib = require("../services/permissions");

test("effective access: role defaults, then the department, then the user's own", () => {
  const { permissionsFor } = permissionsLib;
  const doer = permissionsFor({ role: "doer" });
  assert.deepStrictEqual([doer.myAttendance, doer.leave, doer.fms], [["view"], undefined, undefined]);
  const dept = permissionsFor({ role: "doer", deptPermissions: { leave: ["view"], myTickets: [] } });
  assert.deepStrictEqual([dept.leave, dept.myTickets], [["view"], []]);
  const own = permissionsFor({ role: "doer", deptPermissions: { leave: ["view"] }, permissions: { leave: [], attendance: ["view", "edit", "fly"] } });
  assert.deepStrictEqual([own.leave, own.attendance], [[], ["view", "edit"]]); // unknown actions dropped
  assert.deepStrictEqual([permissionsFor({ role: "hr" }).leaveTypes, permissionsFor({ role: "hr" }).biometric], [["view", "edit", "delete"], ["add"]]);
  assert.deepStrictEqual(permissionsFor({ role: "admin", permissions: { users: [] } }).users, ["view", "add", "edit", "delete"]); // admins keep everything
  assert.deepStrictEqual(permissionsFor({ role: "doer", permissions: { audit: ["view", "edit"] } }).audit, ["view"]); // the audit log has only "view"
});

test("Developer: everything an admin has, and cannot be locked out either", () => {
  const { permissionsFor, isAdmin, ROLES } = permissionsLib;
  assert.strictEqual(ROLES.developer, "Developer");
  assert.deepStrictEqual(permissionsFor({ role: "developer", permissions: { users: [], fms: [] } }), permissionsFor({ role: "admin" }));
  assert.deepStrictEqual([isAdmin({ role: "admin" }), isAdmin({ role: "developer" }), isAdmin({ role: "hod" }), isAdmin(null)], [true, true, false, false]);
});

let srv, server, base;
const cookies: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_access_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
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
  return { status: res.status, data: ((await res.json()) as any) };
}
const ids: Record<string, any> = {};

test("setup: two departments, a HOD, HR, doers", async () => {
  await login("admin", "Admin1234");
  ids.prod = (await call("admin", "/org/departments", { method: "POST", body: { name: "Production" } })).data._id;
  ids.acc = (await call("admin", "/org/departments", { method: "POST", body: { name: "Accounts" } })).data._id;
  const add = async (k, role, department, extra = {}) => {
    const u = await call("admin", "/users", { method: "POST", body: { name: k, username: k, password: "1234", role, department, ...extra } });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
    await login(k);
  };
  await add("hod", "hod", ids.prod);
  await add("hrperson", "hr", ids.acc);
  await add("ravi", "doer", ids.prod);
  await add("asha", "doer", ids.acc);
});

test("only an admin gives the HR role or 'Sees everyone'; a HOD cannot edit an HR user", async () => {
  const meta = (await call("admin", "/users/meta")).data;
  assert.ok(meta.roles.hr && meta.moduleActions.attendance.edit && meta.groups.some(([g]) => g === "Self service"));
  // a HOD with users add (given by the admin) still cannot create HR
  await call("admin", `/users/${ids.hod}`, { method: "PUT", body: { permissions: { users: ["view", "add", "edit"] } } });
  await login("hod");
  assert.match((await call("hod", "/users", { method: "POST", body: { name: "x", username: "x1", password: "1234", role: "hr" } })).data.message, /Only an admin/);
  assert.strictEqual((await call("hod", `/users/${ids.hrperson}`, { method: "PUT", body: { name: "HR 2" } })).status, 403);
  const h = await call("hod", "/users", { method: "POST", body: { name: "y", username: "y1", password: "1234", role: "doer", seesAll: true } });
  assert.strictEqual(h.data.seesAll, false); // ignored when not an admin
});

test("HR: all of HRMS for the whole company, nothing of FMS", async () => {
  const me = (await call("hrperson", "/auth/me")).data;
  assert.deepStrictEqual([me.permissions.leavePolicies, me.permissions.attendanceSetup, me.permissions.fms], [["view", "edit", "delete"], ["view", "edit", "delete"], undefined]);
  // HR (Accounts) sees a Production doer's leave and attendance
  assert.strictEqual((await call("hrperson", `/attendance/register?user=${ids.ravi}`)).status, 200);
  const lt = await call("hrperson", "/hr/types", { method: "POST", body: { name: "Casual Leave" } });
  assert.strictEqual(lt.status, 201, lt.data.message);
  const r = await call("ravi", "/hr/requests", { method: "POST", body: { type: lt.data._id, from: "2026-11-02", to: "2026-11-02", reason: "Family function" } });
  assert.strictEqual(r.status, 201, r.data.message);
  assert.strictEqual((await call("hrperson", "/hr/requests?view=approve")).data.length, 1);
  assert.strictEqual((await call("hrperson", `/hr/requests/${r.data._id}/approve`, { method: "POST", body: {} })).status, 200);
  assert.strictEqual((await call("hrperson", "/processes")).status, 403);
});

test("per-user access: a doer given only the register can look but not mark", async () => {
  assert.strictEqual((await call("asha", "/attendance/register")).status, 403);
  await call("admin", `/users/${ids.asha}`, { method: "PUT", body: { permissions: { attendance: ["view"] } } });
  assert.strictEqual((await call("asha", "/attendance/register")).status, 200);
  assert.strictEqual((await call("asha", "/attendance/manual", { method: "PUT", body: { user: ids.asha, day: "2026-10-01", status: "P", note: "own" } })).status, 403);
});

test("department access reaches everyone in it; a user's own access wins over it", async () => {
  const d = await call("admin", `/org/departments/${ids.prod}/permissions`, { method: "PUT", body: { permissions: { leave: ["view"], myTickets: [] } } });
  assert.strictEqual(d.status, 200, d.data.message);
  assert.strictEqual((await call("hod", `/org/departments/${ids.prod}/permissions`, { method: "PUT", body: { permissions: {} } })).status, 403);
  const ravi = (await call("ravi", "/auth/me")).data.permissions;
  assert.deepStrictEqual([ravi.leave, ravi.myTickets], [["view"], []]);
  assert.strictEqual((await call("ravi", "/hr/requests?view=all")).status, 200);
  // self service switched off for the department: no raising tickets
  const cats = (await call("ravi", "/tickets/categories")).data;
  assert.strictEqual((await call("ravi", "/tickets", { method: "POST", body: { category: cats[0]._id, title: "Printer jam" } })).status, 403);
  // Ravi's own access brings it back
  await call("admin", `/users/${ids.ravi}`, { method: "PUT", body: { permissions: { myTickets: ["view"] } } });
  assert.strictEqual((await call("ravi", "/tickets", { method: "POST", body: { category: cats[0]._id, title: "Printer jam" } })).status, 201);
  await call("admin", `/org/departments/${ids.prod}/permissions`, { method: "PUT", body: { permissions: null } });
});

test("self service can be taken away: no punch, no leave, no attendance page", async () => {
  await call("admin", `/users/${ids.asha}`, { method: "PUT", body: { permissions: { myAttendance: [], myLeave: [] } } });
  assert.strictEqual((await call("asha", "/attendance/me")).status, 403);
  assert.strictEqual((await call("asha", "/attendance/punch", { method: "POST", body: {} })).status, 403);
  assert.strictEqual((await call("asha", "/hr/my")).status, 403);
  assert.strictEqual((await call("asha", "/hr/preview", { method: "POST", body: {} })).status, 403);
});

test("'Sees everyone': a HOD reaches the other department too", async () => {
  assert.strictEqual((await call("hod", `/attendance/register?user=${ids.asha}`)).status, 403);
  await call("admin", `/users/${ids.hod}`, { method: "PUT", body: { seesAll: true } });
  assert.strictEqual((await call("hod", `/attendance/register?user=${ids.asha}`)).status, 200);
});

test("taking away the report pages closes their data too (not only the menu)", async () => {
  assert.strictEqual((await call("asha", "/mis?from=2026-10-01&to=2026-10-07")).status, 200);
  await call("admin", `/users/${ids.asha}`, { method: "PUT", body: { permissions: { myAttendance: [], myLeave: [], misScore: [], weeklyMis: [], performance: [], doerTasks: [] } } });
  for (const p of ["/mis?from=2026-10-01&to=2026-10-07", "/mis/weekly", "/mis/performance", "/reports/tasks"]) {
    assert.strictEqual((await call("asha", p)).status, 403, p);
  }
});

test("Developer: only an admin makes one; then it works like an admin (whole company, access, admin-only pages)", async () => {
  // the HOD (with users add / edit) cannot make a developer, nor edit one
  assert.match((await call("hod", "/users", { method: "POST", body: { name: "d", username: "d1", password: "1234", role: "developer" } })).data.message, /Only an admin/);
  const dev = await call("admin", "/users", { method: "POST", body: { name: "dev", username: "dev", password: "1234", role: "developer", department: ids.prod } });
  assert.strictEqual(dev.status, 201, dev.data.message);
  ids.dev = dev.data._id;
  await login("dev");
  assert.strictEqual((await call("hod", `/users/${ids.dev}`, { method: "PUT", body: { name: "dev 2" } })).status, 403);
  const me = (await call("dev", "/auth/me")).data;
  assert.deepStrictEqual([me.role, me.permissions.users, me.permissions.fms], ["developer", ["view", "add", "edit", "delete"], ["view", "add", "edit", "delete"]]);
  // the whole company: a doer of another department (Accounts)
  assert.strictEqual((await call("dev", `/attendance/register?user=${ids.asha}`)).status, 200);
  // admin-only: everyone's access, and changing someone's access
  assert.strictEqual((await call("dev", "/users/access")).status, 200);
  await call("dev", `/users/${ids.ravi}`, { method: "PUT", body: { permissions: { fms: ["view"] } } });
  await login("ravi");
  assert.deepStrictEqual((await call("ravi", "/auth/me")).data.permissions.fms, ["view"]);
  // a developer may make another developer
  assert.strictEqual((await call("dev", "/users", { method: "POST", body: { name: "dev2", username: "dev2", password: "1234", role: "developer" } })).status, 201);
});
