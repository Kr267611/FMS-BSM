const express = require("express");
const { syncAll } = require("../services/sheetSync");
const { sendDailyReminders } = require("../services/reminders");

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
  res.json(await syncAll());
});

router.get("/reminders", async (req, res) => {
  res.json(await sendDailyReminders());
});

module.exports = router;
