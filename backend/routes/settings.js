const express = require("express");
const Setting = require("../models/Setting");
const { auth, permit } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { DEFAULT_CALENDAR, isTime } = require("../services/calendar");

const router = express.Router();
router.use(auth);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function readCalendar() {
  const s = await Setting.findOne({ key: "calendar" }).lean();
  return { ...DEFAULT_CALENDAR, ...(s?.value || {}) };
}

// Company working calendar: week-offs, working hours and holidays (used for every FMS TAT)
router.get("/calendar", async (req, res) => {
  res.json(await readCalendar());
});

router.put("/calendar", permit("settings", "edit"), async (req, res) => {
  const b = req.body || {};
  const weekOff = [...new Set((Array.isArray(b.weekOff) ? b.weekOff : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (weekOff.length >= 7) return res.status(400).json({ message: "At least one day of the week must be a working day" });
  if (!isTime(b.start) || !isTime(b.end) || b.end <= b.start) {
    return res.status(400).json({ message: "Enter working hours like 09:00 to 18:00" });
  }
  const seen = new Set();
  const holidays = (Array.isArray(b.holidays) ? b.holidays : [])
    .map((h) => ({ day: String(h?.day || "").trim(), name: String(h?.name || "").trim().slice(0, 80) }))
    .filter((h) => DAY_RE.test(h.day) && !isNaN(Date.parse(h.day)) && !seen.has(h.day) && seen.add(h.day))
    .sort((a, b2) => a.day.localeCompare(b2.day))
    .slice(0, 500);
  const value = { weekOff: weekOff.sort(), start: b.start, end: b.end, holidays };
  await Setting.updateOne({ key: "calendar" }, { $set: { value } }, { upsert: true });
  audit(req, "settings.calendar", { entity: "Setting", summary: `Week-off ${weekOff.join(",") || "none"}, ${b.start}–${b.end}, ${holidays.length} holidays` });
  res.json(value);
});

module.exports = router;
