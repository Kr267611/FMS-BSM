// One tick per page: the role defaults keep what every role had, the upgrade keeps each user's old pages,
// "Data kiska dikhe" (reach), and the entry panel says who may mark a step done
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";
import permissionsLib = require("../services/permissions");
import migrations = require("../services/migrations");

const { permissionsFor, REPORT_PAGES, FMS_LISTS } = permissionsLib;
const PAGES = [...REPORT_PAGES, ...FMS_LISTS, "autoComplete", "fmsImport", "fmsBulk"];
const pick = (p) => Object.fromEntries(PAGES.map((k) => [k, [...(p[k] || [])].sort()]));

test("every role's new defaults open exactly the pages it opened before", () => {
  for (const role of ["hod", "pc", "tl", "hr", "auditor", "doer"]) {
    assert.deepStrictEqual(pick(permissionsFor({ role })), pick(migrations.oldPages({ role }, null)), role);
  }
  const doer = permissionsFor({ role: "doer" });
  assert.deepStrictEqual([doer.misScore, doer.weeklyMis, doer.doerTasks, doer.misMeeting], [["view"], ["view"], undefined, undefined]);
  assert.deepStrictEqual(permissionsFor({ role: "hod" }).doerTasks, ["view", "edit"]);
});

test("an old 'PC reports' / 'Master FMS' tick becomes the page ticks (staff-only pages stay closed for a doer)", () => {
  const out = migrations.splitLayer({ reports: ["view", "edit", "delete"], fms: ["view", "add"], users: ["view"] }, "doer");
  assert.strictEqual(out.reports, undefined);
  assert.deepStrictEqual([out.misScore, out.doerTasks, out.misMeeting, out.users], [["view"], [], [], ["view"]]);
  assert.deepStrictEqual([out.doerConditions, out.autoComplete, out.fms], [["view"], ["view", "add"], ["view", "add"]]);
  assert.deepStrictEqual(migrations.splitLayer({ reports: ["view", "edit", "delete"] }, "pc").doerTasks, ["view", "edit", "delete"]);
});

let srv, server, base, User, Department, Setting;
const cookies: Record<string, any> = {};
const ids: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_page_access_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
  User = require("../models/User");
  Department = require("../models/Org").Department;
  Setting = require("../models/Setting");
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
const me = async (who) => (await call(who, "/auth/me")).data;

test("the upgrade: everyone keeps their old pages; the old access is kept; it runs once", async () => {
  await login("admin", "Admin1234");
  ids.prod = (await call("admin", "/org/departments", { method: "POST", body: { name: "Production" } })).data._id;
  ids.store = (await call("admin", "/org/departments", { method: "POST", body: { name: "Store" } })).data._id;
  for (const [k, role, dept] of [["dd", "doer", ids.prod], ["hh", "hod", ids.prod], ["ss", "doer", ids.store]]) {
    const u = await call("admin", "/users", { method: "POST", body: { name: k, username: k, password: "1234", role, department: dept } });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
  }
  // access as it was saved before the change: the department and the HOD have the old "reports" / "fms" ticks
  await Department.collection.updateOne({ _id: new (require("mongoose").Types.ObjectId)(ids.prod) }, { $set: { permissions: { reports: ["view"] } } });
  await User.collection.updateOne({ _id: new (require("mongoose").Types.ObjectId)(ids.hh) }, { $set: { permissions: { reports: [], fms: ["view", "add"], settings: ["view", "edit"] } } });
  await Setting.deleteOne({ key: "migration.pageAccess" });
  await migrations.migratePageAccess();

  for (const k of ["dd", "hh", "ss"]) await login(k);
  const dd = (await me("dd")).permissions; // a doer in Production: the score pages, not the staff-only ones
  assert.deepStrictEqual([dd.misScore, dd.weeklyMis, dd.doerTasks, dd.misMeeting, dd.fmsBulk || []], [["view"], ["view"], [], [], []]);
  const hh = (await me("hh")).permissions; // the HOD: no reports at all, Master FMS view + add, Import (fms add + settings edit)
  assert.deepStrictEqual([hh.misScore, hh.doerTasks, hh.doerConditions, hh.autoComplete, hh.fmsImport], [[], [], ["view"], ["view", "add"], ["add"]]);
  assert.deepStrictEqual((await me("ss")).permissions.misScore, ["view"]); // untouched department: the role's own
  assert.strictEqual((await call("hh", "/mis?from=2026-10-01&to=2026-10-07")).status, 403);
  assert.strictEqual((await call("hh", "/fms-rules/auto-complete")).status, 200);

  const saved = await User.collection.findOne({ _id: new (require("mongoose").Types.ObjectId)(ids.hh) });
  assert.deepStrictEqual(saved.permissionsV1, { reports: [], fms: ["view", "add"], settings: ["view", "edit"] });
  assert.strictEqual((await Department.collection.findOne({ _id: new (require("mongoose").Types.ObjectId)(ids.prod) })).permissions.reports, undefined);
  // a second start changes nothing
  await User.updateOne({ _id: ids.hh }, { $set: { "permissions.misScore": ["view"] } });
  await migrations.migratePageAccess();
  assert.deepStrictEqual((await User.findById(ids.hh).lean()).permissions.misScore, ["view"]);
});

