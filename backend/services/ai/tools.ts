// The AI assistant's tools: read-only questions about people, the MIS, tasks and FMS entries.
// Every tool runs as the signed-in user and sees only the people their access reaches (scope.ts).
// Nothing here changes data.
import mongoose = require("mongoose");
import User = require("../../models/User");
import Task = require("../../models/Task");
import Job = require("../../models/Job");
import Process = require("../../models/Process");
import scoringLib = require("../scoring");
import scopeLib = require("../scope");
import datesLib = require("../dates");
import sheetTools = require("./sheetTools");
import driveTools = require("./driveTools");
import knowledge = require("./knowledge");
import googleAccess = require("./googleAccess");
const { misReport } = scoringLib;
const { visibleUserIds } = scopeLib;
const { todayKey, addDaysKey } = datesLib;

const MAX_CHARS = 20000;

function fail(message: string): never {
  throw new Error(message);
}

const esc = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isId = (s: any) => /^[0-9a-f]{24}$/i.test(String(s || ""));
const isDay = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const short = (v: any, max = 60) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};
const istTime = (d: any) =>
  d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
const cap = (text: string) => (text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n… (cut – ask a narrower question)" : text);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// People this user may see: null = everyone
async function reach(user) {
  return visibleUserIds(user);
}

// "Ramesh", a part of a name, an employee code or an id -> one person (or a clear list to choose from)
async function resolvePerson(user, text: string) {
  const visible = await reach(user);
  const scope = visible === null ? {} : { _id: { $in: visible } };
  if (isId(text)) {
    const u = await User.findOne({ _id: text, ...scope }).select("name").lean<any>();
    return u || fail(`No person with id ${text} that you can see`);
  }
  const q = String(text || "").trim();
  if (q.length < 2) fail("Give at least 2 letters of the name");
  const re = new RegExp(esc(q), "i");
  const found = await User.find({ ...scope, $or: [{ name: re }, { employeeCode: q }, { username: q.toLowerCase() }] })
    .select("name employeeCode active")
    .limit(10)
    .lean<any>();
  if (!found.length) fail(`No person matching "${q}". Use find_people to search.`);
  const exact = found.filter((u) => u.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (found.length === 1) return found[0];
  fail(`"${q}" matches ${found.length} people: ${found.map((u) => `${u.name} (id ${u._id})`).join(", ")}. Ask which one, or use the id.`);
}

async function resolveProcess(text: string) {
  const q = String(text || "").trim();
  if (isId(q)) return (await Process.findById(q).lean<any>()) || fail(`No FMS with id ${q}`);
  if (q.length < 2) fail("Give the FMS name");
  const list = await Process.find({ name: new RegExp(esc(q), "i") }).lean<any>();
  if (!list.length) fail(`No FMS matching "${q}". Use fms_overview to see the names.`);
  const exact = list.find((p) => p.name.toLowerCase() === q.toLowerCase());
  if (exact || list.length === 1) return exact || list[0];
  fail(`"${q}" matches: ${list.map((p) => p.name).join(", ")}. Which one?`);
}

// ---------- the tools ----------

async function findPeople(user, input) {
  const visible = await reach(user);
  const q = String(input.query || "").trim();
  const filter: any = visible === null ? {} : { _id: { $in: visible } };
  if (q) {
    const re = new RegExp(esc(q), "i");
    filter.$or = [{ name: re }, { employeeCode: q }, { phone: q }, { username: q.toLowerCase() }];
  }
  const people = await User.find(filter).select("name role department employeeCode active").populate("department", "name").sort({ name: 1 }).limit(Math.min(Number(input.limit) || 25, 100)).lean<any>();
  if (!people.length) return "No people found.";
  return people
    .map((u) => `- ${u.name} · ${u.role}${u.department?.name ? ` · ${u.department.name}` : ""}${u.employeeCode ? ` · code ${u.employeeCode}` : ""}${u.active === false ? " · inactive" : ""} · id ${u._id}`)
    .join("\n");
}

async function misScores(user, input) {
  const today = todayKey();
  const from = isDay(input.from) ? input.from : today.slice(0, 8) + "01";
  const to = isDay(input.to) ? input.to : today;
  if (from > to) fail("from must be on or before to");
  const visible = await reach(user);
  const person = input.person ? await resolvePerson(user, input.person) : null;
  const report = await misReport({ from, to, doerId: person ? String(person._id) : null, doerIds: person ? null : visible });
  if (!report.doers.length) return `No scored tasks between ${report.from} and ${report.to}.`;
  const line = (t) => `planned ${t.planned}, done ${t.actual} (on time ${t.onTime}, late ${t.late}), pending ${t.pending}, auto-closed ${t.autoClosed || 0}, score ${t.score}`;
  const head = `MIS ${report.from} to ${report.to} (score = −(50×late + 100×pending) ÷ planned; 0 is perfect).`;
  if (person) {
    const d = report.doers[0];
    return cap(`${head}\n${d.doer.name}${d.doer.department ? ` (${d.doer.department})` : ""}: ${line(d.total)}\nRows:\n${d.rows.map((r) => `- ${r.label}: ${line(r)}`).join("\n")}`);
  }
  const limit = Math.min(Number(input.limit) || 40, 200);
  return cap(
    `${head}\n${report.doers.length} people, worst score first${report.doers.length > limit ? ` (first ${limit})` : ""}:\n` +
      report.doers
        .slice(0, limit)
        .map((d) => `- ${d.doer.name}${d.doer.department ? ` (${d.doer.department})` : ""}: ${line(d.total)}`)
        .join("\n")
  );
}

const KINDS = { checklist: "checklist", delegation: "delegation", fms: "app", ticket: "ticket", sheet: "sheet" };
const KIND_TAG = { checklist: "CHK", delegation: "DEL", app: "FMS", ticket: "TKT", sheet: "SHEET" };
const STATUSES = ["overdue", "due_today", "pending", "done", "done_late", "not_required", "auto_closed"];

async function listTasks(user, input, now = new Date()) {
  const status = String(input.status || "overdue");
  if (!STATUSES.includes(status)) fail(`status must be one of: ${STATUSES.join(", ")}`);
  const visible = await reach(user);
  const filter: any = {};
  if (input.person) filter.doer = (await resolvePerson(user, input.person))._id;
  else if (visible !== null) filter.doer = { $in: visible.map((id) => new mongoose.Types.ObjectId(String(id))) };
  if (input.kind) {
    const k = KINDS[String(input.kind)];
    if (!k) fail(`kind must be one of: ${Object.keys(KINDS).join(", ")}`);
    filter.kind = k;
  }
  const today = todayKey();
  if (status === "overdue") Object.assign(filter, { status: "pending", planned: { $lt: now } });
  else if (status === "due_today") Object.assign(filter, { status: "pending", plannedDay: today });
  else if (status === "pending") filter.status = "pending";
  else if (status === "done") filter.status = "done";
  else if (status === "done_late") Object.assign(filter, { status: "done", $expr: { $gt: ["$actualDay", "$plannedDay"] } });
  else if (status === "not_required") filter.status = "na";
  else if (status === "auto_closed") filter.status = "expired";
  const range: any = {};
  if (isDay(input.from)) range.$gte = input.from;
  if (isDay(input.to)) range.$lte = input.to;
  if (Object.keys(range).length) filter.plannedDay = { ...(typeof filter.plannedDay === "object" ? filter.plannedDay : {}), ...range };
  else if (status === "done" || status === "done_late") filter.plannedDay = { $gte: addDaysKey(today, -30) }; // recent by default

  const limit = Math.min(Number(input.limit) || 30, 100);
  const [total, tasks] = await Promise.all([
    Task.countDocuments(filter),
    Task.find(filter)
      .select("kind label doer planned plannedDay actual actualDay status stepName job process remarks")
      .populate("doer", "name")
      .populate("job", "jobNo")
      .populate("process", "name")
      .sort({ planned: 1 })
      .limit(limit)
      .lean<any>(),
  ]);
  if (!total) return `No ${status.replace("_", " ")} tasks.`;
  const lines = tasks.map((t) => {
    const where = t.kind === "app" ? `${t.process?.name || "FMS"} #${t.job?.jobNo || "?"} – ${t.stepName || t.label}` : t.label;
    const late = t.status === "pending" && t.planned && new Date(t.planned) < now ? ` · ${daysBetween(t.plannedDay, today)} days late` : "";
    const done = t.actual ? ` · done ${istTime(t.actual)}` : "";
    return `- [${KIND_TAG[t.kind] || t.kind}] ${short(where, 80)} · ${t.doer?.name || "no doer"} · planned ${istTime(t.planned) || t.plannedDay}${done}${late}`;
  });
  return cap(`${total} ${status.replace("_", " ")} tasks${total > tasks.length ? ` (first ${tasks.length}, oldest planned first)` : ""}:\n${lines.join("\n")}`);
}

async function fmsOverview(user, _input, now = new Date()) {
  const visible = await reach(user);
  const processes = await Process.find({ active: { $ne: false } }).select("name steps.key steps.name").sort({ name: 1 }).lean<any>();
  if (!processes.length) return "No FMS yet.";
  const match: any = { kind: "app", status: "pending" };
  if (visible !== null) match.doer = { $in: visible.map((id) => new mongoose.Types.ObjectId(String(id))) };
  const [open, steps] = await Promise.all([
    Job.aggregate([{ $match: { status: "open" } }, { $group: { _id: "$process", n: { $sum: 1 } } }]),
    Task.aggregate([
      { $match: match },
      { $group: { _id: { p: "$process", s: "$stepName" }, pending: { $sum: 1 }, overdue: { $sum: { $cond: [{ $lt: ["$planned", now] }, 1, 0] } } } },
    ]),
  ]);
  const openOf = new Map(open.map((o) => [String(o._id), o.n]));
  return cap(
    processes
      .map((p) => {
        const mine = steps.filter((s) => String(s._id.p) === String(p._id)).sort((a, b) => b.overdue - a.overdue);
        const stepLines = mine.map((s) => `    · ${s._id.s}: ${s.pending} pending, ${s.overdue} overdue`).join("\n");
        return `- ${p.name}: ${openOf.get(String(p._id)) || 0} open entries${stepLines ? `\n${stepLines}` : ""}`;
      })
      .join("\n")
  );
}

async function findEntries(user, input) {
  const p = await resolveProcess(input.fms);
  const filter: any = { process: p._id };
  const status = String(input.status || "open");
  if (status !== "all") filter.status = status === "closed" ? "closed" : "open";
  if (input.text) filter.searchText = new RegExp(esc(String(input.text).toLowerCase()), "i");
  const limit = Math.min(Number(input.limit) || 20, 100);
  const [total, jobs] = await Promise.all([Job.countDocuments(filter), Job.find(filter).sort({ startDate: -1 }).limit(limit).lean<any>()]);
  if (!total) return `No ${status === "all" ? "" : status + " "}entries in ${p.name}${input.text ? ` matching "${input.text}"` : ""}.`;
  const pending = await Task.find({ job: { $in: jobs.map((j) => j._id) }, status: "pending" }).select("job stepName doer planned").populate("doer", "name").lean<any>();
  const fields = (p.fields || []).slice(0, 3);
  const lines = jobs.map((j) => {
    const vals = fields.map((f) => `${f.label}: ${short(j.data?.[f.key], 30)}`).filter((s) => !s.endsWith(": ")).join(", ");
    const now = pending.filter((t) => String(t.job) === String(j._id)).map((t) => `${t.stepName} (${t.doer?.name || "?"}, by ${istTime(t.planned)})`);
    return `- #${j.jobNo} · ${istTime(j.startDate)} · ${j.status}${j.closeStatus ? ` (${j.closeStatus})` : ""}${vals ? ` · ${vals}` : ""}${now.length ? ` · now at: ${now.join("; ")}` : ""}`;
  });
  return cap(`${total} entries in ${p.name}${total > jobs.length ? ` (newest ${jobs.length})` : ""}:\n${lines.join("\n")}`);
}

async function entryDetail(user, input) {
  const p = await resolveProcess(input.fms);
  const job = await Job.findOne({ process: p._id, jobNo: String(input.entryNo || "").replace(/^#/, "") }).lean<any>();
  if (!job) fail(`Entry #${input.entryNo} not found in ${p.name}`);
  const tasks = await Task.find({ job: job._id }).populate("doer", "name").populate("doneBy", "name").sort({ stepIndex: 1 }).lean<any>();
  const fields = (p.fields || []).map((f) => `  ${f.label}: ${short(job.data?.[f.key], 80)}`).filter((s) => !/:\s*$/.test(s));
  const steps = tasks.map((t) => {
    const delay = t.actualDay && t.plannedDay ? daysBetween(t.plannedDay, t.actualDay) : null;
    const vals = Object.entries(t.values || {}).map(([k, v]) => `${k}: ${short(v, 40)}`).join(", ");
    return `  ${t.stepName || t.label} – ${t.status} · ${t.doer?.name || "no doer"}${t.planned ? ` · planned ${istTime(t.planned)}` : ""}${t.actual ? ` · actual ${istTime(t.actual)}` : ""}${delay !== null ? ` · delay ${delay} days` : ""}${vals ? ` · ${vals}` : ""}${t.remarks ? ` · remarks: ${short(t.remarks, 60)}` : ""}${t.skipReason ? ` · ${short(t.skipReason, 60)}` : ""}`;
  });
  return cap(`${p.name} #${job.jobNo} · started ${istTime(job.startDate)} · ${job.status}${job.closeStatus ? ` (${job.closeStatus})` : ""}\nValues:\n${fields.join("\n") || "  (none)"}\nSteps:\n${steps.join("\n") || "  (none yet)"}`);
}

// ---------- definitions sent to Claude (kept in a fixed order so the prompt cache stays valid) ----------

const DEFS = [
  {
    name: "find_people",
    description: "Search people (name, employee code, phone or username). Empty query lists everyone you can see. Returns name, role, department and id.",
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
  },
  {
    name: "mis_scores",
    description:
      "MIS score from the app's own scoring for a date range (default: this month to today). With person: that person's total and every row (each checklist, delegations, each FMS step). Without: everyone you can see, worst score first.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
        person: { type: "string", description: "Name, employee code or id" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_tasks",
    description:
      "Tasks by status: overdue (pending and past planned time), due_today, pending, done, done_late, not_required, auto_closed. Optional person, kind (checklist, delegation, fms, ticket, sheet) and planned-date range. Oldest planned first.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUSES },
        person: { type: "string" },
        kind: { type: "string", enum: Object.keys(KINDS) },
        from: { type: "string", description: "planned day from, YYYY-MM-DD" },
        to: { type: "string", description: "planned day to, YYYY-MM-DD" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
  {
    name: "fms_overview",
    description: "Every active FMS with its open entries, and per step how many are pending and overdue.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_entries",
    description: "Entries of one FMS (newest first), with their first values and the step each is waiting at. Optional text search in the entry values and status open / closed / all.",
    input_schema: {
      type: "object",
      properties: {
        fms: { type: "string", description: "FMS name (or part of it)" },
        text: { type: "string" },
        status: { type: "string", enum: ["open", "closed", "all"] },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["fms"],
      additionalProperties: false,
    },
  },
  {
    name: "entry_detail",
    description: "One FMS entry: its values and every step with doer, planned, actual, delay, filled values and remarks.",
    input_schema: { type: "object", properties: { fms: { type: "string" }, entryNo: { type: "string" } }, required: ["fms", "entryNo"], additionalProperties: false },
  },
];

const RUN = {
  ...sheetTools.RUN,
  ...driveTools.RUN,
  ...knowledge.RUN,
  find_people: findPeople,
  mis_scores: misScores,
  list_tasks: listTasks,
  fms_overview: fmsOverview,
  find_entries: findEntries,
  entry_detail: entryDetail,
};

async function runTool(user, name: string, input: any) {
  const fn = RUN[name];
  if (!fn) fail(`Unknown tool ${name}`);
  const args = input && typeof input === "object" ? input : {};
  // Google tools read with the person's own Google account (or, for an admin, the app's service account)
  if (name.startsWith("sheet_") || name.startsWith("drive_")) return googleAccess.withAccess(user, () => fn(user, args));
  return fn(user, args);
}

export = { DEFS: [...DEFS, ...sheetTools.DEFS, ...driveTools.DEFS, ...knowledge.DEFS], runTool, resolvePerson };
