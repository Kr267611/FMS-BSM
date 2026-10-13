// Time-driven work: FMS escalations that are due, checklist tasks for the coming days, auto-close.
// Runs from the scheduler, from cron and before task lists / entries / MIS are shown,
// so a server that was asleep (free hosting) catches up on the first request.
import workflowLib = require("./workflow");
const { sweepDue } = workflowLib;
import checklistsLib = require("./checklists");
const { sweepChecklists } = checklistsLib;
import fmsRemindersLib = require("./fmsReminders");
const { sweepReminders } = fmsRemindersLib;

async function sweepAll(now = new Date()) {
  const escalated = await sweepDue(now);
  const { created, expired } = await sweepChecklists(now);
  const reminders = await sweepReminders(now).catch((err) => (console.error("FMS reminders:", err.message), 0));
  return { escalated, checklistTasks: created, autoClosed: expired, reminders };
}

let last = 0;
let running = null;
const MAX_WAIT_MS = 3000;
// At most once a minute per server. A list waits for it at most MAX_WAIT_MS, so a long sweep (the first one of the
// day makes every checklist's tasks) never keeps a page from opening; it finishes in the background.
function sweepSoon({ maxWait = MAX_WAIT_MS }: any = {}) {
  if (!running && Date.now() - last >= 60 * 1000) {
    last = Date.now();
    running = sweepAll()
      .catch((err) => (console.error("Sweep:", err.message), null))
      .finally(() => (running = null));
  }
  if (!running) return Promise.resolve(null);
  return Promise.race([running, new Promise((r) => setTimeout(() => r(null), maxWait).unref?.())]);
}

export = { sweepAll, sweepSoon };
