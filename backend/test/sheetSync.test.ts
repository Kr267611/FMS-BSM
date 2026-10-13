// Sheet Sync of an imported FMS: the column map, what is written, the safety rules (formula cells, filled cells,
// moved rows, Viewer access), App → Sheet on Done / Not Required / Reopen, the catch-up, and Sheet → App.
// Everything runs on an in-memory sheet – no real Google Sheet is touched.
import test = require("node:test");
import assert = require("node:assert");
import path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "..", "node_modules", ".cache", "mongodb-memory-server");
import { MongoMemoryServer } from "mongodb-memory-server-core";
import sync = require("../services/fmsSheetSync");

const { colIndex, colLetter } = sync;
const DAY = 86400000;
const IST = 330 * 60 * 1000;
const serialOf = (d) => (+d + IST - Date.UTC(1899, 11, 30)) / DAY;

// ---------- an in-memory Google Sheet ----------
class FakeSheet {
  cells = new Map(); // "Q10" -> { raw, fmt, formula }
  readOnly = false;
  writes = [];
  set(ref, raw, extra: any = {}) {
    this.cells.set(ref, { raw, fmt: extra.fmt ?? (raw === "" ? "" : String(raw)), formula: extra.formula });
  }
  get(ref) {
    return this.cells.get(ref);
  }
  private grid(range, render) {
    const m = /!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    const [c1, r1, c2, r2] = [colIndex(m[1]), Number(m[2]), colIndex(m[3]), Number(m[4])];
    const rows = [];
    for (let r = r1; r <= r2; r++) {
      const row = [];
      for (let c = c1; c <= c2; c++) {
        const cell = this.cells.get(colLetter(c) + r);
        row.push(!cell ? "" : render === "FORMULA" ? cell.formula ?? cell.raw : render === "FORMATTED_VALUE" ? cell.fmt : cell.raw);
      }
      while (row.length && row[row.length - 1] === "") row.pop();
      rows.push(row);
    }
    return rows;
  }
  spreadsheets = {
    values: {
      get: async ({ range, valueRenderOption }) => ({ data: { values: this.grid(range, valueRenderOption) } }),
      batchUpdate: async ({ requestBody }) => {
        if (this.readOnly) throw Object.assign(new Error("The caller does not have permission"), { code: 403 });
        for (const d of requestBody.data) {
          const ref = /!([A-Z]+\d+)$/.exec(d.range)[1];
          const v = d.values[0][0];
          this.writes.push([ref, v]);
          if (v === "") this.cells.delete(ref);
          else if (requestBody.valueInputOption === "USER_ENTERED" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
            const d2 = new Date(v.replace(" ", "T") + "+05:30");
            this.set(ref, serialOf(d2), { fmt: v });
          } else if (requestBody.valueInputOption === "USER_ENTERED" && String(v).startsWith("'")) this.set(ref, String(v).slice(1));
          else this.set(ref, v);
        }
        return { data: {} };
      },
    },
    batchUpdate: async () => {
      if (this.readOnly) throw Object.assign(new Error("The caller does not have permission"), { code: 403 });
      return { data: { replies: [] } };
    },
  };
}

// ---------- pure ----------
const proc = {
  steps: [
    { key: "s1", name: "Store check", fields: [{ key: "status", label: "Status", type: "select", options: ["Done", "Pending"] }, { key: "remarks", label: "Remarks", type: "text" }, { key: "photo", label: "Photo", type: "photo" }] },
    { key: "s2", name: "Update to Ayush sir", fields: [{ key: "status", label: "Status", type: "select", options: ["Done", "Pending"] }] },
    { key: "s3", name: "Added in the app", fields: [] },
  ],
  fields: [{ key: "item", label: "Item", type: "text" }, { key: "qty", label: "Qty", type: "number" }],
  source: {
    spreadsheetId: "FAKE",
    tabName: "SPARE PART",
    firstDataRow: 8,
    fields: [["item", "B"], ["qty", "C"]],
    steps: [
      { key: "s1", planned: "P", actual: "Q", fields: [["status", "S"], ["remarks", "T"], ["photo", "U"]] },
      { key: "s2", planned: "AH", actual: "AI", fields: [["status", "AK"]] },
    ],
  },
};

