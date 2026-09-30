// Working calendar (IST): week-offs, company holidays and working hours.
// A step's TAT runs in one of three modes:
//   "working"       – working time: days keep the time of day on working days, hours count only working hours
//   "calendar_skip" – calendar days that skip week-offs and holidays (the v1 "skip Sundays" behaviour)
//   "calendar"      – plain calendar time, 24 x 7 (what a formula like =A8+2 does in the sheets)
const { addDaysKey } = require("./dates");

const IST_OFFSET_MS = 330 * 60 * 1000;
const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const UNIT_MS = { minutes: MIN_MS, hours: 60 * MIN_MS, days: DAY_MS };
const MODES = ["working", "calendar_skip", "calendar"];
const MAX_DAYS = 800; // safety bound for loops over days

const DEFAULT_CALENDAR = { weekOff: [0], start: "09:00", end: "18:00", holidays: [] };

const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

// Date -> { day: "YYYY-MM-DD", min: minutes after IST midnight (may be fractional) }
function toIst(date) {
  const ms = new Date(date).getTime() + IST_OFFSET_MS;
  const midnight = Math.floor(ms / DAY_MS) * DAY_MS;
  return { day: new Date(midnight).toISOString().slice(0, 10), min: (ms - midnight) / MIN_MS };
}

function fromIst(day, min) {
  return new Date(Date.parse(day + "T00:00:00Z") + min * MIN_MS - IST_OFFSET_MS);
}

// IST midnight at the start of a day key
const startOfDay = (day) => fromIst(day, 0);

const weekday = (day) => new Date(day + "T00:00:00Z").getUTCDay();

// Settings value -> the shape the functions below use
function normalizeCalendar(c = {}) {
  let weekOff = Array.isArray(c.weekOff) ? c.weekOff.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [0];
  if (new Set(weekOff).size >= 7) weekOff = []; // every day off makes no sense – treat as no week-off
  const start = isTime(c.start) ? c.start : DEFAULT_CALENDAR.start;
  const end = isTime(c.end) && toMin(c.end) > toMin(start) ? c.end : DEFAULT_CALENDAR.end;
  const holidays = new Set(
    (c.holidays || []).map((h) => (typeof h === "string" ? h : h?.day)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)))
  );
  return { weekOff: new Set(weekOff), startMin: toMin(start), endMin: toMin(end), holidays };
}

const isOff = (day, cal) => cal.weekOff.has(weekday(day)) || cal.holidays.has(day);

function nextWorkingDay(day, cal) {
  let d = day;
  for (let i = 0; i < MAX_DAYS; i++) {
    d = addDaysKey(d, 1);
    if (!isOff(d, cal)) return d;
  }
  return d;
}

function prevWorkingDay(day, cal) {
  let d = day;
  for (let i = 0; i < MAX_DAYS; i++) {
    d = addDaysKey(d, -1);
    if (!isOff(d, cal)) return d;
  }
  return d;
}

// Working time, in minutes. The clock only runs between start and end on working days.
function addWorkingMinutes(base, minutes, cal) {
  if (!minutes) return new Date(base);
  let { day, min } = toIst(base);
  if (minutes > 0) {
    if (isOff(day, cal) || min >= cal.endMin) {
      day = nextWorkingDay(day, cal);
      min = cal.startMin;
    } else if (min < cal.startMin) min = cal.startMin;
    let left = minutes;
    for (let i = 0; i < MAX_DAYS && left > 1e-9; i++) {
      const avail = cal.endMin - min;
      if (left <= avail) {
        min += left;
        left = 0;
      } else {
        left -= avail;
        day = nextWorkingDay(day, cal);
        min = cal.startMin;
      }
    }
    return fromIst(day, min);
  }
  if (isOff(day, cal) || min <= cal.startMin) {
    day = prevWorkingDay(day, cal);
    min = cal.endMin;
  } else if (min > cal.endMin) min = cal.endMin;
  let left = -minutes;
  for (let i = 0; i < MAX_DAYS && left > 1e-9; i++) {
    const avail = min - cal.startMin;
    if (left <= avail) {
      min -= left;
      left = 0;
    } else {
      left -= avail;
      day = prevWorkingDay(day, cal);
      min = cal.endMin;
    }
  }
  return fromIst(day, min);
}

// Working days: the same time of day, N working days later.
// A time before or after working hours counts as the start or end of that day,
// and an off day counts as the end of the previous working day –
// so an entry at 8:30 PM on Thursday with TAT 1 day is due Friday, and one made on Sunday is due Monday.
function addWorkingDays(base, days, cal) {
  let { day, min } = toIst(base);
  if (isOff(day, cal)) {
    day = prevWorkingDay(day, cal);
    min = cal.endMin;
  } else min = Math.min(Math.max(min, cal.startMin), cal.endMin);

  const whole = Math.trunc(days);
  const move = whole >= 0 ? nextWorkingDay : prevWorkingDay;
  for (let i = 0; i < Math.abs(whole); i++) day = move(day, cal);
  const result = fromIst(day, min);
  const frac = days - whole;
  return frac ? addWorkingMinutes(result, frac * (cal.endMin - cal.startMin), cal) : result;
}

// Calendar days that do not count week-offs / holidays; a result on an off day moves past it.
function addCalendarSkip(base, amount, unit, cal) {
  const dir = amount < 0 ? -1 : 1;
  const offAt = (d) => isOff(toIst(d).day, cal);
  let result;
  if (unit !== "days") {
    result = new Date(new Date(base).getTime() + amount * UNIT_MS[unit]);
  } else {
    result = new Date(base);
    let whole = Math.floor(Math.abs(amount));
    for (let i = 0; i < MAX_DAYS * 2 && whole > 0; i++) {
      result = new Date(result.getTime() + dir * DAY_MS);
      if (!offAt(result)) whole -= 1;
    }
    const frac = Math.abs(amount) - Math.floor(Math.abs(amount));
    if (frac) result = new Date(result.getTime() + dir * frac * DAY_MS);
  }
  for (let i = 0; i < MAX_DAYS && offAt(result); i++) result = new Date(result.getTime() + dir * DAY_MS);
  return result;
}

// Planned = base + TAT in the chosen mode. cal = normalizeCalendar(...)
function addTatCal(base, tat, unit = "days", cal = normalizeCalendar(), mode = "working") {
  const amount = Number(tat) || 0;
  const u = UNIT_MS[unit] ? unit : "days";
  if (mode === "calendar") return new Date(new Date(base).getTime() + amount * UNIT_MS[u]);
  if (mode === "calendar_skip") return addCalendarSkip(base, amount, u, cal);
  if (u === "days") return addWorkingDays(base, amount, cal);
  return addWorkingMinutes(base, amount * (u === "hours" ? 60 : 1), cal);
}

module.exports = {
  MODES,
  DEFAULT_CALENDAR,
  normalizeCalendar,
  addTatCal,
  addWorkingDays,
  addWorkingMinutes,
  isOff,
  nextWorkingDay,
  prevWorkingDay,
  toMin,
  toIst,
  fromIst,
  startOfDay,
  isTime,
};
