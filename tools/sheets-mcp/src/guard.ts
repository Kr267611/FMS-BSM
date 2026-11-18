// The write rules. Pure functions (covered by tests): a cell can be written only when
//  1. a write rule allows that spreadsheet, tab, column and row,
//  2. the cell is empty now and has no formula (we never overwrite the sheet's data or its formulas),
//  3. the new value is plain data – nothing that Sheets would turn into a formula.
import a1 = require("./a1");
import type { Config, WriteRule } from "./types";

function findRule(config: Config, spreadsheetId: string, tab: string, cell: string): WriteRule | null {
  const ref = a1.parseCell(cell);
  if (!ref) return null;
  return (
    config.write.find(
      (r) =>
        r.spreadsheetId === spreadsheetId &&
        r.tab === tab &&
        r.columns.includes(ref.col) &&
        ref.row >= r.firstRow &&
        (r.lastRow === undefined || ref.row <= r.lastRow)
    ) || null
  );
}

// Text Sheets would treat as a formula (=, +, @, or - not followed by a number), or control characters
function unsafeValue(value: string): string | null {
  const v = String(value ?? "");
  if (!v.trim()) return "an empty value (use it only to fill a cell)";
  if (v.length > 1000) return "longer than 1000 characters";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) return "control characters";
  const t = v.trimStart();
  if (/^[=@+]/.test(t) || (/^-/.test(t) && !/^-\d+(\.\d+)?$/.test(t))) return "text that Sheets would treat as a formula";
  return null;
}

// Why this change is not allowed, or null when it is. current = what the cell holds now.
function checkChange(config: Config, spreadsheetId: string, tab: string, cell: string, value: string, current: { value: any; formula: any }): string | null {
  const ref = a1.parseCell(cell);
  if (!ref) return `"${cell}" is not a single cell like AI12`;
  if (!findRule(config, spreadsheetId, tab, cell)) return `${cell} is not in a write rule (spreadsheet, tab, column and rows must be allowed in the config)`;
  const bad = unsafeValue(value);
  if (bad) return `${cell}: the value is ${bad}`;
  const formula = String(current?.formula ?? "");
  if (formula.startsWith("=")) return `${cell} has a formula – never overwritten`;
  if (String(current?.value ?? "").trim() !== "") return `${cell} is not empty ("${String(current.value).slice(0, 40)}") – only empty cells are filled`;
  return null;
}

export = { findRule, unsafeValue, checkChange };
