// The AI assistant: its read-only tools (scope, MIS from the app's own scoring, overdue tasks, FMS entries) and the
// agent loop with a fake Claude client – tools run, results go back in one message, the conversation is append-only,
// errors and refusals are handled, and only admins can use it.
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";

let srv, server, base;
const cookies: Record<string, any> = {};
const ids: Record<string, any> = {};
const DAY = 86400000;

test.before(async () => {
  srv = await MongoMemoryServer.create();
  delete process.env.ANTHROPIC_API_KEY;
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_ai_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
});
test.after(async () => {
  require("../services/ai/agent").setClientForTests(null);
  server?.close();
  await require("../config/db").closeDB();
  await srv?.stop();
});

async function login(username, password = "Pass12345") {
  const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  cookies[username] = res.headers.getSetCookie().find((c) => c.startsWith("fms_session=")).split(";")[0];
}
async function call(who, p, { method = "GET", body }: any = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: cookies[who] || "" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}
const post = (who, p, body = {}) => call(who, p, { method: "POST", body });
const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const tools = () => require("../services/ai/tools");
const agent = () => require("../services/ai/agent");
const User = () => require("../models/User");

test("setup: two departments, three doers, scored tasks and an FMS entry", async () => {
  await login("admin", "Admin1234");
  ids.store = (await post("admin", "/org/departments", { name: "Store" })).data._id;
  ids.qc = (await post("admin", "/org/departments", { name: "QC" })).data._id;
  for (const [k, name, dept] of [["ramesh", "Ramesh Kumar", ids.store], ["rameshp", "Ramesh Patel", ids.qc], ["amit", "Amit Shah", ids.qc]]) {
    const u = await post("admin", "/users", { name, username: k, password: "Pass12345", role: "doer", department: dept });
    assert.strictEqual(u.status, 201, u.data.message);
    ids[k] = u.data._id;
  }
  await login("amit");

  const Task = require("../models/Task");
  const now = Date.now();
  const at = (days, hour = 6) => new Date(new Date(now + days * DAY).setUTCHours(hour, 0, 0, 0));
  // Ramesh Kumar: one late (done the day after), one on time, one overdue (pending, planned 3 days ago)
  await Task.create([
    { kind: "checklist", label: "Oiling", doer: ids.ramesh, status: "done", planned: at(-5), plannedDay: key(at(-5)), actual: at(-4), actualDay: key(at(-4)) },
    { kind: "checklist", label: "Oiling", doer: ids.ramesh, status: "done", planned: at(-6), plannedDay: key(at(-6)), actual: at(-6), actualDay: key(at(-6)) },
    { kind: "delegation", label: "Send quote", doer: ids.ramesh, status: "pending", planned: at(-3), plannedDay: key(at(-3)) },
    // Amit: one on time; Ramesh Patel: nothing scored
    { kind: "checklist", label: "QC round", doer: ids.amit, status: "done", planned: at(-2), plannedDay: key(at(-2)), actual: at(-2), actualDay: key(at(-2)) },
  ]);

  const step = (k, name, user) => ({ key: k, name, doer: { mode: "fixed", user }, start: { mode: "entry" }, tat: 1, tatUnit: "days", fields: [] });
  const p = await post("admin", "/processes", { name: "Repeat Spare", fields: [{ key: "item", label: "Item", type: "text" }], steps: [step("s1", "Store check", ids.ramesh)] });
  assert.strictEqual(p.status, 201, p.data.message);
  const job = await post("admin", "/jobs", { process: p.data._id, data: { item: "Bearing 6205" } });
  assert.strictEqual(job.status, 201, job.data.message);
  ids.jobNo = job.data.jobNo;
});

test("tools: people search and a name that matches two people", async () => {
  const admin = await User().findOne({ username: "admin" });
  assert.match(await tools().runTool(admin, "find_people", { query: "ramesh" }), /Ramesh Kumar · doer · Store[\s\S]*Ramesh Patel · doer · QC/);
  await assert.rejects(() => tools().runTool(admin, "mis_scores", { person: "Ramesh" }), /matches 2 people: Ramesh Kumar .*Ramesh Patel/);
  await assert.rejects(() => tools().runTool(admin, "nope", {}), /Unknown tool/);
});

