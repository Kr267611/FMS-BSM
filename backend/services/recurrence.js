// When a checklist falls due. Pure: days are "YYYY-MM-DD" (IST) keys, cal = normalizeCalendar(...).
//   daily                      every day
//   weekly   { days }          on these weekdays (0 = Sunday)
//   monthly  { dates, every }  on these dates (31 = last day of the month), every `every` months from the start month
//   interval { every }         every `every` days from the start day
// onHoliday: a due day that is a week-off or holiday is skipped, or moves to the next / previous working day.
const { addDaysKey } = require("./dates");
const { isOff, nextWorkingDay, prevWorkingDay } = require("./calendar");

const MAX_DAYS = 1100;
const SHIFT_PAD = 14; // a moved day can come from just outside the range

const weekday = (day) => new Date(day + "T00:00:00Z").getUTCDay();
const monthIndex = (day) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
function lastDate(day) {
  const d = new Date(day.slice(0, 8) + "01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.getUTCDate();
}

// Does the schedule name this day, before week-offs and holidays are applied?
// s = { frequency: { type, days, dates, every }, start, end }
function isScheduled(s, day) {
  if (day < s.start || (s.end && day > s.end)) return false;
  const f = s.frequency;
  switch (f.type) {
    case "daily":
      return true;
    case "weekly":
      return (f.days || []).includes(weekday(day));
    case "monthly": {
      const every = f.every || 1;
      if ((monthIndex(day) - monthIndex(s.start)) % every !== 0) return false;
      const date = Number(day.slice(8, 10));
      const last = lastDate(day);
      return (f.dates || []).some((d) => Math.min(d, last) === date);
    }
    case "interval":
      return daysBetween(s.start, day) % (f.every || 1) === 0;
    default:
      return false;
  }
}

// Due days from `from` to `to` (inclusive), with the holiday rule applied, sorted and without repeats
function dueDays(s, from, to, cal) {
  const rule = s.onHoliday || "skip";
  const pad = rule === "skip" ? 0 : SHIFT_PAD;
  const out = new Set();
  let d = addDaysKey(from, -pad);
  const last = addDaysKey(to, pad);
  for (let i = 0; d <= last && i < MAX_DAYS; i++, d = addDaysKey(d, 1)) {
    if (!isScheduled(s, d)) continue;
    let due = d;
    if (isOff(d, cal)) {
      if (rule === "skip") continue;
      due = rule === "previous" ? prevWorkingDay(d, cal) : nextWorkingDay(d, cal);
    }
    if (due >= from && due <= to) out.add(due);
  }
  return [...out].sort();
}

// The next `count` due days from `from` (for the preview in the form)
function nextDueDays(s, from, count, cal) {
  const out = [];
  let start = from < s.start ? s.start : from;
  for (let i = 0; out.length < count && i < 20; i++) {
    const end = addDaysKey(start, 59);
    for (const d of dueDays(s, start, end, cal)) if (out.length < count && !out.includes(d)) out.push(d);
    if (s.end && end >= s.end) break;
    start = addDaysKey(end, 1);
  }
  return out;
}

module.exports = { isScheduled, dueDays, nextDueDays, weekday, lastDate };
