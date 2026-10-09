const express = require("express");
const { auth } = require("../middleware/auth");
const { misReport, dailyReport, score } = require("../services/scoring");
const { todayKey, addDaysKey } = require("../services/dates");
const { visibleUserIds } = require("../services/scope");
const { sweepSoon } = require("../services/sweep");

const router = express.Router();

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// Admin / auditor: everyone. HOD / PC: their departments. Doer: only themselves.
async function params(req) {
  await sweepSoon(); // due escalations and checklist tasks count in the score
  const today = todayKey();
  const from = isDay(req.query.from) ? req.query.from : today.slice(0, 8) + "01";
  const to = isDay(req.query.to) ? req.query.to : today;
  const visible = await visibleUserIds(req.user);
  const asked = req.query.doer ? String(req.query.doer) : null;
  if (asked && visible !== null && !visible.includes(asked)) {
    const err = new Error("You can only see the MIS of people in your department");
    err.status = 403;
    throw err;
  }
  return { from, to, doerId: asked, doerIds: visible };
}

// Task Count + MIS Summary
router.get("/", auth, async (req, res) => {
  res.json(await misReport(await params(req)));
});

// Performance-daily
router.get("/daily", auth, async (req, res) => {
  const p = await params(req);
  const doerId = p.doerId || (p.doerIds?.length === 1 ? p.doerIds[0] : null);
  if (!doerId) return res.status(400).json({ message: "Choose a doer" });
  res.json(await dailyReport({ from: p.from, to: p.to, doerId, label: req.query.label || null }));
});

// ---- Weekly MIS Score (MIDAP "EM report") ----
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

// ?week=YYYY-MM-DD (any day of the week; default this week) &group=doer|department
router.get("/weekly", auth, async (req, res) => {
  const p = await params(req);
  const week = monday(isDay(req.query.week) ? req.query.week : todayKey());
  const prevWeek = addDaysKey(week, -7);
  const [cur, prev] = await Promise.all([
    misReport({ from: week, to: addDaysKey(week, 6), doerIds: p.doerIds }),
    misReport({ from: prevWeek, to: addDaysKey(prevWeek, 6), doerIds: p.doerIds }),
  ]);
  const byDept = req.query.group === "department";
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
  res.json({ week, weekEnd: addDaysKey(week, 6), countedTo: cur.to, group: byDept ? "department" : "doer", rows: out, company: { total: finish(company.total), last: finish(company.last) } });
});

module.exports = router;
