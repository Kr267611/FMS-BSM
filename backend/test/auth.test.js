// End-to-end auth flow against a throwaway in-memory MongoDB and a fake mailer.
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

async function call(p, { token, method = "GET", body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const login = (username, password) => call("/auth/login", { method: "POST", body: { username, password } });

test("sign in with email (any case) or username; wrong password is rejected", async () => {
  assert.strictEqual((await login("mis@example.com", "Admin1234")).status, 200);
  assert.strictEqual((await login("MIS@EXAMPLE.COM", "Admin1234")).status, 200);
  assert.strictEqual((await login("admin", "Admin1234")).status, 200);
  const bad = await login("mis@example.com", "wrong");
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(bad.data.message, "Incorrect email or password");
});

test("forgot + reset password: one-time link, old sessions signed out", async () => {
  const oldToken = (await login("admin", "Admin1234")).data.token;

  const unknown = await call("/auth/forgot-password", { method: "POST", body: { email: "nobody@example.com" } });
  assert.strictEqual(unknown.status, 200); // same answer for unknown emails
  assert.strictEqual(sent.length, 0);

  await call("/auth/forgot-password", { method: "POST", body: { email: "mis@example.com" } });
  await call("/auth/forgot-password", { method: "POST", body: { email: "mis@example.com" } }); // cooldown
  assert.strictEqual(sent.length, 1);
  const link = sent[0].text.match(/https:\/\/fms\.example\.com\/reset-password\?token=([a-f0-9]{64})/);
  assert.ok(link, "email contains the reset link on APP_URL");
  const token = link[1];

  assert.strictEqual((await call("/auth/reset-password", { method: "POST", body: { token, password: "short" } })).status, 400);
  const ok = await call("/auth/reset-password", { method: "POST", body: { token, password: "NewPass123" } });
  assert.strictEqual(ok.status, 200);

  assert.strictEqual((await call("/auth/me", { token: oldToken })).status, 401); // signed out
  assert.strictEqual((await call("/auth/reset-password", { method: "POST", body: { token, password: "Other1234" } })).status, 400); // used once
  assert.strictEqual((await login("admin", "Admin1234")).status, 401);
  assert.strictEqual((await login("mis@example.com", "NewPass123")).status, 200);
});

test("change password keeps this device signed in, signs out others", async () => {
  const a = (await login("admin", "NewPass123")).data.token;
  const b = (await login("admin", "NewPass123")).data.token;
  const r = await call("/auth/change-password", { token: a, method: "POST", body: { oldPassword: "NewPass123", newPassword: "Changed123" } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await call("/auth/me", { token: r.data.token })).status, 200);
  assert.strictEqual((await call("/auth/me", { token: b })).status, 401);
});

test("an existing admin without email gets ADMIN_EMAIL on the next start", async () => {
  const User = require("../models/User");
  const bcrypt = require("bcryptjs");
  await User.create({ name: "Old admin", username: "boss", role: "admin", password: await bcrypt.hash("Boss12345", 10) });
  process.env.ADMIN_USERNAME = "boss";
  process.env.ADMIN_EMAIL = "boss@example.com";
  await require("../server").ensureAdmin();
  assert.strictEqual((await login("boss@example.com", "Boss12345")).status, 200);
  delete process.env.ADMIN_USERNAME;
});

test("ADMIN_RESET_PASSWORD recovers a forgotten admin password once", async () => {
  const before = (await login("mis@example.com", "Changed123")).data.token;
  process.env.ADMIN_RESET_PASSWORD = "Recover123";
  const { ensureAdmin } = require("../server");
  await ensureAdmin();
  assert.strictEqual((await login("mis@example.com", "Recover123")).status, 200);
  assert.strictEqual((await login("admin", "Recover123")).status, 200);
  assert.strictEqual((await call("/auth/me", { token: before })).status, 401); // old sessions ended
  const after = (await login("admin", "Recover123")).data.token;
  await ensureAdmin(); // variable still set: same password, so nobody is signed out again
  assert.strictEqual((await call("/auth/me", { token: after })).status, 200);
  delete process.env.ADMIN_RESET_PASSWORD;
  // put the password back for the next test
  await call("/auth/change-password", { token: after, method: "POST", body: { oldPassword: "Recover123", newPassword: "Changed123" } });
});

test("users: email must be valid and unique, passwords need 8+ chars with letters and numbers", async () => {
  const t = (await login("admin", "Changed123")).data.token;
  const make = (body) => call("/users", { token: t, method: "POST", body: { name: "Doer", password: "Doer12345", ...body } });
  assert.strictEqual((await make({ username: "d1", email: "not-an-email" })).status, 400);
  assert.strictEqual((await make({ username: "d2", email: "MIS@example.com" })).data.message, "Another user already has this email address");
  assert.strictEqual((await make({ username: "d3", password: "abcdefgh" })).status, 400);
  assert.strictEqual((await make({ username: "d4", email: "doer@example.com" })).status, 201);
  assert.strictEqual((await make({ username: "d5" })).status, 201); // email optional
  assert.strictEqual((await make({ username: "d6" })).status, 201); // many users without email
});
