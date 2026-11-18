// Settings come from a JSON file named by SHEETS_MCP_CONFIG (see config.example.json).
// No file, or no "write" rules = the AI can only read.
import fs = require("fs");
import path = require("path");
import a1 = require("./a1");
import type { Config, WriteRule } from "./types";

const DEFAULTS = { maxCellsPerProposal: 50, proposalMinutes: 15 };

function normalizeRule(r: any, i: number): WriteRule {
  const where = `write rule ${i + 1}`;
  const spreadsheetId = a1.extractSpreadsheetId(r?.spreadsheetId || r?.spreadsheet);
  if (!spreadsheetId) throw new Error(`${where}: spreadsheetId (or the sheet URL) is missing`);
  if (!r?.tab || typeof r.tab !== "string") throw new Error(`${where}: tab is missing`);
  const columns = (Array.isArray(r.columns) ? r.columns : []).map((c) => String(c).trim().toUpperCase());
  if (!columns.length || columns.some((c) => !/^[A-Z]{1,3}$/.test(c))) throw new Error(`${where}: columns must be letters like ["AI", "AK"]`);
  const firstRow = Number(r.firstRow);
  if (!Number.isInteger(firstRow) || firstRow < 1) throw new Error(`${where}: firstRow must be the first data row (a number from 1)`);
  const lastRow = r.lastRow === undefined ? undefined : Number(r.lastRow);
  if (lastRow !== undefined && (!Number.isInteger(lastRow) || lastRow < firstRow)) throw new Error(`${where}: lastRow must be a number not before firstRow`);
  return { spreadsheetId, tab: r.tab, columns, firstRow, lastRow, note: r.note ? String(r.note) : undefined };
}

function parseConfig(raw: any, baseDir: string): Config {
  const write = (Array.isArray(raw?.write) ? raw.write : []).map(normalizeRule);
  const dataDir = path.resolve(baseDir, raw?.dataDir || ".data");
  const maxCellsPerProposal = Number(raw?.maxCellsPerProposal) > 0 ? Math.min(Number(raw.maxCellsPerProposal), 500) : DEFAULTS.maxCellsPerProposal;
  const proposalMinutes = Number(raw?.proposalMinutes) > 0 ? Math.min(Number(raw.proposalMinutes), 120) : DEFAULTS.proposalMinutes;
  return { write, dataDir, maxCellsPerProposal, proposalMinutes };
}

function loadConfig(): Config {
  const file = process.env.SHEETS_MCP_CONFIG;
  const home = path.join(__dirname, "..", "..");
  if (!file) return parseConfig({}, home);
  const full = path.resolve(file);
  return parseConfig(JSON.parse(fs.readFileSync(full, "utf8")), path.dirname(full));
}

export = { loadConfig, parseConfig };
