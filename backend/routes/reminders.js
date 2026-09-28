const express = require("express");
const { auth, adminOnly } = require("../middleware/auth");
const { pendingByDoer, messageFor, sendEmailReminders } = require("../services/reminders");

const router = express.Router();
router.use(auth, adminOnly);

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

module.exports = router;
