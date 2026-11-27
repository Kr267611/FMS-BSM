// Security locks: MongoDB operators and __proto__ keys are refused in bodies, queries and entry filters;
// a forged token (other algorithm / no signature) is refused; the cron secret is checked; API answers carry
// the safety headers and are never cached. Normal requests keep working.
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");
import jwt = require("jsonwebtoken");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";

let srv, server, base, cookie;
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_security_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1", CRON_SECRET: "cron-secret-123" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
});
test.after(async () => {
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});

const json = async (r): Promise<any> => r.json();
const send = (p, { method = "GET", body, headers = {} }: any = {}) =>
  fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: cookie || "", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });

test("the badKey check finds operators and prototype keys at any depth, and nothing in normal data", () => {
  const { badKey } = require("../services/inputGuard");
  assert.equal(badKey({ username: { $ne: null } }), "$ne");
  assert.equal(badKey({ a: [{ b: { $where: "1" } }] }), "$where");
  assert.equal(badKey(JSON.parse('{"__proto__": {"isAdmin": true}}')), "__proto__");
  assert.equal(badKey({ x: { constructor: { prototype: {} } } }), "constructor");
  assert.equal(badKey({ name: "$ Amount", data: { meter: "1000", note: "$ne in text is fine" }, list: ["$in"] }), null);
  assert.equal(badKey({ "$ Amount": 5 }), null); // a header with a space is not an operator
  assert.equal(badKey(null), null);
});

test("login with an operator instead of a name is refused; a normal login works", async () => {
  let res = await send("/auth/login", { method: "POST", body: { username: { $ne: "" }, password: { $ne: "" } } });
  assert.equal(res.status, 400);
  assert.match((await json(res)).message, /does not accept/);
  assert.equal(res.headers.getSetCookie().length, 0);

  res = await send("/auth/login", { method: "POST", body: '{"username":"admin","password":"Admin1234","__proto__":{"role":"admin"}}' });
  assert.equal(res.status, 400);

  res = await send("/auth/login", { method: "POST", body: { username: "admin", password: "Admin1234" } });
  assert.equal(res.status, 200);
  cookie = res.headers.getSetCookie().find((c) => c.startsWith("fms_session=")).split(";")[0];
  assert.equal((await json(await send("/auth/me"))).username, "admin");
});

test("operators in the query string and inside entry filters are refused", async () => {
  let res = await send("/users?$where=1");
  assert.equal(res.status, 400);
  // the query parser keeps "role[$ne]" as plain text (no nested object), so it is harmless and passes
  res = await send("/users?role[$ne]=x");
  assert.equal(res.status, 200);

  const me = await json(await send("/auth/me"));
  const p = await json(await send("/processes", { method: "POST", body: { name: "Guard FMS", active: true, fields: [{ key: "party", label: "Party", type: "text" }], steps: [{ key: "s1", name: "Check", tat: 1, doer: { mode: "user", user: me._id } }] } }));
  assert.ok(p._id, JSON.stringify(p));
  res = await send(`/jobs?process=${p._id}&f=${encodeURIComponent(JSON.stringify({ fields: { party: { $where: "sleep(1000)" } } }))}`);
  assert.equal(res.status, 400);
  res = await send(`/jobs?process=${p._id}&f=${encodeURIComponent(JSON.stringify({ fields: { party: { contains: "abc" } } }))}`);
  assert.equal(res.status, 200);
});