test("each page has its own tick: one report page open, the others closed – in the data too", async () => {
  await call("admin", `/users/${ids.ss}`, { method: "PUT", body: { permissions: { misScore: [], weeklyMis: ["view"], doerTasks: ["view"] } } });
  await login("ss");
  assert.strictEqual((await call("ss", "/mis?from=2026-10-01&to=2026-10-07")).status, 403);
  assert.strictEqual((await call("ss", `/mis?from=2026-10-01&to=2026-10-07&doer=${ids.ss}`)).status, 200); // their own week score (My Tasks)
  assert.strictEqual((await call("ss", "/mis/weekly")).status, 200);
  assert.strictEqual((await call("ss", "/reports/tasks")).status, 200);
  assert.strictEqual((await call("ss", "/reports/fms-tasks")).status, 403);
  assert.strictEqual((await call("ss", "/reports/tasks/delete", { method: "POST", body: { ids: [] } })).status, 403);
  const meta = (await call("admin", "/users/meta")).data;
  assert.ok(meta.groups.some(([g, mods]) => g === "PC Reports" && mods.includes("misMeeting")) && !meta.modules.reports);
});

test("Data kiska dikhe: self / team / department / whole company, set by an admin only", async () => {
  const scope = require("../services/scope");
  const reach = async (k) => scope.visibleUserIds(await User.findById(ids[k]).lean());
  assert.deepStrictEqual(await reach("dd"), [ids.dd]); // a doer: themselves
  await call("admin", `/users/${ids.dd}`, { method: "PUT", body: { reach: "department" } });
  assert.ok((await reach("dd")).includes(ids.hh) && !(await reach("dd")).includes(ids.ss));
  await call("admin", `/users/${ids.dd}`, { method: "PUT", body: { reach: "all" } });
  assert.strictEqual(await reach("dd"), null);
  assert.strictEqual((await User.findById(ids.dd).lean()).seesAll, true);
  await call("admin", `/users/${ids.hh}`, { method: "PUT", body: { reach: "self" } }); // a HOD narrowed to themselves
  assert.deepStrictEqual(await reach("hh"), [ids.hh]);
  await login("dd");
  assert.strictEqual((await me("dd")).reach, "all");
  const access = (await call("admin", "/users/access")).data;
  assert.deepStrictEqual(["dd", "hh", "ss"].map((k) => access.find((u) => u._id === ids[k]).reach), ["all", "self", "self"]);
  // a HOD with Users (edit) cannot change anyone's reach
  await call("admin", `/users/${ids.hh}`, { method: "PUT", body: { reach: "", permissions: { users: ["view", "edit"] } } });
  await login("hh");
  await call("hh", `/users/${ids.dd}`, { method: "PUT", body: { reach: "self" } });
  assert.strictEqual((await User.findById(ids.dd).lean()).seesAll, true);
});

