import express = require("express");
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;
import remindersLib = require("../services/reminders");
const { pendingByDoer, messageFor, sendEmailReminders } = remindersLib;

const router = express.Router();
router.use(auth, permit("reminders", "view"));

// Each doer's pending tasks plus the WhatsApp / email message text
router.get("/", async (req, res) => {
  const entries = await pendingByDoer();
  res.json(
    entries.map((e) => ({
      doer: e.doer,
      overdue: e.overdue,
      dueToday: e.dueToday,
      count: e.tasks.length,
      message: messageFor(e),
    }))
  );
});

router.post("/send-email", async (req, res) => {
  res.json(await sendEmailReminders());
});

export = router;
