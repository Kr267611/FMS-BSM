const express = require("express");
const { auth } = require("../middleware/auth");
const { misReport, dailyReport } = require("../services/scoring");
const { todayKey } = require("../services/dates");
const { visibleUserIds } = require("../services/scope");
const { sweepSoon } = require("../services/workflow");

const router = express.Router();

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// Admin / auditor: everyone. HOD / PC: their departments. Doer: only themselves.
async function params(req) {
  await sweepSoon(); // escalations that are due count in the score
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

module.exports = router;
