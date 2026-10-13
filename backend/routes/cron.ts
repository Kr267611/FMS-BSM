import express = require("express");
import sheetSyncLib = require("../services/sheetSync");
const { syncAll } = sheetSyncLib;
import remindersLib = require("../services/reminders");
const { sendDailyReminders } = remindersLib;
import sweepLib = require("../services/sweep");
const { sweepAll } = sweepLib;
import meetingLib = require("../services/meeting");
const { maybeSendMeeting } = meetingLib;

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
  const swept = await sweepAll();
  res.json({ ...swept, sheets: await syncAll() });
});

router.get("/reminders", async (req, res) => {
  await sweepAll(); // escalations and checklist tasks due today are part of the reminder
  res.json({ ...(await sendDailyReminders()), meeting: await maybeSendMeeting() });
});

export = router;
