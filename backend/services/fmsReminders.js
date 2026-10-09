// FMS Reminder / Override Notification: emails for pending FMS steps, sent from the sweep.
// Each task remembers what it was sent (Task.reminders), so a reminder goes out once, or every
// repeatHours up to maxTimes – never on every sweep.
const FmsReminder = require("../models/FmsReminder");
const Process = require("../models/Process");
const Task = require("../models/Task");
const { cleanCondition } = require("./fms/definition");
const { evaluate } = require("./fms/conditions");
const { mailer, fromAddress } = require("./mailer");

const HOUR = 60 * 60 * 1000;
const DEFAULT_SUBJECT = "FMS: {task} – {status}";
const DEFAULT_MESSAGE = "Hello {doer},\n\n{fms} entry #{entry} ({details}) is waiting for you at \"{step}\".\nPlanned: {planned}. {status}.\n\nOpen your tasks: {link}\n\n– FMS BSM";
const VARS = ["doer", "task", "fms", "step", "entry", "details", "planned", "status", "delay", "link"];

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const int = (v, min, max, dflt) => {
  if (v === "" || v === null || v === undefined) return dflt;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

async function cleanReminder(body = {}) {
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) throw fail("Give the reminder a name");
  const p = await Process.findById(body.process).lean();
  if (!p) throw fail("Choose the FMS");
  const step = String(body.step || "");
  if (step && !p.steps.some((s) => s.key === step)) throw fail("Choose a step of this FMS");
  const timing = ["before", "due", "overdue"].includes(body.timing) ? body.timing : "due";
  const when = cleanCondition(body.when, { where: "this reminder", fieldKeys: new Set(p.fields.map((f) => f.key)), steps: new Map() });
  return {
    name,
    active: body.active !== false,
    process: p._id,
    step,
    timing,
    hours: timing === "due" ? 0 : int(body.hours, 0, 24 * 30, timing === "before" ? 2 : 24),
    repeatHours: timing === "overdue" ? int(body.repeatHours, 1, 24 * 30, null) : null,
    maxTimes: timing === "overdue" ? int(body.maxTimes, 1, 30, 1) : 1,
    ccPc: Boolean(body.ccPc),
    ccTeamLeader: Boolean(body.ccTeamLeader),
    when,
    subject: String(body.subject || "").trim().slice(0, 200),
    message: String(body.message || "").trim().slice(0, 3000),
  };
}

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? "") : m));

function varsFor(t, fms, now) {
  const late = t.planned < now ? Math.floor((now - t.planned) / (24 * HOUR)) : 0;
  const fields = (fms.fields || []).filter((f) => !["photo", "longtext", "link"].includes(f.type)).slice(0, 3);
  const details = fields.map((f) => t.job?.data?.[f.key]).filter((v) => v !== undefined && v !== "").join(", ");
  return {
    doer: t.doer?.name || "",
    task: t.label,
    fms: fms.name,
    step: t.stepName,
    entry: t.job?.jobNo || "",
    details,
    planned: fmt.format(t.planned),
    status: t.planned > now ? "Due soon" : late ? `Overdue by ${late} day(s)` : "Due now",
    delay: late,
    link: (process.env.APP_URL || "").replace(/\/+$/, "") + "/",
  };
}

// The tasks a rule may send to now
function windowFilter(rule, now) {
  const h = (rule.hours || 0) * HOUR;
  if (rule.timing === "before") return { planned: { $gt: now, $lte: new Date(now.getTime() + h) } };
  if (rule.timing === "overdue") return { planned: { $lte: new Date(now.getTime() - h) } };
  return { planned: { $lte: now } };
}

async function defaultSend(mail) {
  const t = mailer();
  if (!t) throw new Error("email (SMTP) is not set up");
  await t.sendMail({ from: fromAddress(), ...mail });
}

// Sends what is due. send(mail) can be replaced (tests); returns how many emails went out.
async function sweepReminders(now = new Date(), { send = defaultSend } = {}) {
  const rules = await FmsReminder.find({ active: true }).lean();
  if (!rules.length) return 0;
  // overrides (with a condition) first, so they can stand in for the plain rule of the same step and timing
  rules.sort((a, b) => (b.when ? 1 : 0) - (a.when ? 1 : 0));
  const processes = new Map((await Process.find({ _id: { $in: rules.map((r) => r.process) } }).populate("pc", "email").lean()).map((p) => [String(p._id), p]));
  const covered = new Set(); // task|step|timing handled by an override in this sweep
  let sent = 0;

  for (const rule of rules) {
    const fms = processes.get(String(rule.process));
    if (!fms) continue;
    const tasks = await Task.find({ kind: "app", status: "pending", process: rule.process, ...(rule.step ? { stepKey: rule.step } : {}), ...windowFilter(rule, now) })
      .limit(500)
      .populate("job", "jobNo data")
      .populate({ path: "doer", select: "name email teamLeader", populate: { path: "teamLeader", select: "email" } })
      .lean();
    for (const t of tasks) {
      const slot = `${t._id}|${t.stepKey}|${rule.timing}`;
      if (!rule.when && covered.has(slot)) continue;
      if (rule.when && !evaluate(rule.when, { data: t.job?.data || {}, steps: {} }, true)) continue;
      if (rule.when) covered.add(slot);
      const rec = (t.reminders || []).find((r) => String(r.rule) === String(rule._id));
      if (rec && (rec.n >= (rule.maxTimes || 1) || !rule.repeatHours || now - new Date(rec.last) < rule.repeatHours * HOUR)) continue;

      const vars = varsFor(t, fms, now);
      const cc = [rule.ccPc && fms.pc?.email, rule.ccTeamLeader && t.doer?.teamLeader?.email].filter(Boolean);
      let ok = true;
      let note = "";
      if (!t.doer?.email) {
        ok = false;
        note = "doer has no email";
      } else {
        try {
          await send({ to: t.doer.email, cc: cc.length ? cc.join(", ") : undefined, subject: fill(rule.subject || DEFAULT_SUBJECT, vars), text: fill(rule.message || DEFAULT_MESSAGE, vars) });
          sent++;
        } catch (err) {
          ok = false;
          note = err.message;
        }
      }
      const entry = { rule: rule._id, n: (rec?.n || 0) + 1, last: now, ok, note };
      await Task.updateOne({ _id: t._id }, rec ? { $set: { "reminders.$[r]": entry } } : { $push: { reminders: entry } }, rec ? { arrayFilters: [{ "r.rule": rule._id }] } : {});
    }
  }
  return sent;
}

// How many reminders each rule has sent (for the list)
async function stats() {
  const rows = await Task.aggregate([{ $match: { "reminders.0": { $exists: true } } }, { $unwind: "$reminders" }, { $group: { _id: "$reminders.rule", tasks: { $sum: 1 }, sent: { $sum: { $cond: ["$reminders.ok", "$reminders.n", 0] } }, failed: { $sum: { $cond: ["$reminders.ok", 0, 1] } }, last: { $max: "$reminders.last" } } }]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

module.exports = { cleanReminder, sweepReminders, stats, fill, VARS, DEFAULT_SUBJECT, DEFAULT_MESSAGE };
