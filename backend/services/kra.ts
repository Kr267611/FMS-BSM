// KRA / KPI: policies (KRAs with weights, KPIs with targets) and the monthly scorecard worked out from the tasks.
// The KPIs here count from what the software already holds, with the MIS's own rules (scoring.ts): a task counts on
// its planned day, Not Required / skipped do not count, a pending task counts once its due time has passed.
import mongoose = require("mongoose");
import Task = require("../models/Task");
import User = require("../models/User");
import Process = require("../models/Process");
import KraPolicy = require("../models/KraPolicy");
import OrgLib = require("../models/Org");
const { Department } = OrgLib;
import scoringLib = require("./scoring");
const { baseMatch, effectiveRange, score } = scoringLib;
import datesLib = require("./dates");
const { dayKey, todayKey } = datesLib;
import permissionsLib = require("./permissions");
const { ROLES } = permissionsLib;

// What a KPI can measure. better: which way is good; noTarget: scored on its own scale (MIS score: 100 + score)
const METRICS = {
  donePct: { label: "Work done %", unit: "%", better: "higher" },
  onTimePct: { label: "Done on time %", unit: "%", better: "higher" },
  misScore: { label: "MIS score", unit: "", better: "higher", noTarget: true },
  pendingCount: { label: "Pending tasks", unit: "tasks", better: "lower" },
  avgDelay: { label: "Average delay of late and pending tasks", unit: "days", better: "lower" },
  auditOkPct: { label: "Audit OK %", unit: "%", better: "higher" },
};
// Which tasks a KPI counts: all, or one kind; "fms" may name one FMS (process)
const KINDS = { all: "All work", checklist: "Checklists", delegation: "Delegations", fms: "FMS steps", ticket: "Help tickets" };
const MAX_ACHIEVEMENT = 120;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const text = (v, n = 120) => String(v ?? "").trim().slice(0, n);
const num = (v) => (v === "" || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v));
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ""));
const slug = (s) => text(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "k";

// ---- months (IST) ----
const monthOf = (date = new Date()) => dayKey(date).slice(0, 7);
function addMonths(m, n) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthRange(m) {
  const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}

// ---- a version, checked ----
// body: { appliesTo: { departments, roles, users }, kras: [{ name, weight, kpis: [{ name, metric, kind, process, target, weight }] }] }
async function cleanVersion(body: any = {}) {
  const a = body.appliesTo || {};
  const ids = (list) => [...new Set<string>((Array.isArray(list) ? list : []).map(String).filter((x) => mongoose.isValidObjectId(x)))];
  const departments = ids(a.departments);
  const users = ids(a.users);
  const roles = [...new Set<string>((Array.isArray(a.roles) ? a.roles : []).map(String).filter((r) => ROLES[r]))];
  if (departments.length && (await Department.countDocuments({ _id: { $in: departments } })) !== departments.length) throw fail("A department of this policy was not found");
  if (users.length && (await User.countDocuments({ _id: { $in: users } })) !== users.length) throw fail("A person of this policy was not found");
  if (!departments.length && !roles.length && !users.length) throw fail("Choose who this policy is for: departments, roles or people");

  const kras = Array.isArray(body.kras) ? body.kras : [];
  if (!kras.length) throw fail("Add at least one KRA");
  if (kras.length > 8) throw fail("Keep it to 8 KRAs or fewer");
  const processIds = new Set<string>((await Process.find().select("_id").lean<any>()).map((p) => String(p._id)));
  const keys = new Set<string>();
  const out = kras.map((k, i) => {
    const name = text(k?.name);
    const where = `KRA ${i + 1}${name ? ` "${name}"` : ""}`;
    if (!name) throw fail(`Name ${where}`);
    const weight = num(k.weight);
    if (weight === null || weight <= 0) throw fail(`Give ${where} a weight above 0`);
    let key = slug(k.key || name);
    for (let n = 2; keys.has(key); n++) key = `${slug(k.key || name)}_${n}`;
    keys.add(key);
    const kpis = Array.isArray(k.kpis) ? k.kpis : [];
    if (!kpis.length) throw fail(`Add at least one KPI to ${where}`);
    if (kpis.length > 10) throw fail(`Keep ${where} to 10 KPIs or fewer`);
    const kpiKeys = new Set<string>();
    const cleanKpis = kpis.map((p, j) => {
      const m = METRICS[p?.metric];
      const pw = `KPI ${j + 1} of ${where}`;
      if (!m) throw fail(`Choose what ${pw} measures`);
      const kind = KINDS[p.kind] ? p.kind : "all";
      const process = kind === "fms" && p.process ? String(p.process) : "";
      if (process && !processIds.has(process)) throw fail(`The FMS of ${pw} was not found`);
      if (p.metric === "auditOkPct" && kind !== "all" && kind !== "fms" && kind !== "checklist" && kind !== "delegation") throw fail(`${pw}: audits are of checklists, delegations and FMS steps`);
      const target = num(p.target);
      if (!m.noTarget && target === null) throw fail(`Give ${pw} a target`);
      if (!m.noTarget && m.unit === "%" && (target <= 0 || target > 100)) throw fail(`${pw}: a % target is between 1 and 100`);
      if (!m.noTarget && m.better === "lower" && target < 0) throw fail(`${pw}: the target cannot be below 0`);
      let pk = slug(p.key || p.name || p.metric);
      for (let n = 2; kpiKeys.has(pk); n++) pk = `${slug(p.key || p.name || p.metric)}_${n}`;
      kpiKeys.add(pk);
      return { key: pk, name: text(p.name) || m.label, metric: p.metric, kind, process, target: m.noTarget ? null : target, weight: num(p.weight) };
    });
    const weighted = cleanKpis.filter((p) => p.weight !== null);
    if (weighted.length && weighted.length !== cleanKpis.length) throw fail(`${where}: give every KPI a weight, or none (then they count equally)`);
    if (weighted.length && Math.abs(weighted.reduce((s, p) => s + p.weight, 0) - 100) > 0.01) throw fail(`${where}: the KPI weights must add up to 100`);
    return { key, name, weight, kpis: cleanKpis };
  });
  const total = out.reduce((s, k) => s + k.weight, 0);
  if (Math.abs(total - 100) > 0.01) throw fail(`The KRA weights add up to ${Math.round(total * 100) / 100}; they must add up to 100`);
  return { appliesTo: { departments, roles, users }, kras: out };
}

// The version of a policy that counts for a month (none before its first)
const versionFor = (policy, month) => [...(policy.versions || [])].reverse().find((v) => v.from <= month) || null;

// The policy of a person for a month: named people first, then their department, then their role; the newest wins a tie
function policyFor(user, month, policies) {
  let best = null;
  for (const p of policies) {
    if (!p.active) continue;
    const v = versionFor(p, month);
    if (!v) continue;
    const a = v.appliesTo || {};
    const rank = (a.users || []).includes(String(user._id)) ? 3 : user.department && (a.departments || []).includes(String(user.department?._id || user.department)) ? 2 : (a.roles || []).includes(user.role) ? 1 : 0;
    if (rank && (!best || rank > best.rank || (rank === best.rank && new Date(v.at) > new Date(best.version.at)))) best = { rank, policy: p, version: v };
  }
  return best;
}

// ---- the numbers of one month, per person and per kind of task ----
const bucketsOf = (t) => {
  const kind = t.kind === "app" || t.kind === "sheet" ? "fms" : t.kind;
  const out = ["all", kind];
  if (t.kind === "app" && t.process) out.push(`fms:${t.process}`);
  return out;
};
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

async function monthStats(userIds, month, now = new Date()) {
  const { from, to } = monthRange(month);
  const range = effectiveRange(from, to);
  const stats = new Map<string, Map<string, any>>(); // user -> bucket -> counts
  const row = (u, b) => {
    if (!stats.has(u)) stats.set(u, new Map());
    const m = stats.get(u);
    if (!m.has(b)) m.set(b, { planned: 0, onTime: 0, late: 0, pending: 0, delaySum: 0, delayN: 0, audited: 0, auditOk: 0 });
    return m.get(b);
  };
  if (range.from <= range.to) {
    const tasks = await Task.find(baseMatch(range.from, range.to, null, userIds, now)).select("doer kind process plannedDay actualDay status").lean<any>();
    const today = todayKey();
    for (const t of tasks) {
      const late = t.actualDay && t.actualDay > t.plannedDay;
      const pending = !t.actualDay;
      for (const b of bucketsOf(t)) {
        const r = row(String(t.doer), b);
        r.planned++;
        if (pending) r.pending++;
        else if (late) r.late++;
        else r.onTime++;
        if (late || pending) {
          r.delaySum += Math.max(0, dayDiff(pending ? (today < range.to ? today : range.to) : t.actualDay, t.plannedDay));
          r.delayN++;
        }
      }
    }
  }
  // audits finished in the month, of this person's tasks
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${addMonths(month, 1)}-01T00:00:00+05:30`);
  const audits = await Task.find({ ...(userIds ? { doer: { $in: userIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } : {}), "audit.status": { $in: ["ok", "notok"] }, "audit.at": { $gte: start, $lt: end } })
    .select("doer kind process audit.status")
    .lean<any>();
  for (const t of audits) {
    for (const b of bucketsOf(t)) {
      const r = row(String(t.doer), b);
      r.audited++;
      if (t.audit.status === "ok") r.auditOk++;
    }
  }
  return stats;
}

const round1 = (n) => Math.round(n * 10) / 10;
// A KPI's value from the counts (null = nothing to count this month)
function valueOf(metric, r) {
  if (!r) return null;
  if (metric === "auditOkPct") return r.audited ? round1((100 * r.auditOk) / r.audited) : null;
  if (!r.planned) return null;
  if (metric === "donePct") return round1((100 * (r.onTime + r.late)) / r.planned);
  if (metric === "onTimePct") return round1((100 * r.onTime) / r.planned);
  if (metric === "misScore") return score(r);
  if (metric === "pendingCount") return r.pending;
  if (metric === "avgDelay") return r.delayN ? round1(r.delaySum / r.delayN) : 0;
  return null;
}

// How far a value reaches its target, 0–120 %
function achievement(metric, actual, target) {
  if (actual === null || actual === undefined) return null;
  const m = METRICS[metric];
  let a;
  if (m.noTarget) a = 100 + actual; // MIS score: 0 → 100 %, −20 → 80 %
  else if (m.better === "higher") a = target > 0 ? (100 * actual) / target : 100;
  else a = target === 0 ? (actual === 0 ? 100 : 0) : actual === 0 ? MAX_ACHIEVEMENT : (100 * target) / actual;
  return round1(Math.max(0, Math.min(MAX_ACHIEVEMENT, a)));
}

// Weighted average of the parts that have a value; their weights are shared out again (null when none has)
function weighted(parts) {
  const have = parts.filter((p) => p.achievement !== null);
  const w = have.reduce((s, p) => s + p.weight, 0);
  return have.length && w ? round1(have.reduce((s, p) => s + p.achievement * p.weight, 0) / w) : null;
}

// One person's scorecard from a policy version and their counts
function scoreCard(version, counts) {
  const kras = version.kras.map((k) => {
    const equal = 100 / k.kpis.length;
    const kpis = k.kpis.map((p) => {
      const r = counts?.get(p.kind === "fms" && p.process ? `fms:${p.process}` : p.kind);
      const actual = valueOf(p.metric, r);
      return { ...p, weight: p.weight ?? equal, unit: METRICS[p.metric].unit, better: METRICS[p.metric].better, actual, achievement: achievement(p.metric, actual, p.target), counted: r ? { planned: r.planned, onTime: r.onTime, late: r.late, pending: r.pending, audited: r.audited } : null };
    });
    return { key: k.key, name: k.name, weight: k.weight, kpis, achievement: weighted(kpis) };
  });
  return { kras, overall: weighted(kras) };
}

// The scorecards of a month for these people (null = everyone active)
async function scorecards(userIds, month, now = new Date()) {
  if (!isMonth(month)) throw fail("Choose a month");
  const filter: Record<string, any> = { active: true };
  if (userIds) filter._id = { $in: userIds };
  const users = await User.find(filter).select("name role department").populate("department", "name").lean<any>();
  const policies = await KraPolicy.find({ active: true }).lean<any>();
  const withPolicy = users.map((u) => ({ u, p: policyFor(u, month, policies) })).filter((x) => x.p);
  const stats = await monthStats(withPolicy.map((x) => String(x.u._id)), month, now);
  const names = new Map<string, string>((await Process.find().select("name").lean<any>()).map((p) => [String(p._id), p.name]));
  return withPolicy.map(({ u, p }) => {
    const card = scoreCard(p.version, stats.get(String(u._id)));
    for (const k of card.kras) for (const kpi of k.kpis) if (kpi.process) kpi.processName = names.get(kpi.process) || "(deleted FMS)";
    return {
      user: { _id: u._id, name: u.name, role: u.role, department: u.department?.name || "" },
      policy: { _id: p.policy._id, name: p.policy.name, versionFrom: p.version.from, by: p.rank === 3 ? "person" : p.rank === 2 ? "department" : "role" },
      month,
      ...card,
    };
  });
}

export = { METRICS, KINDS, MAX_ACHIEVEMENT, cleanVersion, versionFor, policyFor, monthOf, addMonths, monthRange, monthStats, valueOf, achievement, weighted, scoreCard, scorecards, isMonth };
