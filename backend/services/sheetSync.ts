import fs = require("fs");
import path = require("path");
import SheetLink = require("../models/SheetLink");
import Task = require("../models/Task");
import datesLib = require("./dates");
const { dayKey, parseSheetDate } = datesLib;

// Accepts the sheet URL or the bare ID
function extractSpreadsheetId(input) {
  const text = String(input || "").trim();
  const m = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return null;
}

function isColumn(col) {
  return /^[A-Z]{1,3}$/.test(String(col || "").toUpperCase());
}

function serviceAccountCredentials() {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (file) {
    const full = path.isAbsolute(file) ? file : path.join(__dirname, "..", "..", file);
    return JSON.parse(fs.readFileSync(full, "utf8"));
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return null;
}

function serviceAccountEmail() {
  try {
    return serviceAccountCredentials()?.client_email || null;
  } catch {
    return null;
  }
}

let sheetsClient = null;
function getSheets() {
  if (sheetsClient) return sheetsClient;
  const credentials = serviceAccountCredentials();
  if (!credentials) {
    throw new Error(
      "Google service account is not configured. Set GOOGLE_SERVICE_ACCOUNT_FILE in backend/.env (see README)."
    );
  }
  const { google } = require("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials,
    // Read-only scope - the software cannot edit a sheet
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// Writing client – used only by Sheet Sync of an imported FMS, for the steps and columns an admin switched on,
// and only works on a sheet shared with the service account as Editor. Sheet Links never use it.
let writerClient = null;
function getSheetsWriter() {
  if (writerClient) return writerClient;
  const credentials = serviceAccountCredentials();
  if (!credentials) throw new Error("Google service account is not configured. Set GOOGLE_SERVICE_ACCOUNT_FILE in backend/.env (see README).");
  const { google } = require("googleapis");
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  writerClient = google.sheets({ version: "v4", auth });
  return writerClient;
}

function quoteTab(tab) {
  return `'${String(tab).replace(/'/g, "''")}'`;
}

// Sheet column values -> task rows. Pure function (covered by tests).
// columns = { planned: [[v],[v]...], actual: [...], filter: [...] }
function buildRows(link, columns) {
  const filterSet = new Set(
    (link.filterValues || []).map((v) => String(v).trim().toUpperCase()).filter(Boolean)
  );
  const planned = columns.planned || [];
  const rows = [];

  for (let i = 0; i < planned.length; i++) {
    const plannedDate = parseSheetDate(planned[i]?.[0]);
    if (!plannedDate) continue; // Blank or "No Req" Planned -> skip (like P!="")

    if (link.filterCol && filterSet.size) {
      const fv = String(columns.filter?.[i]?.[0] ?? "").trim().toUpperCase();
      if (!filterSet.has(fv)) continue;
    }

    const actualDate = parseSheetDate(columns.actual?.[i]?.[0]);
    rows.push({
      sheetRow: link.firstDataRow + i,
      planned: plannedDate,
      plannedDay: dayKey(plannedDate),
      actual: actualDate || undefined,
      actualDay: actualDate ? dayKey(actualDate) : undefined,
      status: actualDate ? "done" : "pending",
    });
  }
  return rows;
}

// Two links that would count the same sheet rows twice: the same tab and step (Planned + Actual columns), and rows
// both filters let through (no filter = every row; the same filter column with a value in common).
// A different filter column can't be checked without reading the sheet, so it is not called a clash. Pure (tested).
const filterKeys = (l) => new Set<string>((l.filterCol ? l.filterValues || [] : []).map((v) => String(v).trim().toUpperCase()).filter(Boolean));
function linksOverlap(a, b) {
  if (a.spreadsheetId !== b.spreadsheetId || a.tabName !== b.tabName) return false;
  if (String(a.plannedCol).toUpperCase() !== String(b.plannedCol).toUpperCase()) return false;
  if (String(a.actualCol).toUpperCase() !== String(b.actualCol).toUpperCase()) return false;
  const fa = filterKeys(a);
  const fb = filterKeys(b);
  if (!fa.size || !fb.size) return true;
  if (String(a.filterCol).toUpperCase() !== String(b.filterCol).toUpperCase()) return false;
  return [...fa].some((v) => fb.has(v));
}

// The distinct values of one column (for picking filter values), most used first. Read-only.
async function columnValues(spreadsheetId, tabName, col, firstDataRow) {
  const res = await getSheets().spreadsheets.values.get({ spreadsheetId, range: `${quoteTab(tabName)}!${col}${firstDataRow}:${col}`, valueRenderOption: "UNFORMATTED_VALUE" });
  const count = new Map<string, { value: string; count: number }>();
  for (const r of res.data.values || []) {
    const value = String(r?.[0] ?? "").trim();
    if (!value) continue;
    const k = value.toUpperCase(); // the sync matches without caring about capitals, so these are one value
    count.set(k, { value: count.get(k)?.value || value, count: (count.get(k)?.count || 0) + 1 });
  }
  return [...count.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 100);
}

async function fetchColumns(link) {
  const sheets = getSheets();
  const tab = quoteTab(link.tabName);
  const r = link.firstDataRow;
  const ranges = [
    `${tab}!${link.plannedCol}${r}:${link.plannedCol}`,
    `${tab}!${link.actualCol}${r}:${link.actualCol}`,
  ];
  if (link.filterCol) ranges.push(`${tab}!${link.filterCol}${r}:${link.filterCol}`);

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: link.spreadsheetId,
    ranges,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  const [planned, actual, filter] = res.data.valueRanges.map((v) => v.values || []);
  return { planned, actual, filter };
}

function friendlyError(err, link) {
  const msg = err?.errors?.[0]?.message || err?.message || String(err);
  if (/Unable to parse range/i.test(msg)) return `Tab "${link?.tabName}" not found - check the tab name (spelling, spaces, capitals)`;
  if (err?.code === 403 || /permission/i.test(msg)) {
    return `No permission to read the sheet - share it as Viewer with ${serviceAccountEmail() || "the service account"}`;
  }
  if (err?.code === 404) return "Sheet not found - check the URL";
  return msg;
}

async function syncLink(linkOrId) {
  const link = linkOrId instanceof SheetLink ? linkOrId : await SheetLink.findById(linkOrId);
  if (!link) throw new Error("Sheet link not found");

  try {
    const columns = await fetchColumns(link);
    const rows = buildRows(link, columns);

    await Task.deleteMany({ sheetLink: link._id });
    if (rows.length) {
      await Task.insertMany(
        rows.map((r) => ({ ...r, kind: "sheet", label: link.name, doer: link.doer, sheetLink: link._id }))
      );
    }
    link.lastSyncAt = new Date();
    link.lastCount = rows.length;
    link.lastError = "";
    await link.save();
    return { ok: true, count: rows.length };
  } catch (err) {
    link.lastSyncAt = new Date();
    link.lastError = friendlyError(err, link);
    await link.save();
    return { ok: false, error: link.lastError };
  }
}

async function syncAll() {
  const links = await SheetLink.find({ active: true });
  const results = [];
  for (const link of links) results.push({ name: link.name, ...(await syncLink(link)) });
  return results;
}

export = { syncLink, syncAll, buildRows, linksOverlap, columnValues, extractSpreadsheetId, isColumn, serviceAccountEmail, serviceAccountCredentials, getSheets, getSheetsWriter, friendlyError };
