import express = require("express");
import { auth, permit } from "../middleware/auth";
import { pendingByDoer, messageFor, sendEmailReminders } from "../services/reminders";

const router = express.Router();
router.use(auth, permit("settings", "view"));

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
