const Setting = require("../models/Setting");
const { syncAll } = require("./sheetSync");
const { sendEmailReminders } = require("./reminders");
const { todayKey, TZ } = require("./dates");

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

// Roz REMINDER_TIME (IST) ke baad ek baar email bhejta hai
async function maybeSendReminders() {
  const at = process.env.REMINDER_TIME || "09:00";
  if (timeFmt.format(new Date()) < at) return;
  const today = todayKey();
  const last = await Setting.findOne({ key: "lastReminderDay" }).lean();
  if (last?.value === today) return;
  await Setting.updateOne({ key: "lastReminderDay" }, { value: today }, { upsert: true });
  const r = await sendEmailReminders();
  console.log("Daily reminder:", JSON.stringify(r));
}

function startScheduler() {
  const minutes = Number(process.env.SHEET_SYNC_MINUTES) || 30;
  setTimeout(runSync, 10 * 1000);
  setInterval(runSync, minutes * 60 * 1000);
  setInterval(() => maybeSendReminders().catch((e) => console.error("Reminder error:", e.message)), 60 * 1000);
}

module.exports = { startScheduler, runSync };
