const { syncAll } = require("./sheetSync");
const { sendDailyReminders } = require("./reminders");
const { sweepAll } = require("./sweep");
const { TZ } = require("./dates");

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

let syncing = false;
async function runSync() {
  if (syncing) return;
  syncing = true;
  try {
    const results = await syncAll();
    const failed = results.filter((r) => !r.ok);
    if (results.length) console.log(`Sheet sync: ${results.length - failed.length} ok, ${failed.length} error`);
  } catch (err) {
    console.error("Sheet sync error:", err.message);
  } finally {
    syncing = false;
  }
}

// Escalation steps ("if Step 2 is not permanently solved by its planned day…") start on time,
// checklist tasks are made for the coming days and auto-close runs
async function runSweep() {
  try {
    const r = await sweepAll();
    if (r.escalated || r.checklistTasks || r.autoClosed) console.log("Sweep:", JSON.stringify(r));
  } catch (err) {
    console.error("FMS sweep error:", err.message);
  }
}

// Sends the reminder email once a day, after REMINDER_TIME (IST)
async function maybeSendReminders() {
  const at = process.env.REMINDER_TIME || "09:00";
  if (timeFmt.format(new Date()) < at) return;
  const r = await sendDailyReminders();
  if (!r.alreadySent) console.log("Daily reminder:", JSON.stringify(r));
}

function startScheduler() {
  const minutes = Number(process.env.SHEET_SYNC_MINUTES) || 30;
  setTimeout(runSweep, 5 * 1000);
  setInterval(runSweep, 5 * 60 * 1000);
  setTimeout(runSync, 10 * 1000);
  setInterval(runSync, minutes * 60 * 1000);
  setInterval(() => maybeSendReminders().catch((e) => console.error("Reminder error:", e.message)), 60 * 1000);
}

module.exports = { startScheduler, runSync, runSweep };
