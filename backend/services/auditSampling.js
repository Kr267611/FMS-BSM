// MIDAP "Auditor Settings": per auditor, what share of the finished checklist / delegation / FMS tasks goes to
// their Audit List, and how many days they have to audit it (Audit TAT). An auditor without settings audits
// every task, as before. Which tasks are picked depends only on the task id, so it cannot be gamed by redoing one.
const crypto = require("crypto");
const Setting = require("../models/Setting");
const { addDaysKey, dayKey } = require("./dates");

const KEY = "auditorSettings";
const KINDS = { checklist: "checklist", delegation: "delegation", app: "fms" };
const pct = (v) => (v === "" || v === null || v === undefined ? null : Math.min(100, Math.max(0, Math.round(Number(v)))));

async function getAuditorSettings() {
  const s = await Setting.findOne({ key: KEY }).lean();
  return s?.value || {};
}

// body: { [auditorId]: { checklist, delegation, fms, tat } } – blank % = 100, blank TAT = no due date
function cleanAuditorSettings(body = {}) {
  const out = {};
  for (const [id, v] of Object.entries(body || {})) {
    if (!/^[a-f0-9]{24}$/i.test(id) || !v || typeof v !== "object") continue;
    const row = { checklist: pct(v.checklist), delegation: pct(v.delegation), fms: pct(v.fms) };
    const tat = v.tat === "" || v.tat === null || v.tat === undefined ? null : Math.round(Number(v.tat));
    if (tat !== null && !(tat >= 0 && tat <= 60)) throw Object.assign(new Error("Audit TAT must be 0 to 60 days"), { status: 400 });
    row.tat = tat;
    if (Object.values(row).some((x) => x !== null)) out[id] = row;
  }
  return out;
}

async function saveAuditorSettings(body) {
  const value = cleanAuditorSettings(body);
  await Setting.updateOne({ key: KEY }, { $set: { value } }, { upsert: true });
  return value;
}

// A fixed number 0-99 for a task: the same task always gets the same number
function bucketOf(taskId) {
  return crypto.createHash("md5").update(String(taskId)).digest().readUInt32BE(0) % 100;
}

// The audit to start when a task with an auditor is finished, or null when this task is not in the sample.
// settings: from getAuditorSettings() (pass it in when finishing many tasks at once)
function auditFor(task, auditorId, settings, now = new Date()) {
  if (!auditorId) return null;
  const s = settings?.[String(auditorId)] || {};
  const share = s[KINDS[task.kind]] ?? 100;
  if (bucketOf(task._id) >= share) return null;
  const audit = { status: "pending", rating: null, remarks: "" };
  if (typeof s.tat === "number") audit.dueDay = addDaysKey(dayKey(now), s.tat);
  return audit;
}

module.exports = { getAuditorSettings, saveAuditorSettings, cleanAuditorSettings, auditFor, bucketOf };
