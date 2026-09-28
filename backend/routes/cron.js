const express = require("express");
const { syncAll } = require("../services/sheetSync");
const { sendDailyReminders } = require("../services/reminders");
const { sweepDue } = require("../services/workflow");

// Called by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
const router = express.Router();

router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
});

router.get("/sync", async (req, res) => {
  const escalated = await sweepDue();
  res.json({ escalated, sheets: await syncAll() });
});

router.get("/reminders", async (req, res) => {
  await sweepDue(); // escalations due today are part of the reminder
  res.json(await sendDailyReminders());
});

module.exports = router;
