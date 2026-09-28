// Saari "din" wali calculation IST (Asia/Kolkata) me hoti hai.
// Din ko "YYYY-MM-DD" string me rakhte hain - Feeder ke clean date column jaisa.

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

// "2026-09-28" + n din
function addDaysKey(key, n) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// IST weekday (0 = Sunday)
function istWeekday(date) {
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCDay();
}

// Planned = base + TAT. unit "days" ya "hours".
// skipSundays = true ho to din gin-te waqt Sunday chhod dete hain,
// aur agar result Sunday par gira to Monday par khisak jata hai.
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

// Google Sheets ka serial number (1899-12-30 se din) -> Date.
// Sheet ka time IST wall-clock hota hai, isliye 5:30 ghante minus karte hain.
function sheetSerialToDate(serial) {
  const wallClockUtc = Date.UTC(1899, 11, 30) + serial * DAY_MS;
  return new Date(wallClockUtc - IST_OFFSET_MS);
}

// Sheet cell ki value -> Date ya null.
// "No Req" / "Not Required" jaisa text null ban jata hai (clean-pair ka ISNUMBER jaisa).
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
