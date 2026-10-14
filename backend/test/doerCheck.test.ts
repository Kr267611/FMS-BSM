// Doer check: an imported step whose sheet name ("Vinod Patel") did not match its user ("Vinod") – its work went to
// the person who made the entry. The check shows it, one call sets the doer and moves the open steps.
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";
import sheetFms = require("../services/sheetFms");

test("sheet names match users by the first name when only one user has it", () => {
  const users = [{ _id: 1, name: "Vinod" }, { _id: 2, name: "Rajesh Panchal" }, { _id: 3, name: "Bhaveshbhai" }, { _id: 4, name: "Amit Shah" }, { _id: 5, name: "Amit Jain" }];
  assert.strictEqual(sheetFms.matchUser("Vinod Patel", users)?._id, 1);
  assert.strictEqual(sheetFms.matchUser("RAJESH PANCHAL", users)?._id, 2);
  assert.strictEqual(sheetFms.matchUser("Bhavesh Bhai", users)?._id, 3);
  assert.strictEqual(sheetFms.matchUser("Amit Patel", users), null); // two Amits: not guessed
  assert.strictEqual(sheetFms.matchUser("Sunil", users), null);
});

let srv, server, base;
const cookies: Record<string, any> = {};
const ids: Record<string, any> = {};
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_doer_check_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
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

test("Doer check: shows the step, suggests the user, moves its open steps; a doer cannot fix", async () => {
  await login("admin", "Admin1234");
  for (const k of ["vinod", "rajesh"]) {
    const u = await call("admin", "/users", { method: "POST", body: { name: k === "vinod" ? "Vinod" : "Rajesh Panchal", username: k, password: "1234", role: "doer" } });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
  }
  const body = {
    name: "Design Costing",
    active: false, // as an import leaves it: a step without a doer (only a draft may be saved like that)
    fields: [{ key: "design", label: "Design No", type: "text" }],
    steps: [
      { key: "s1", name: "Vinod Patel · To Mark Done", doer: { mode: "fixed", hint: "Vinod Patel" }, start: { mode: "entry" }, tat: 1, tatUnit: "days", fields: [] },
      { key: "s2", name: "Rajesh · Check", doer: { mode: "fixed", user: ids.rajesh, hint: "Rajesh Panchal" }, start: { mode: "entry" }, tat: 1, tatUnit: "days", fields: [] },
    ],
  };
  const p = await call("admin", "/processes", { method: "POST", body });
  assert.strictEqual(p.status, 201, p.data.message);
  await require("../models/Process").updateOne({ _id: p.data._id }, { $set: { active: true } });
  for (const d of ["35020-M", "35021-M"]) assert.strictEqual((await call("admin", "/jobs", { method: "POST", body: { process: p.data._id, data: { design: d } } })).status, 201);

  const check = (await call("admin", `/processes/${p.data._id}/doer-check`)).data;
  const [s1, s2] = check.steps;
  assert.strictEqual(s1.doer, null);
  assert.deepStrictEqual([s1.suggested?.name, s1.wrong, s1.holders[0].name, s1.holders[0].count], ["Vinod", 2, "Admin", 2]);
  assert.ok(s1.problems.some((x) => /No doer chosen/.test(x)));
  assert.deepStrictEqual([s2.problems, s2.wrong], [[], 0]); // fine as it is

  await login("vinod");
  assert.strictEqual((await call("vinod", `/processes/${p.data._id}/doer-fix`, { method: "POST", body: { step: "s1", user: ids.vinod } })).status, 403);
  const fix = await call("admin", `/processes/${p.data._id}/doer-fix`, { method: "POST", body: { step: "s1", user: ids.vinod } });
  assert.deepStrictEqual([fix.status, fix.data.moved, fix.data.doer], [200, 2, "Vinod"]);
  const after = (await call("admin", `/processes/${p.data._id}/doer-check`)).data;
  assert.strictEqual(after.problems, 0);
  // Vinod now has both steps in My Tasks; new entries go to him as well
  assert.strictEqual((await call("admin", "/jobs", { method: "POST", body: { process: p.data._id, data: { design: "35022-M" } } })).status, 201);
  const mine = (await call("vinod", "/tasks?view=all")).data;
  const list = Array.isArray(mine) ? mine : mine.tasks || [...(mine.overdue || []), ...(mine.today || []), ...(mine.upcoming || [])];
  assert.strictEqual(list.filter((t) => t.stepKey === "s1").length, 3);
  assert.strictEqual((await call("admin", `/processes/${p.data._id}`)).data.steps[0].doer.hint, "Vinod Patel"); // the sheet's name is kept
});