test("a token signed another way (none / another secret) is refused", async () => {
  const me = await json(await send("/auth/me"));
  const none = jwt.sign({ id: me._id, tv: 0 }, "", { algorithm: "none" } as any);
  let res = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${none}` } });
  assert.equal(res.status, 401);
  const other = jwt.sign({ id: me._id, tv: 0 }, "guessed-secret");
  res = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${other}` } });
  assert.equal(res.status, 401);
  const real = jwt.sign({ id: me._id, tv: 0 }, "test-secret", { algorithm: "HS256" });
  res = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${real}` } });
  assert.equal(res.status, 200);
});

test("cron needs the exact secret", async () => {
  for (const h of [undefined, "Bearer wrong", "Bearer cron-secret-12", "cron-secret-123"]) {
    const res = await fetch(base + "/cron/reminders", { headers: h ? { Authorization: h } : {} });
    assert.equal(res.status, 401, String(h));
  }
});

test("API answers carry the safety headers and are not cached", async () => {
  const res = await send("/auth/me");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("permissions-policy"), /microphone=\(\)/);
  assert.equal(res.headers.get("x-powered-by"), null);
});

// ---------- the 30-point security guide: access, other people's data, AI, photos, sign-in limits ----------

const origin = () => base.replace(/\/api$/, "");
const sessions: Record<string, string> = {};
async function loginAs(username, password = "1234") {
  const res = await send("/auth/login", { method: "POST", body: { username, password }, headers: { Cookie: "" } });
  assert.equal(res.status, 200, `${username} could not sign in`);
  sessions[username] = res.headers.getSetCookie().find((c) => c.startsWith("fms_session=")).split(";")[0];
}
const as = (who, p, opts: any = {}) => send(p, { ...opts, headers: { Cookie: sessions[who] || "", ...(opts.headers || {}) } });
const ids: Record<string, any> = {};
const User = () => require("../models/User");

// Every route in routes/*.ts, read from the source: a route added later is covered the day it is added
function allRoutes() {
  const fs = require("fs");
  const root = path.join(__dirname, "..", "..");
  const serverSrc = fs.readFileSync(path.join(root, "server.ts"), "utf8");
  const out = [];
  for (const [, mount, file] of serverSrc.matchAll(/app\.use\("([^"]+)", require\("\.\/routes\/(\w+)"\)\)/g)) {
    const src = fs.readFileSync(path.join(root, "routes", file + ".ts"), "utf8");
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*[`"]([^`"]+)[`"]/g)) {
      const p = m[2].replace(/\$\{[^}]+\}/g, "x").replace(/:\w+/g, "0123456789abcdef01234567");
      out.push({ method: m[1].toUpperCase(), path: mount + (p === "/" ? "" : p) });
    }
  }
  return out;
}
const PUBLIC = ["POST /api/auth/login", "POST /api/auth/logout", "POST /api/auth/forgot-password", "POST /api/auth/reset-password"];

test("deny by default: without a sign-in every API route answers 401 (only sign-in, sign-out and password reset are open)", async () => {
  const routes = allRoutes();
  assert.ok(routes.length >= 190, `only ${routes.length} routes found – the route reader is broken`);
  const open = [];
  for (const r of routes) {
    const res = await fetch(origin() + r.path, { method: r.method, headers: { "Content-Type": "application/json" }, body: r.method === "GET" ? undefined : "{}" });
    assert.ok(res.status < 500, `${r.method} ${r.path} -> ${res.status}`);
    if (res.status !== 401) open.push(`${r.method} ${r.path.replace(/0123456789abcdef01234567/g, ":id")}`);
  }
  assert.deepEqual(open.filter((x) => !PUBLIC.includes(x)), [], "these routes answer without a sign-in");
});

test("setup: two doers, a doer without FMS Entries, a whole-company viewer without MIS Score", async () => {
  const people: [string, any][] = [
    ["amit", {}],
    ["bina", {}],
    ["nofms", { permissions: { fmsEntries: [] } }],
    ["watcher", { reach: "all", permissions: { misScore: [] } }],
  ];
  for (const [username, extra] of people) {
    const res = await send("/users", { method: "POST", body: { name: username[0].toUpperCase() + username.slice(1), username, password: "1234", role: "doer", ...extra } });
    const body = await json(res);
    assert.equal(res.status, 201, JSON.stringify(body));
    ids[username] = body._id;
    await loginAs(username);
  }
});

test("someone else's delegation: another doer cannot see, change, delete, re-plan or finish it", async () => {
  const d = await json(await send("/delegations", { method: "POST", body: { title: "Count the stock", doer: ids.amit, date: "2027-03-02", time: "15:00" } }));
  assert.ok(d._id, JSON.stringify(d));
  assert.equal((await as("amit", `/delegations/${d._id}`)).status, 200); // the doer sees it
  assert.equal((await as("bina", `/delegations/${d._id}`)).status, 403);
  assert.equal((await as("bina", `/delegations/${d._id}`, { method: "PUT", body: { title: "Changed" } })).status, 403);
  assert.equal((await as("bina", `/delegations/${d._id}`, { method: "DELETE" })).status, 403);
  assert.equal((await as("bina", `/delegations/${d._id}/revision`, { method: "POST", body: { date: "2027-03-05", time: "15:00", reason: "more time" } })).status, 403);
  assert.equal((await as("bina", `/delegations/${d._id}/revision/approve`, { method: "POST" })).status, 403);
  assert.equal((await as("bina", `/delegations/${d._id}/reopen`, { method: "POST" })).status, 403);
  assert.equal((await as("bina", `/tasks/${d._id}/done`, { method: "POST", body: {} })).status, 403);
  assert.equal((await as("bina", "/delegations?view=all")).status, 403);
  const mine = await json(await as("bina", "/delegations?status=all"));
  assert.ok(!mine.tasks.some((t) => String(t._id) === String(d._id)), "the other doer's own list shows the task");
  assert.equal((await as("amit", `/tasks?doer=${ids.bina}`)).status, 403); // nor someone else's task list
});

test("the AI is no way around a missing page: FMS entries need FMS Entries, other people's MIS needs MIS Score", async () => {
  const tools = require("../services/ai/tools");
  const admin = await User().findOne({ username: "admin" }).lean();
  const nofms = await User().findOne({ username: "nofms" }).lean();
  const watcher = await User().findOne({ username: "watcher" }).lean();
  assert.match(await tools.runTool(admin, "find_entries", { fms: "Guard FMS", status: "all" }), /Guard FMS/);
  await assert.rejects(() => tools.runTool(nofms, "find_entries", { fms: "Guard FMS" }), /FMS Entries page/);
  await assert.rejects(() => tools.runTool(nofms, "entry_detail", { fms: "Guard FMS", entryNo: "1" }), /FMS Entries page/);
  await assert.rejects(() => tools.runTool(watcher, "mis_scores", { person: "Bina" }), /only your own MIS score/);
  assert.equal(typeof (await tools.runTool(watcher, "mis_scores", {})), "string"); // their own: allowed
  assert.equal(typeof (await tools.runTool(admin, "mis_scores", { person: "Bina" })), "string");
});

test("a photo's link cannot be worked out from another one: ids are fully random; a photo still opens", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const a = await json(await as("amit", "/files", { method: "POST", body: { data: png, name: "a.png" } }));
  const b = await json(await as("amit", "/files", { method: "POST", body: { data: png, name: "b.png" } }));
  assert.match(a.id, /^[0-9a-f]{24}$/);
  // a normal id shares its middle part (machine + process) with the next one and counts up at the end
  assert.notEqual(a.id.slice(8, 18), b.id.slice(8, 18));
  const res = await as("bina", `/files/${a.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${base}/files/${a.id}`)).status, 401); // never without a sign-in
});

test("a department's access settings are shown only to people who manage users or the org", async () => {
  const d = await json(await send("/org/departments", { method: "POST", body: { name: "QC" } }));
  assert.equal((await send(`/org/departments/${d._id}/permissions`, { method: "PUT", body: { permissions: { checklist: ["view"] } } })).status, 200);
  const forAdmin = (await json(await send("/org/departments"))).find((x) => x.name === "QC");
  assert.deepEqual(forAdmin.permissions, { checklist: ["view"] });
  const forDoer = (await json(await as("amit", "/org/departments"))).find((x) => x.name === "QC");
  assert.equal(forDoer.name, "QC");
  assert.equal("permissions" in forDoer, false);
});

// keep this test last: it fills the sign-in limit of this test machine's address
test("sign-in limit: right sign-ins never count; 30 wrong ones from one address stop the next try for 15 minutes", async () => {
  for (let i = 0; i < 35; i++) {
    const res = await send("/auth/login", { method: "POST", body: { username: "bina", password: "1234" }, headers: { Cookie: "" } });
    assert.equal(res.status, 200, `right sign-in ${i + 1} was stopped`);
  }
  for (let i = 0; i < 30; i++) {
    const res = await send("/auth/login", { method: "POST", body: { username: `nobody${i}`, password: "wrong" }, headers: { Cookie: "" } });
    assert.equal(res.status, 401);
  }
  const res = await send("/auth/login", { method: "POST", body: { username: "bina", password: "1234" }, headers: { Cookie: "" } });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) > 0);
});
