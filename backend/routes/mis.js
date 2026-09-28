const express = require("express");
const { auth } = require("../middleware/auth");
const { misReport, dailyReport } = require("../services/scoring");
const { todayKey } = require("../services/dates");

const router = express.Router();

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

function params(req) {
  const today = todayKey();
  const from = isDay(req.query.from) ? req.query.from : today.slice(0, 8) + "01";
  const to = isDay(req.query.to) ? req.query.to : today;
  // Doers can only see their own MIS
  const doerId = req.user.role === "admin" ? req.query.doer || null : req.user._id;
  return { from, to, doerId };
}

// Task Count + MIS Summary
router.get("/", auth, async (req, res) => {
  res.json(await misReport(params(req)));
});

// Performance-daily
router.get("/daily", auth, async (req, res) => {
  const p = params(req);
  if (!p.doerId) return res.status(400).json({ message: "Choose a doer" });
  res.json(await dailyReport({ ...p, label: req.query.label || null }));
});

module.exports = router;
