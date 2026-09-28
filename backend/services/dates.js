// All day-level calculations use IST (Asia/Kolkata).
// A day is stored as a "YYYY-MM-DD" string, like the clean date columns in the Feeder sheet.

const TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Date -> "2026-09-28" (IST)
function dayKey(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return null;
  return dayFmt.format(d);
}

function todayKey() {
  return dayKey(new Date());
}

// "2026-09-28" + n days
function addDaysKey(key, n) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// IST weekday (0 = Sunday)
function istWeekday(date) {
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCDay();
}

// Planned = base + TAT, in "days" or "hours".
// With skipSundays, Sundays are not counted as days, and a result that
// lands on a Sunday moves to Monday.
function addTat(base, tat, unit = "days", skipSundays = false) {
  const start = new Date(base);
  const amount = Number(tat) || 0;

  if (unit === "hours") {
    let result = new Date(start.getTime() + amount * 60 * 60 * 1000);
    if (skipSundays) {
      while (istWeekday(result) === 0) result = new Date(result.getTime() + DAY_MS);
    }
    return result;
  }

  if (!skipSundays) return new Date(start.getTime() + amount * DAY_MS);

  let result = new Date(start);
  let whole = Math.floor(amount);
  while (whole > 0) {
    result = new Date(result.getTime() + DAY_MS);
    if (istWeekday(result) !== 0) whole -= 1;
  }
  const frac = amount - Math.floor(amount);
  if (frac) result = new Date(result.getTime() + frac * DAY_MS);
  while (istWeekday(result) === 0) result = new Date(result.getTime() + DAY_MS);
  return result;
}

// Google Sheets serial number (days since 1899-12-30) -> Date.
// Sheet times are IST wall-clock, so subtract 5:30.
function sheetSerialToDate(serial) {
  const wallClockUtc = Date.UTC(1899, 11, 30) + serial * DAY_MS;
  return new Date(wallClockUtc - IST_OFFSET_MS);
}

// Sheet cell value -> Date or null.
// Text such as "No Req" / "Not Required" becomes null (like the ISNUMBER clean-pair formula).
function parseSheetDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (value <= 0) return null;
    return sheetSerialToDate(value);
  }
  const text = String(value).trim();
  // dd/mm/yyyy [hh:mm[:ss]]
  const m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "0", mi = "0", ss = "0"] = m;
  const wall = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss);
  const d = new Date(wall - IST_OFFSET_MS);
  return isNaN(d) ? null : d;
}

module.exports = { dayKey, todayKey, addDaysKey, addTat, parseSheetDate, sheetSerialToDate, TZ };
