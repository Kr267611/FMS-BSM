// Weekly MIS meeting: every doer's score this week against last week, by department, the highlights, the most
// late tasks and what is still overdue – one screen / one print for the meeting, and one email every week.
const Task = require("../models/Task");
const User = require("../models/User");
const Setting = require("../models/Setting");
const { misReport, score } = require("./scoring");
const { todayKey, dayKey, addDaysKey } = require("./dates");
const { mailer, fromAddress } = require("./mailer");

const TYPES = { checklist: "checklist", delegation: "delegation", app: "fms", sheet: "fms" };
const zero = () => ({ planned: 0, done: 0, onTime: 0, late: 0, pending: 0, autoClosed: 0 });
function add(a, r) {
  a.planned += r.planned;
  a.done += r.actual ?? r.done;
  a.onTime += r.onTime;
  a.late += r.late;
  a.pending += r.pending;
  a.autoClosed += r.autoClosed || 0;
  return a;
}
function finish(t) {
  const pct = (n) => (t.planned ? Math.round(((-100 * n) / t.planned) * 10) / 10 + 0 : 0);
  return { ...t, notDonePct: pct(t.pending), notOnTimePct: pct(t.late + t.pending), score: score(t) };
}
const monday = (day) => addDaysKey(day, -((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7));
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// MIDAP "EM report": rows per doer (or department) for one week, with last week next to it
async function weeklyReport({ week, doerIds = null, group = "doer" }) {
  week = monday(week || todayKey());
  const prevWeek = addDaysKey(week, -7);
  const [cur, prev] = await Promise.all([
    misReport({ from: week, to: addDaysKey(week, 6), doerIds }),
    misReport({ from: prevWeek, to: addDaysKey(prevWeek, 6), doerIds }),
  ]);
  const byDept = group === "department";
  const rows = new Map();
  const rowFor = (d) => {
    const key = byDept ? d.doer.department || "No department" : d.doer._id;
    if (!rows.has(key)) rows.set(key, { key, name: byDept ? key : d.doer.name, department: byDept ? "" : d.doer.department, people: 0, total: zero(), types: { checklist: zero(), delegation: zero(), fms: zero() }, last: zero() });
    return rows.get(key);
  };
  for (const d of cur.doers) {
    const r = rowFor(d);
    r.people += 1;
    add(r.total, d.total);
    for (const x of d.rows) add(r.types[TYPES[x.kind] || "fms"], x);
  }
  for (const d of prev.doers) add(rowFor(d).last, d.total);
  const company = { total: zero(), last: zero() };
  const out = [...rows.values()].map((r) => {
    add(company.total, r.total);
    add(company.last, r.last);
    return { ...r, total: finish(r.total), last: finish(r.last), types: Object.fromEntries(Object.entries(r.types).map(([k, v]) => [k, finish(v)])) };
  });
  out.sort((a, b) => (a.total.planned ? a.total.score : 1) - (b.total.planned ? b.total.score : 1));
  return { week, weekEnd: addDaysKey(week, 6), countedTo: cur.to, group: byDept ? "department" : "doer", rows: out, company: { total: finish(company.total), last: finish(company.last) } };
}

// Best / needs attention / most improved / dropped. Pure (covered by tests).
const GOOD = -30; // a score of -30 or better is good enough to be called "best"
function highlights(rows, n = 3) {
  const scored = rows.filter((r) => r.total.planned);
  const change = scored.filter((r) => r.last.planned).map((r) => ({ ...r, change: Math.round((r.total.score - r.last.score) * 100) / 100 }));
  const byScore = [...scored].sort((a, b) => b.total.score - a.total.score || b.total.planned - a.total.planned);
  const pick = (r) => ({ name: r.name, department: r.department, score: r.total.score, planned: r.total.planned, change: r.change });
  // the top half can be "best" (with a good score), the bottom half "needs attention" – nobody is in both
  const half = Math.min(n, Math.floor(byScore.length / 2) || byScore.length);
  return {
    best: byScore.slice(0, half).filter((r) => r.total.score >= GOOD).map(pick),
    attention: byScore.slice(half).slice(-n).reverse().filter((r) => r.total.score < GOOD).map(pick),
    improved: [...change].sort((a, b) => b.change - a.change).filter((r) => r.change > 0).slice(0, n).map(pick),
    dropped: [...change].sort((a, b) => a.change - b.change).filter((r) => r.change < 0).slice(0, n).map(pick),
  };
}

// The tasks of the week that were (or still are) most late, and the oldest tasks still open today
async function lateTasks({ week, weekEnd, doerIds, today = todayKey(), limit = 10 }) {
  const scope = doerIds ? { doer: { $in: doerIds } } : { doer: { $ne: null } };
  const to = weekEnd < today ? weekEnd : today;
  const [weekTasks, open] = await Promise.all([
    Task.find({
      ...scope,
      plannedDay: { $gte: week, $lte: to },
      $or: [{ status: "done", $expr: { $gt: ["$actualDay", "$plannedDay"] } }, { status: { $in: ["pending", "expired"] }, plannedDay: { $lt: today } }],
    })
      .select("label kind status plannedDay actualDay doer")
      .populate("doer", "name")
      .lean(),
    Task.find({ ...scope, status: { $in: ["pending", "expired"] }, plannedDay: { $lt: today } })
      .select("label kind status plannedDay doer")
      .populate("doer", "name")
      .sort({ plannedDay: 1 })
      .limit(limit)
      .lean(),
  ]);
  const show = (t) => ({ label: t.label, kind: t.kind, doer: t.doer?.name || "—", plannedDay: t.plannedDay, actualDay: t.actualDay || null, open: t.status !== "done", delay: days(t.plannedDay, t.actualDay || today) });
  const openTotal = await Task.countDocuments({ ...scope, status: { $in: ["pending", "expired"] }, plannedDay: { $lt: today } });
  return {
    late: weekTasks.map(show).sort((a, b) => b.delay - a.delay).slice(0, limit),
    oldestOpen: open.map(show),
    openTotal,
  };
}

async function meetingReport({ week, doerIds = null }) {
  const [byDoer, byDept] = await Promise.all([weeklyReport({ week, doerIds }), weeklyReport({ week, doerIds, group: "department" })]);
  const tasks = await lateTasks({ week: byDoer.week, weekEnd: byDoer.weekEnd, doerIds });
  return { ...byDoer, departments: byDept.rows, highlights: highlights(byDoer.rows), ...tasks };
}

// ---------- the weekly email ----------
const DEFAULTS = { enabled: false, emails: [], day: 1, time: "09:00" }; // Monday 09:00 IST (when the daily cron call comes), for the week before
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getSettings() {
  const s = await Setting.findOne({ key: "meetingReport" }).lean();
  return { ...DEFAULTS, ...(s?.value || {}) };
}

function cleanSettings(b = {}) {
  const emails = [...new Set(String(Array.isArray(b.emails) ? b.emails.join(",") : b.emails || "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = emails.find((e) => !EMAIL.test(e));
  if (bad) throw Object.assign(new Error(`"${bad}" is not an email address`), { status: 400 });
  const day = Number(b.day);
  if (!Number.isInteger(day) || day < 0 || day > 6) throw Object.assign(new Error("Choose the day"), { status: 400 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time || ""))) throw Object.assign(new Error("Enter the time like 09:30"), { status: 400 });
  return { enabled: Boolean(b.enabled) && emails.length > 0, emails: emails.slice(0, 30), day, time: b.time };
}

async function saveSettings(b) {
  const value = cleanSettings(b);
  await Setting.updateOne({ key: "meetingReport" }, { $set: { value } }, { upsert: true });
  return value;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const showDay = (k) => (k ? k.split("-").reverse().join("/") : "");
const fmt = (n) => (n > 0 ? `+${n}` : String(n));

// Plain HTML that every mail app shows the same
function renderHtml(r, { link } = {}) {
  const td = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left"';
  const th = 'style="padding:6px 8px;border-bottom:2px solid #cbd5e1;text-align:left;background:#f1f5f9"';
  const color = (s) => (s >= -10 ? "#15803d" : s >= -40 ? "#b45309" : "#dc2626");
  const table = (head, rows) => `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 18px">${`<tr>${head.map((h) => `<th ${th}>${h}</th>`).join("")}</tr>`}${rows.join("")}</table>`;
  const row = (x) =>
    `<tr><td ${td}><b>${esc(x.name)}</b>${x.department ? `<br><span style="color:#64748b">${esc(x.department)}</span>` : ""}</td><td ${td}>${x.total.planned}</td><td ${td}>${x.total.done}</td><td ${td}>${x.total.late}</td><td ${td}>${x.total.pending}</td><td ${td}><b style="color:${color(x.total.score)}">${x.total.score}</b></td><td ${td}>${x.last.planned ? x.last.score : "—"}</td></tr>`;
  const head = ["Name", "Planned", "Done", "Late", "Pending", "Score", "Last week"];
  const h = r.highlights;
  const list = (title, xs, withChange) => (xs.length ? `<p style="margin:4px 0"><b>${title}:</b> ${xs.map((x) => `${esc(x.name)} (${withChange ? fmt(x.change) : x.score})`).join(", ")}</p>` : "");
  return `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:760px">
<h2 style="margin:0 0 4px">Weekly MIS – ${showDay(r.week)} to ${showDay(r.weekEnd)}</h2>
<p style="margin:0 0 14px;color:#475569">Company score <b style="color:${color(r.company.total.score)}">${r.company.total.score}</b> (last week ${r.company.last.score}) · ${r.company.total.planned} tasks, ${r.company.total.late} late, ${r.company.total.pending} pending · ${r.openTotal} tasks still overdue today</p>
${list("Best", h.best)}${list("Needs attention", h.attention)}${list("Most improved", h.improved, true)}${list("Dropped", h.dropped, true)}
<h3 style="margin:16px 0 0">Doers</h3>${table(head, r.rows.filter((x) => x.total.planned || x.last.planned).map(row))}
<h3 style="margin:0">Departments</h3>${table(head, r.departments.filter((x) => x.total.planned).map(row))}
${r.late.length ? `<h3 style="margin:0">Most late this week</h3>${table(["Task", "Doer", "Planned", "Done", "Late by"], r.late.map((t) => `<tr><td ${td}>${esc(t.label)}</td><td ${td}>${esc(t.doer)}</td><td ${td}>${showDay(t.plannedDay)}</td><td ${td}>${t.open ? "<b>not done</b>" : showDay(t.actualDay)}</td><td ${td}>${t.delay} day(s)</td></tr>`))}` : ""}
<p style="color:#64748b;font-size:12px">Score = −(50 × Late + 100 × Pending) ÷ Planned. 0 = perfect.${link ? ` Open the full report: <a href="${esc(link)}">${esc(link)}</a>` : ""}</p>
</div>`;
}

async function sendMeetingReport({ week, to, now = new Date() } = {}) {
  const transport = mailer();
  if (!transport) throw Object.assign(new Error("Email (SMTP) is not configured on the server, so the report cannot be sent"), { status: 400 });
  const settings = await getSettings();
  const emails = to?.length ? to : settings.emails;
  if (!emails.length) throw Object.assign(new Error("Add at least one email address"), { status: 400 });
  const r = await meetingReport({ week: week || addDaysKey(monday(dayKey(now)), -7) });
  const base = process.env.APP_URL || "";
  await transport.sendMail({
    from: fromAddress(),
    to: emails.join(", "),
    subject: `Weekly MIS ${showDay(r.week)}–${showDay(r.weekEnd)}: company score ${r.company.total.score}`,
    html: renderHtml(r, { link: base ? `${base.replace(/\/$/, "")}/reports/meeting?week=${r.week}` : "" }),
  });
  return { sent: emails.length, week: r.week };
}

// Once a week on the chosen day, after the chosen time (IST), for the week before – whoever calls first
async function maybeSendMeeting(now = new Date()) {
  const s = await getSettings();
  if (!s.enabled || !mailer()) return null;
  const today = dayKey(now);
  const weekday = new Date(today + "T00:00:00Z").getUTCDay();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  if (weekday !== s.day || time < s.time) return null;
  const week = addDaysKey(monday(today), -7);
  try {
    await Setting.create({ key: `meetingSent:${week}`, value: now });
  } catch (err) {
    if (err.code === 11000) return { alreadySent: true };
    throw err;
  }
  return sendMeetingReport({ week, now });
}

module.exports = { weeklyReport, meetingReport, highlights, lateTasks, renderHtml, getSettings, saveSettings, cleanSettings, sendMeetingReport, maybeSendMeeting, monday };
