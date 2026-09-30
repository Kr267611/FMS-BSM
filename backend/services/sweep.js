// Time-driven work: FMS escalations that are due, checklist tasks for the coming days, auto-close.
// Runs from the scheduler, from cron and before task lists / entries / MIS are shown,
// so a server that was asleep (free hosting) catches up on the first request.
const { sweepDue } = require("./workflow");
const { sweepChecklists } = require("./checklists");

async function sweepAll(now = new Date()) {
  const escalated = await sweepDue(now);
  const { created, expired } = await sweepChecklists(now);
  return { escalated, checklistTasks: created, autoClosed: expired };
}

let last = 0;
let running = null;
// At most once a minute per server; waits for a sweep already running
function sweepSoon() {
  if (running) return running;
  if (Date.now() - last < 60 * 1000) return Promise.resolve(null);
  last = Date.now();
  running = sweepAll()
    .catch((err) => (console.error("Sweep:", err.message), null))
    .finally(() => (running = null));
  return running;
}

module.exports = { sweepAll, sweepSoon };