test("tools: MIS comes from the app's scoring – 1 late + 1 pending of 3 = −50", async () => {
  const admin = await User().findOne({ username: "admin" });
  const from = key(new Date(Date.now() - 10 * DAY));
  const out = await tools().runTool(admin, "mis_scores", { person: "Ramesh Kumar", from });
  assert.match(out, /Ramesh Kumar \(Store\): planned 3, done 2 \(on time 1, late 1\), pending 1, auto-closed 0, score -50/);
  assert.match(out, /- Oiling: planned 2/);
  assert.match(out, /- Delegations: planned 1/);
  const all = await tools().runTool(admin, "mis_scores", { from });
  assert.ok(all.indexOf("Ramesh Kumar") < all.indexOf("Amit Shah"), "worst score first");
});

test("tools: overdue tasks and FMS entries", async () => {
  const admin = await User().findOne({ username: "admin" });
  const overdue = await tools().runTool(admin, "list_tasks", { status: "overdue" });
  assert.match(overdue, /^1 overdue tasks/);
  assert.match(overdue, /\[DEL\] Send quote · Ramesh Kumar · planned .* · 3 days late/);
  assert.match(await tools().runTool(admin, "list_tasks", { status: "done_late", person: ids.ramesh }), /\[CHK\] Oiling · Ramesh Kumar/);
  await assert.rejects(() => tools().runTool(admin, "list_tasks", { status: "lost" }), /status must be one of/);

  assert.match(await tools().runTool(admin, "fms_overview", {}), /Repeat Spare: 1 open entries\n {4}· Store check: 1 pending, 0 overdue/);
  assert.match(await tools().runTool(admin, "find_entries", { fms: "repeat", text: "bearing" }), new RegExp(`#${ids.jobNo} .* Item: Bearing 6205 · now at: Store check \\(Ramesh Kumar`));
  assert.match(await tools().runTool(admin, "entry_detail", { fms: "Repeat Spare", entryNo: String(ids.jobNo) }), /Values:\n {2}Item: Bearing 6205\nSteps:\n {2}Store check – pending · Ramesh Kumar/);
});

test("tools: a doer reaches only themselves", async () => {
  const amit = await User().findOne({ username: "amit" });
  await assert.rejects(() => tools().runTool(amit, "mis_scores", { person: "Ramesh Kumar" }), /No person matching/);
  assert.match(await tools().runTool(amit, "find_people", {}), /^- Amit Shah[^\n]*$/);
  assert.match(await tools().runTool(amit, "list_tasks", { status: "overdue" }), /No overdue tasks/);
});

// ---------- the agent loop, with a fake Claude ----------

function fakeClaude(script: ((params) => any)[]) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(JSON.parse(JSON.stringify(params)));
          const next = script.shift();
          if (!next) throw new Error("fake: no more replies");
          return next(params);
        },
      },
    },
  };
}
const reply = (content, stop_reason) => () => ({ content, stop_reason, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 } });

test("chat: AI is off without a key; only admins can use it", async () => {
  agent().setClientForTests(null);
  assert.strictEqual((await call("admin", "/ai/status")).data.enabled, false);
  const off = await post("admin", "/ai/chat", { message: "hi" });
  assert.strictEqual(off.status, 503);
  assert.match(off.data.message, /ANTHROPIC_API_KEY/);
  assert.strictEqual((await post("amit", "/ai/chat", { message: "hi" })).status, 403);
  assert.strictEqual((await call("amit", "/ai/conversations")).status, 403);
});