test("the entry panel says who may mark a step done, and why not", async () => {
  const body = {
    name: "Store FMS",
    active: true,
    fields: [{ key: "item", label: "Item", type: "text" }],
    steps: [{ key: "s1", name: "Check", doer: { mode: "fixed", user: ids.ss }, start: { mode: "entry" }, tat: 1, tatUnit: "days", fields: [] }],
  };
  const p = await call("admin", "/processes", { method: "POST", body });
  assert.strictEqual(p.status, 201, p.data.message);
  const j = await call("admin", "/jobs", { method: "POST", body: { process: p.data._id, data: { item: "Belt" } } });
  assert.strictEqual(j.status, 201, j.data.message);
  const step = async (who) => (await call(who, `/jobs/${j.data._id}`)).data.tasks[0];
  assert.strictEqual((await step("admin")).canAct, true);
  await login("ss");
  assert.strictEqual((await step("ss")).canAct, true); // their own step
  const dd = await step("dd"); // a doer (whole company) without FMS Entries (edit)
  assert.deepStrictEqual([dd.canAct, /FMS Entries \(edit\)/.test(dd.notAllowed)], [false, true]);
  // given FMS Entries (edit) but only their own people: the Store doer is not among them
  await call("admin", `/users/${ids.dd}`, { method: "PUT", body: { reach: "self", permissions: { fmsEntries: ["view", "add", "edit"] } } });
  await login("dd");
  const narrow = await step("dd");
  assert.deepStrictEqual([narrow.canAct, /Data kiska dikhe/.test(narrow.notAllowed)], [false, true]);
  assert.strictEqual((await call("dd", `/tasks/${narrow._id}/done`, { method: "POST", body: {} })).status, 403); // the server agrees
  await call("admin", `/users/${ids.dd}`, { method: "PUT", body: { reach: "all" } });
  await login("dd");
  assert.strictEqual((await step("dd")).canAct, true);
});

test("part 2: Audit List, Auditor Settings and Ticket Report – defaults as before, each its own tick, old access kept", async () => {
  const P2 = ["auditList", "auditorSettings", "ticketReport"];
  const pick2 = (p) => Object.fromEntries(P2.map((k) => [k, [...(p[k] || [])].sort()]));
  for (const role of ["hod", "pc", "tl", "hr", "auditor", "doer"]) {
    assert.deepStrictEqual(pick2(permissionsFor({ role })), pick2(migrations.oldPages2({ role }, null)), role);
  }
  // before: Settings (edit) also opened Auditor Settings; Help Ticket – Manage (view) also the Ticket Report
  await User.collection.updateOne({ _id: new (require("mongoose").Types.ObjectId)(ids.ss) }, { $set: { "permissions.settings": ["view", "edit"], "permissions.tickets": ["view"] } });
  await Setting.deleteOne({ key: "migration.pageAccess2" });
  await migrations.migratePageAccess2();
  await login("ss");
  const ss = (await me("ss")).permissions;
  assert.deepStrictEqual([ss.auditorSettings, ss.ticketReport, ss.auditList || []], [["edit"], ["view"], []]);
  assert.strictEqual((await call("ss", "/audits/settings")).status, 200);
  assert.strictEqual((await call("ss", "/tickets/report")).status, 200);
  assert.strictEqual((await call("ss", "/audits")).status, 403); // no Audit List tick, not an auditor
  // Make Auditor opens the Audit List without the tick; the tick alone opens it too
  await call("admin", `/users/${ids.ss}`, { method: "PUT", body: { isAuditor: true } });
  assert.strictEqual((await call("ss", "/audits")).status, 200);
  await call("admin", `/users/${ids.ss}`, { method: "PUT", body: { isAuditor: false, permissions: { ...ss, auditList: ["view"], settings: [], ticketReport: [] } } });
  await login("ss");
  assert.strictEqual((await call("ss", "/audits")).status, 200);
  assert.strictEqual((await call("ss", "/tickets/report")).status, 403);
  assert.strictEqual((await call("ss", "/audits/settings")).status, 200); // its own tick, not Settings any more
});
