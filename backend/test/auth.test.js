// End-to-end auth, roles and org flows against a throwaway in-memory MongoDB and a fake mailer.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "node_modules", ".cache", "mongodb-memory-server");
const { MongoMemoryServer } = require("mongodb-memory-server-core");

const sent = [];
const mailerModule = require("../services/mailer");
mailerModule.mailer = () => ({ sendMail: async (m) => sent.push(m) }); // capture instead of sending

let srv, server, base;

test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGO_URI: srv.getUri(),
    DB_NAME: "auth_test",
    JWT_SECRET: "test-secret",
    ADMIN_PASSWORD: "Admin1234",
    ADMIN_EMAIL: "MIS@Example.com",
    APP_URL: "https://fms.example.com/",
  });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
});

test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});

// A "session" is the value of the httpOnly cookie
async function call(p, { session, method = "GET", body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json", ...(session ? { Cookie: session } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  return { status: res.status, data: await res.json(), setCookie };
}
async function login(username, password, remember) {
  const r = await call("/auth/login", { method: "POST", body: { username, password, remember } });
  const cookie = r.setCookie.find((c) => c.startsWith("fms_session="));
  return { ...r, cookie, session: cookie ? cookie.split(";")[0] : null };
}

test("sign in sets an httpOnly session cookie; token is not in the response body", async () => {
  const r = await login("mis@example.com", "Admin1234");
  assert.strictEqual(r.status, 200);
  assert.match(r.cookie, /HttpOnly/);
  assert.match(r.cookie, /SameSite=Lax/);
  assert.doesNotMatch(r.cookie, /Max-Age/); // not "remember me" -> browser-session cookie
  assert.strictEqual(r.data.token, undefined);
  assert.ok(r.data.user.permissions.users.includes("add"), "admin gets full permissions");
  assert.strictEqual((await call("/auth/me", { session: r.session })).status, 200);

  const remembered = await login("admin", "Admin1234", true);
  assert.match(remembered.cookie, /Max-Age=604800/);

  const out = await call("/auth/logout", { method: "POST", session: r.session });
  assert.match(out.setCookie[0], /Max-Age=0/);
});

test("wrong password is rejected; 5 wrong passwords lock the account for 15 minutes", async () => {
  const admin = (await login("admin", "Admin1234")).session;
  await call("/users", { session: admin, method: "POST", body: { name: "Lock Me", username: "lockme", password: "Right1234" } });
  for (let i = 0; i < 4; i++) assert.strictEqual((await login("lockme", "wrong")).status, 401);
  assert.strictEqual((await login("lockme", "wrong")).status, 401); // 5th sets the lock
  const locked = await login("lockme", "Right1234");
  assert.strictEqual(locked.status, 423);
  assert.match(locked.data.message, /locked/);
});

test("forgot + reset password: one-time link, unlocks the account, old sessions signed out", async () => {
  const admin = (await login("admin", "Admin1234")).session;
  await call("/users/" + (await findUser(admin, "lockme"))._id, { session: admin, method: "PUT", body: { email: "lockme@example.com" } });

  const unknown = await call("/auth/forgot-password", { method: "POST", body: { email: "nobody@example.com" } });
  assert.strictEqual(unknown.status, 200);
  const before = sent.length;
  await call("/auth/forgot-password", { method: "POST", body: { email: "lockme@example.com" } });
  await call("/auth/forgot-password", { method: "POST", body: { email: "lockme@example.com" } }); // cooldown
  assert.strictEqual(sent.length, before + 1);
  const token = sent.at(-1).text.match(/reset-password\?token=([a-f0-9]{64})/)[1];

  assert.strictEqual((await call("/auth/reset-password", { method: "POST", body: { token, password: "short" } })).status, 400);
  assert.strictEqual((await call("/auth/reset-password", { method: "POST", body: { token, password: "NewPass123" } })).status, 200);
  assert.strictEqual((await call("/auth/reset-password", { method: "POST", body: { token, password: "Other1234" } })).status, 400);
  assert.strictEqual((await login("lockme", "NewPass123")).status, 200); // unlocked by the reset
});

test("change password keeps this device signed in, signs out others", async () => {
  const a = await login("admin", "Admin1234");
  const b = await login("admin", "Admin1234");
  const r = await call("/auth/change-password", { session: a.session, method: "POST", body: { oldPassword: "Admin1234", newPassword: "Changed123" } });
  assert.strictEqual(r.status, 200);
  const renewed = r.setCookie[0].split(";")[0];
  assert.strictEqual((await call("/auth/me", { session: renewed })).status, 200);
  assert.strictEqual((await call("/auth/me", { session: b.session })).status, 401);
});

test("ADMIN_RESET_PASSWORD recovers a forgotten admin password once", async () => {
  const before = (await login("admin", "Changed123")).session;
  process.env.ADMIN_RESET_PASSWORD = "Recover123";
  const { ensureAdmin } = require("../server");
  await ensureAdmin();
  assert.strictEqual((await login("mis@example.com", "Recover123")).status, 200);
  assert.strictEqual((await call("/auth/me", { session: before })).status, 401);
  const after = (await login("admin", "Recover123")).session;
  await ensureAdmin(); // unchanged password: nobody is signed out again
  assert.strictEqual((await call("/auth/me", { session: after })).status, 200);
  delete process.env.ADMIN_RESET_PASSWORD;
});

async function findUser(session, username) {
  return (await call("/users", { session })).data.find((u) => u.username === username);
}

test("departments, roles and scope: a PC sees only their department", async () => {
  const admin = (await login("admin", "Recover123")).session;
  const qc = (await call("/org/departments", { session: admin, method: "POST", body: { name: "QC" } })).data;
  const dye = (await call("/org/departments", { session: admin, method: "POST", body: { name: "Dyeing" } })).data;
  assert.strictEqual((await call("/org/departments", { session: admin, method: "POST", body: { name: "QC" } })).status, 400);

  const mk = (username, role, department) =>
    call("/users", { session: admin, method: "POST", body: { name: username, username, password: "Pass12345", role, department } });
  assert.strictEqual((await mk("pcqc", "pc", qc._id)).status, 201);
  await mk("doerqc", "doer", qc._id);
  await mk("doerdye", "doer", dye._id);

  const pc = (await login("pcqc", "Pass12345")).session;
  const seen = (await call("/users", { session: pc })).data.map((u) => u.username).sort();
  assert.deepStrictEqual(seen, ["doerqc", "pcqc"]);
  const dyeId = (await findUser(admin, "doerdye"))._id;
  assert.strictEqual((await call(`/tasks?doer=${dyeId}`, { session: pc })).status, 403);
  assert.strictEqual((await call(`/mis?doer=${dyeId}`, { session: pc })).status, 403);

  // A PC cannot create users or admins by default; a doer cannot open the users list
  assert.strictEqual((await call("/users", { session: pc, method: "POST", body: { name: "x", username: "x", password: "Pass12345" } })).status, 403);
  const doer = (await login("doerqc", "Pass12345")).session;
  assert.strictEqual((await call("/users", { session: doer })).status, 403);
});

test("per-user permission override grants a doer access to one module", async () => {
  const admin = (await login("admin", "Recover123")).session;
  const u = await findUser(admin, "doerqc");
  await call(`/users/${u._id}`, { session: admin, method: "PUT", body: { permissions: { users: ["view"] } } });
  const doer = (await login("doerqc", "Pass12345")).session;
  assert.strictEqual((await call("/users", { session: doer })).status, 200);
});

test("bulk upload creates users with temp passwords and reports bad rows", async () => {
  const admin = (await login("admin", "Recover123")).session;
  const r = await call("/users/bulk", {
    session: admin,
    method: "POST",
    body: {
      createMissing: true,
      rows: [
        { name: "Ayush", email: "ayush@example.com", department: "Accounts", role: "hod" },
        { name: "Bad Email", email: "nope" },
        { name: "Dup", email: "MIS@example.com" },
        { name: "", email: "noname@example.com" },
      ],
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.created, 1);
  assert.strictEqual(r.data.failed, 3);
  const ok = r.data.results.find((x) => x.ok);
  assert.strictEqual((await login("ayush@example.com", ok.tempPassword)).status, 200);
  const depts = (await call("/org/departments", { session: admin })).data.map((d) => d.name);
  assert.ok(depts.includes("Accounts"), "missing department was created");
});

test("audit log records sign-ins and user changes", async () => {
  const admin = (await login("admin", "Recover123")).session;
  const rows = (await call("/audit?limit=200", { session: admin })).data.rows;
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ["auth.login", "auth.login_failed", "auth.locked", "user.create", "user.update", "user.bulk_upload", "department.create"]) {
    assert.ok(actions.has(a), `audit has ${a}`);
  }
});

test("FMS flow with roles: doer and own-department PC can complete a step, other PCs cannot", async () => {
  const admin = (await login("admin", "Recover123")).session;
  const doerqc = await findUser(admin, "doerqc");
  const dye = (await call("/org/departments", { session: admin })).data.find((d) => d.name === "Dyeing");
  await call("/users", { session: admin, method: "POST", body: { name: "pcdye", username: "pcdye", password: "Pass12345", role: "pc", department: dye._id } });

  const p = await call("/processes", {
    session: admin,
    method: "POST",
    body: { name: "QC Check", steps: [{ name: "Inspect", doer: doerqc._id, tat: 1 }, { name: "Report", doer: doerqc._id, tat: 2 }], fields: [] },
  });
  assert.strictEqual(p.status, 201);
  const job = await call("/jobs", { session: admin, method: "POST", body: { process: p.data._id, data: {} } });
  assert.strictEqual(job.status, 201);

  const tasks = (await call(`/tasks?doer=${doerqc._id}`, { session: admin })).data.tasks;
  const step1 = tasks.find((t) => t.stepName === "Inspect");
  const pcdye = (await login("pcdye", "Pass12345")).session;
  assert.strictEqual((await call(`/tasks/${step1._id}/done`, { session: pcdye, method: "POST", body: {} })).status, 403);
  const pcqc = (await login("pcqc", "Pass12345")).session;
  assert.strictEqual((await call(`/tasks/${step1._id}/done`, { session: pcqc, method: "POST", body: {} })).status, 200);

  const after = (await call(`/tasks?doer=${doerqc._id}`, { session: admin })).data.tasks;
  assert.ok(after.find((t) => t.stepName === "Report" && t.status === "pending" && t.plannedDay), "next step activated");
  const doer = (await login("doerqc", "Pass12345")).session;
  assert.strictEqual((await call(`/tasks/${step1._id}/reopen`, { session: doer, method: "POST" })).status, 403); // doer cannot reopen
});

test("legacy text departments migrate to Department records", async () => {
  const User = require("../models/User");
  await User.collection.insertOne({ name: "Old", username: "old1", password: "x", role: "doer", department: "Printing", active: true, tokenVersion: 0 });
  await require("../services/migrations").runMigrations();
  const u = await User.findOne({ username: "old1" }).populate("department").lean();
  assert.strictEqual(u.department.name, "Printing");
});