test("chat: the model calls a tool, gets the result, answers; the conversation is saved append-only", async () => {
  const fake = fakeClaude([
    reply([{ type: "thinking", thinking: "", signature: "sig1" }, { type: "tool_use", id: "tu1", name: "list_tasks", input: { status: "overdue" } }], "tool_use"),
    reply([{ type: "text", text: "1 kaam overdue hai: Ramesh Kumar ka Send quote." }], "end_turn"),
  ]);
  agent().setClientForTests(fake);
  const r = await post("admin", "/ai/chat", { message: "Kya overdue hai?" });
  assert.strictEqual(r.status, 200, r.data.message);
  assert.strictEqual(r.data.reply, "1 kaam overdue hai: Ramesh Kumar ka Send quote.");
  assert.deepStrictEqual(r.data.steps, [{ tool: "list_tasks", input: { status: "overdue" }, ok: true }]);

  // request shape: default model, fallbacks, cached stable prefix, tools, today's date in the question
  const first = fake.calls[0];
  assert.strictEqual(first.model, "claude-opus-5-5");
  assert.strictEqual(first.fallbacks, "default");
  assert.deepStrictEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  assert.deepStrictEqual(first.cache_control, { type: "ephemeral" });
  assert.deepStrictEqual(first.tools.map((t) => t.name), ["find_people", "mis_scores", "list_tasks", "fms_overview", "find_entries", "entry_detail"]);
  assert.match(first.messages[0].content, /^\[Today: \d{4}-\d{2}-\d{2} \(.*IST\)\]\nKya overdue hai\?$/);
  // the tool result goes back after the model's own blocks, unchanged
  const second = fake.calls[1];
  assert.deepStrictEqual(second.messages[1].content, [{ type: "thinking", thinking: "", signature: "sig1" }, { type: "tool_use", id: "tu1", name: "list_tasks", input: { status: "overdue" } }]);
  assert.strictEqual(second.messages[2].content[0].tool_use_id, "tu1");
  assert.match(second.messages[2].content[0].content, /Send quote · Ramesh Kumar/);

  // a follow-up sends the earlier conversation exactly as it was, then the new question
  const fake2 = fakeClaude([reply([{ type: "text", text: "Haan." }], "end_turn")]);
  agent().setClientForTests(fake2);
  const r2 = await post("admin", "/ai/chat", { conversationId: r.data.conversationId, message: "Pakka?" });
  assert.strictEqual(r2.status, 200, r2.data.message);
  const earlier = [...second.messages, { role: "assistant", content: [{ type: "text", text: "1 kaam overdue hai: Ramesh Kumar ka Send quote." }] }];
  assert.deepStrictEqual(fake2.calls[0].messages.slice(0, earlier.length), earlier);

  const convo = await call("admin", `/ai/conversations/${r.data.conversationId}`);
  assert.deepStrictEqual(convo.data.turns.map((t) => [t.role, t.text]), [["user", "Kya overdue hai?"], ["assistant", "1 kaam overdue hai: Ramesh Kumar ka Send quote."], ["user", "Pakka?"], ["assistant", "Haan."]]);
  assert.strictEqual((await call("admin", "/ai/conversations")).data.length, 1);
});

test("chat: a failing tool is sent back as an error result; a refusal gets a polite answer", async () => {
  const fake = fakeClaude([
    reply([{ type: "tool_use", id: "a", name: "mis_scores", input: { person: "Ramesh" } }, { type: "tool_use", id: "b", name: "fms_overview", input: {} }], "tool_use"),
    reply([{ type: "text", text: "Kaunsa Ramesh?" }], "end_turn"),
  ]);
  agent().setClientForTests(fake);
  const r = await post("admin", "/ai/chat", { message: "Ramesh ka score?" });
  assert.strictEqual(r.data.reply, "Kaunsa Ramesh?");
  const results = fake.calls[1].messages.at(-1).content;
  assert.strictEqual(results.length, 2, "both results in one message");
  assert.strictEqual(results[0].is_error, true);
  assert.match(results[0].content, /matches 2 people/);
  assert.strictEqual(results[1].is_error, undefined);

  agent().setClientForTests(fakeClaude([reply([], "refusal")]));
  const ref = await post("admin", "/ai/chat", { message: "x" });
  assert.match(ref.data.reply, /jawab main nahi de sakta/);
});

test("chat: stops after 10 rounds of tools; other people's chats are not visible", async () => {
  agent().setClientForTests(fakeClaude(Array.from({ length: 10 }, (_, i) => reply([{ type: "tool_use", id: `t${i}`, name: "fms_overview", input: {} }], "tool_use"))));
  const r = await post("admin", "/ai/chat", { message: "loop" });
  assert.match(r.data.reply, /bahut steps/);
  assert.strictEqual((await call("admin", `/ai/conversations/${"0".repeat(24)}`)).status, 404);
  assert.strictEqual((await call("admin", `/ai/conversations/${r.data.conversationId}`, { method: "DELETE" })).status, 200);
});
