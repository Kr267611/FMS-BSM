// A1 notation helpers. Pure functions (covered by tests).

// 0 -> "A", 25 -> "Z", 26 -> "AA"
function colLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// "A" -> 0, "AA" -> 26
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// "AI12" -> { col: "AI", row: 12 }; anything else -> null
function parseCell(ref: string): { col: string; row: number } | null {
  const m = String(ref || "").trim().toUpperCase().match(/^([A-Z]{1,3})([1-9]\d{0,6})$/);
  return m ? { col: m[1], row: Number(m[2]) } : null;
}

// A plain range inside one tab: "A1:Z50", "AH8:AL", "B:B", "C5"
function isRange(range: string): boolean {
  return /^[A-Z]{1,3}[1-9]?\d{0,6}(:[A-Z]{1,3}[1-9]?\d{0,6})?$/i.test(String(range || "").trim());
}

// First row of a range, so returned rows can be numbered like the sheet: "AH8:AL" -> 8, "B:B" -> 1
function rangeStart(range: string): { col: number; row: number } {
  const m = String(range).trim().toUpperCase().match(/^([A-Z]{1,3})(\d*)/);
  return { col: colIndex(m[1]), row: m[2] ? Number(m[2]) : 1 };
}

function quoteTab(tab: string): string {
  return `'${String(tab).replace(/'/g, "''")}'`;
}

// Accepts the sheet URL or the bare id
function extractSpreadsheetId(input: string): string | null {
  const text = String(input || "").trim();
  const m = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return null;
}

// Google Sheets date serial (days since 30 Dec 1899) of today in India
function todaySerial(now = new Date()): number {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return Math.round((day - Date.UTC(1899, 11, 30)) / 86400000);
}

export = { colLetter, colIndex, parseCell, isRange, rangeStart, quoteTab, extractSpreadsheetId, todaySerial };