test("column map: each step's columns as imported; Status / Remarks found; a step added in the app has none", () => {
  const cfg = sync.configOf(proc);
  assert.deepStrictEqual([cfg.push, cfg.pull, cfg.headerRow, cfg.doneText], [false, false, 7, "Done"]);
  const s1 = cfg.steps[0].cols.map((c) => [c.key, c.col, c.kind, c.write]);
  assert.deepStrictEqual(s1, [
    ["planned", "P", "planned", false],
    ["actual", "Q", "actual", true],
    ["delay", "R", "delay", false],
    ["status", "S", "status", true],
    ["remarks", "T", "remarks", true],
    ["photo", "U", "field", false], // photos are not written
  ]);
  assert.deepStrictEqual([cfg.steps[2].inSheet, cfg.steps[2].cols[1].col], [false, ""]);
  assert.strictEqual(sync.configOf({ steps: [] }), null); // not imported
});

test("settings: modes per step, no writing into formula columns or one column twice", () => {
  const ok = sync.cleanConfig(proc, { push: true, steps: { s2: { mode: "app" } } });
  assert.deepStrictEqual([ok.active, ok.steps.s2.mode, ok.steps.s1.mode], [true, "app", "inherit"]);
  assert.ok(ok.enabledAt);
  assert.throws(() => sync.cleanConfig(proc, { steps: { s1: { cols: { remarks: "AH" } } } }), /formula column/);
  assert.throws(() => sync.cleanConfig(proc, { steps: { s2: { cols: { status: "S" } } } }), /written by both/);
  assert.throws(() => sync.cleanConfig(proc, { steps: { s1: { cols: { status: "S1" } } } }), /not a column/);
  const off = sync.cleanConfig(proc, {});
  assert.deepStrictEqual([off.active, off.enabledAt], [false, undefined]);
});

test("what a finished step writes: Actual (IST date-time), Status, Remarks; Not Required; text kept as text", () => {
  const cfg = sync.configOf(proc);
  const at = new Date("2026-10-13T08:35:00Z"); // 14:05 IST
  const done = sync.cellsFor(cfg, cfg.steps[0], { status: "done", actual: at, values: { status: "Done" }, remarks: "=changed belt" });
  assert.deepStrictEqual(done.map((c) => [c.col, c.value]), [["Q", "2026-10-13 14:05:00"], ["S", "Done"], ["T", "'=changed belt"]]);
  const na = sync.cellsFor(cfg, cfg.steps[0], { status: "na", values: {}, remarks: "" });
  assert.deepStrictEqual(na.map((c) => [c.col, c.value]), [["S", "Not Required"]]);
  assert.deepStrictEqual(sync.cellsFor(cfg, cfg.steps[0], { status: "pending" }), []);
});

test("row check: the sheet row must still be this entry", () => {
  const job = { data: { item: "Bearing 6205", qty: 2 } };
  assert.deepStrictEqual(sync.rowMatches(proc, job, ["", "Bearing  6205", "2"], ["", "Bearing  6205", 2]).ok, true);
  const moved = sync.rowMatches(proc, job, ["", "V-Belt", "2"], ["", "V-Belt", 2]);
  assert.deepStrictEqual([moved.ok, moved.field, moved.sheet], [false, "Item", "V-Belt"]);
  assert.strictEqual(sync.rowMatches(proc, { data: {} }, [], []).checked, 0);
});

// ---------- the API with the in-memory sheet ----------
let srv, server, base;
const cookies: Record<string, any> = {};
const fake = new FakeSheet();
test.before(async () => {
  srv = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGO_URI: srv.getUri(), DB_NAME: "fms_sheetsync_test", JWT_SECRET: "test-secret", ADMIN_PASSWORD: "Admin1234", DISABLE_SCHEDULER: "1" });
  sync.setClientForTests(fake);
  const app = require("../server");
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}/api`;
});
test.after(async () => {
  sync.setClientForTests(null);
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
let Task, Job, Process;
async function settled(taskId) {
  for (let i = 0; i < 40; i++) {
    const t = await Task.findById(taskId).lean();
    if (t.sheetPush) return t.sheetPush;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
const stepTask = (jobId, key) => Task.findOne({ job: jobId, stepKey: key }).lean();
async function entry(item, row) {
  const j = await call("admin", "/jobs", { method: "POST", body: { process: ids.p, data: { item, qty: 1 } } });
  assert.strictEqual(j.status, 201, j.data.message);
  await Job.updateOne({ _id: j.data._id }, { $set: { sheetRow: row } });
  fake.set(`B${row}`, item);
  fake.set(`C${row}`, 1);
  fake.set(`P${row}`, 46300, { formula: `=A${row}+1`, fmt: "05/10/2026" });
  fake.set(`R${row}`, "", { formula: `=IF(Q${row}="","",Q${row}-P${row})` });
  return j.data._id;
}

test("setup: an FMS that came from a sheet, two doers, the sheet's header row", async () => {
  ({ Task, Job, Process } = { Task: require("../models/Task"), Job: require("../models/Job"), Process: require("../models/Process") });
  await login("admin", "Admin1234");
  for (const k of ["nikunj", "ayush"]) {
    const u = await call("admin", "/users", { method: "POST", body: { name: k, username: k, password: "1234", role: "doer" } });
    ids[k] = u.data._id;
    await login(k);
  }
  const body = {
    name: "Repeat Spare Part",
    active: true,
    fields: proc.fields,
    steps: [
      { key: "s1", name: "Store check", doer: { mode: "fixed", user: ids.nikunj }, start: { mode: "entry" }, tat: 1, tatUnit: "days", fields: proc.steps[0].fields },
      { key: "s2", name: "Update to Ayush sir", doer: { mode: "fixed", user: ids.ayush }, start: { mode: "afterDone", step: "s1" }, tat: 1, tatUnit: "days", fields: proc.steps[1].fields },
    ],
  };
  const p = await call("admin", "/processes", { method: "POST", body });
  assert.strictEqual(p.status, 201, p.data.message);
  ids.p = p.data._id;
  await Process.updateOne({ _id: ids.p }, { $set: { source: proc.source } });
  for (const [col, h] of Object.entries({ B: "Item", C: "Qty", P: "Planned", Q: "Actual", R: "Time Delay", S: "Status", T: "Remarks", U: "Photo", AH: "Planned", AI: "Actual", AJ: "Time Delay", AK: "Status" })) fake.set(`${col}7`, h);
  const got = (await call("admin", `/processes/${ids.p}/sheet-sync`)).data;
  assert.deepStrictEqual([got.config.push, got.config.steps.length], [false, 2]);
});

test("check with the sheet: every column's header, and Editor access", async () => {
  const c = (await call("admin", `/processes/${ids.p}/sheet-sync/check`, { method: "POST" })).data;
  assert.strictEqual(c.canWrite, true);
  assert.ok(c.steps[0].cols.every((x) => x.ok !== false), JSON.stringify(c.steps[0].cols));
  // writing into the Time Delay (formula) column is refused
  assert.match((await call("admin", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: { steps: { s1: { cols: { actual: "R" } } } } })).data.message, /formula column/);
  // a wrong letter shows at once
  await call("admin", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: { steps: { s1: { cols: { actual: "U" } } } } });
  const bad = (await call("admin", `/processes/${ids.p}/sheet-sync/check`, { method: "POST" })).data;
  assert.deepStrictEqual(bad.steps[0].cols.find((x) => x.key === "actual"), { key: "actual", col: "U", header: "Photo", ok: false });
  assert.strictEqual((await call("nikunj", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: {} })).status, 403);
  const reset = (await call("admin", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: { resetCols: true } })).data; // back to the import's columns, sync off
  assert.strictEqual(reset.config.steps[0].cols.find((x) => x.key === "actual").col, "Q");
});

test("off by default: Done in the app does not touch the sheet", async () => {
  const a = await entry("Bearing", 10);
  const t = await stepTask(a, "s1");
  assert.strictEqual((await call("nikunj", `/tasks/${t._id}/done`, { method: "POST", body: { values: { status: "Done" } } })).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepStrictEqual([(await stepTask(a, "s1")).sheetPush, fake.get("Q10"), fake.writes.length], [undefined, undefined, 0]);
});

test("App + Sheet: Done fills Actual, Status, Remarks of that step in that row; formulas stay", async () => {
  const s = await call("admin", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: { push: true } });
  assert.strictEqual(s.status, 200, s.data.message);
  ids.b = await entry("Belt", 11);
  const t = await stepTask(ids.b, "s1");
  await call("nikunj", `/tasks/${t._id}/done`, { method: "POST", body: { values: { status: "Done" }, remarks: "Changed the belt" } });
  const r = await settled(t._id);
  assert.strictEqual(r.state, "written", JSON.stringify(r));
  assert.ok(Math.abs(fake.get("Q11").raw - serialOf(new Date())) < 0.01); // a real date-time
  assert.deepStrictEqual([fake.get("S11").raw, fake.get("T11").raw], ["Done", "Changed the belt"]);
  assert.strictEqual(fake.get("R11").formula, '=IF(Q11="","",Q11-P11)'); // Time Delay formula untouched
  assert.strictEqual(fake.get("P11").formula, "=A11+1");
  assert.ok(!fake.writes.some(([ref]) => /^(P|R)11$/.test(ref)));
});

test("never overwrites: a cell already filled in the sheet stays as it is", async () => {
  const c = await entry("Chain", 12);
  fake.set("T12", "typed in the sheet");
  const t = await stepTask(c, "s1");
  await call("nikunj", `/tasks/${t._id}/done`, { method: "POST", body: { values: { status: "Done" }, remarks: "from the app" } });
  const r = await settled(t._id);
  assert.strictEqual(r.state, "partial");
  assert.deepStrictEqual(r.cells.find((x) => x.col === "T"), { key: "remarks", col: "T", label: "Remarks", value: "from the app", result: "filled", existing: "typed in the sheet" });
  assert.strictEqual(fake.get("T12").raw, "typed in the sheet");
});

test("rows moved in the sheet: nothing is written", async () => {
  const d = await entry("Gear", 13);
  fake.set("B13", "Pulley"); // someone inserted a row above
  const t = await stepTask(d, "s1");
  await call("nikunj", `/tasks/${t._id}/done`, { method: "POST", body: { values: { status: "Done" } } });
  const r = await settled(t._id);
  assert.strictEqual(r.state, "row-mismatch");
  assert.match(r.note, /Item: app "Gear", sheet "Pulley"/);
  assert.strictEqual(fake.get("Q13"), undefined);
});

test("a step set to App only is not written; Not Required writes the status text", async () => {
  await call("admin", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: { push: true, naText: "No Req", steps: { s2: { mode: "app" } } } });
  const s2 = await stepTask(ids.b, "s2");
  await call("ayush", `/tasks/${s2._id}/done`, { method: "POST", body: { values: { status: "Done" } } });
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(fake.get("AI11"), undefined);
  await call("admin", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: { push: true, naText: "No Req", steps: { s2: { mode: "sheet" } } } });
  const e = await entry("Nut", 14);
  await call("nikunj", `/tasks/${(await stepTask(e, "s1"))._id}/done`, { method: "POST", body: { values: { status: "Done" } } });
  const e2 = await stepTask(e, "s2");
  await call("ayush", `/tasks/${e2._id}/not-required`, { method: "POST", body: { remarks: "Not needed" } });
  const r = await settled(e2._id);
  assert.strictEqual(r.state, "written", JSON.stringify(r));
  assert.deepStrictEqual([fake.get("AK14").raw, fake.get("AI14")], ["No Req", undefined]);
});

test("reopen: kept by default (marked stale); 'clear' removes only what the app wrote", async () => {
  // entry "Belt" s2 is done app-only, so reopen entry "Nut"'s s2 (written) – keep
  const e2 = await Task.findOne({ stepKey: "s2", "sheetPush.state": "written" }).lean();
  await call("admin", `/tasks/${e2._id}/reopen`, { method: "POST" });
  await new Promise((r) => setTimeout(r, 200));
  const kept = (await Task.findById(e2._id).lean()).sheetPush;
  assert.deepStrictEqual([kept.stale, fake.get("AK14").raw], [true, "No Req"]);
  // clear: a fresh entry, done, then reopened
  await call("admin", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: { push: true, onReopen: "clear" } });
  const f = await entry("Bolt", 15);
  const t = await stepTask(f, "s1");
  await call("nikunj", `/tasks/${t._id}/done`, { method: "POST", body: { values: { status: "Done" } } });
  await settled(t._id);
  fake.set("T15", "added by hand later"); // not the app's – must stay
  await Task.updateOne({ _id: t._id }, { $set: { "sheetPush.cells": [...(await Task.findById(t._id).lean()).sheetPush.cells, { key: "remarks", col: "T", result: "written", after: "something else" }] } });
  await call("admin", `/tasks/${t._id}/reopen`, { method: "POST" });
  for (let i = 0; i < 40 && (await Task.findById(t._id).lean()).sheetPush.state !== "cleared"; i++) await new Promise((r) => setTimeout(r, 50));
  const cleared = (await Task.findById(t._id).lean()).sheetPush;
  assert.strictEqual(cleared.state, "cleared");
  assert.deepStrictEqual([fake.get("Q15"), fake.get("S15"), fake.get("T15").raw], [undefined, undefined, "added by hand later"]);
});

test("Viewer only: the write fails with a clear message; the catch-up writes it once Editor access is there", async () => {
  fake.readOnly = true;
  const c = (await call("admin", `/processes/${ids.p}/sheet-sync/check`, { method: "POST" })).data;
  assert.deepStrictEqual([c.canWrite, /Editor/.test(c.writeError)], [false, true]);
  const g = await entry("Washer", 16);
  const t = await stepTask(g, "s1");
  await call("nikunj", `/tasks/${t._id}/done`, { method: "POST", body: { values: { status: "Done" } } });
  const r = await settled(t._id);
  assert.deepStrictEqual([r.state, /Editor/.test(r.error)], ["failed", true]);
  fake.readOnly = false;
  assert.ok((await sync.catchUp(new Date())) >= 1);
  assert.strictEqual((await Task.findById(t._id).lean()).sheetPush.state, "written");
  assert.strictEqual(fake.get("S16").raw, "Done");
});

test("Sheet → App: a step finished in the sheet is finished in the app, and starts the next one", async () => {
  await call("admin", `/processes/${ids.p}/sheet-sync`, { method: "PUT", body: { push: true, pull: true } });
  const h = await entry("Pulley", 17);
  const yesterday = new Date(Date.now() - DAY);
  fake.set("Q17", serialOf(yesterday), { fmt: "12/10/2026 10:00:00" });
  fake.set("S17", "Done");
  fake.set("T17", "done in the sheet");
  fake.set("AI17", "No Req");
  const r = (await call("admin", `/processes/${ids.p}/sheet-sync/pull`, { method: "POST" })).data;
  assert.ok(r.finished >= 2, JSON.stringify(r));
  const s1 = await stepTask(h, "s1");
  assert.deepStrictEqual([s1.status, s1.remarks, s1.sheetPush.state], ["done", "done in the sheet", "from-sheet"]);
  assert.ok(Math.abs(+new Date(s1.actual) - +yesterday) < 60000);
  assert.strictEqual((await stepTask(h, "s2")).status, "na"); // "No Req" in the sheet
  // pulled steps are not written back
  await new Promise((x) => setTimeout(x, 150));
  assert.ok(!fake.writes.some(([ref]) => /17$/.test(ref)));
  // a moved row is skipped
  const k = await entry("Spring", 18);
  fake.set("B18", "Something else");
  fake.set("Q18", serialOf(yesterday));
  const r2 = (await call("admin", `/processes/${ids.p}/sheet-sync/pull`, { method: "POST" })).data;
  assert.ok(r2.skipped >= 1);
  assert.strictEqual((await stepTask(k, "s1")).status, "pending");
});

test("the Sheet Sync tab lists what happened", async () => {
  const got = (await call("admin", `/processes/${ids.p}/sheet-sync`)).data;
  assert.ok(got.counts.written >= 2 && got.counts["row-mismatch"] >= 1 && got.counts.partial >= 1, JSON.stringify(got.counts));
  assert.ok(got.recent.some((x) => x.state === "row-mismatch" && x.row === 13));
  assert.match(got.sheetUrl, /spreadsheets\/d\/FAKE$/);
});

test("check when the sheet cannot be read: columns are unknown, not marked wrong", async () => {
  const sheets = fake.spreadsheets;
  const broken = { ...fake, spreadsheets: { ...sheets, values: { ...sheets.values, get: async () => { throw Object.assign(new Error("Unable to parse range: 'SPARE PART'!A7:AK7"), { code: 400 }); } } } };
  sync.setClientForTests(broken);
  try {
    const c = (await call("admin", `/processes/${ids.p}/sheet-sync/check`, { method: "POST" })).data;
    assert.match(c.readError, /tab was not found/);
    assert.ok(c.steps.every((s) => s.cols.every((x) => x.ok === null)));
  } finally {
    sync.setClientForTests(fake);
  }
});
