const fs = require("fs");
const path = require("path");
const SheetLink = require("../models/SheetLink");
const Task = require("../models/Task");
const { dayKey, parseSheetDate } = require("./dates");

// URL ya seedha ID - dono chalte hain (smart chip wala "Invalid URL" jhanjhat nahi)
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
    const full = path.isAbsolute(file) ? file : path.join(__dirname, "..", file);
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
      "Google Service Account set nahi hai. backend/.env me GOOGLE_SERVICE_ACCOUNT_FILE daalein (README dekhein)."
    );
  }
  const { google } = require("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials,
    // sirf padhne ki permission - software sheet edit kar hi nahi sakta
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

function quoteTab(tab) {
  return `'${String(tab).replace(/'/g, "''")}'`;
}

// Sheet ke column values -> task rows. Pure function (test me use hota hai).
// columns = { planned: [[v],[v]...], actual: [...], filter: [...] }
function buildRows(link, columns) {
  const filterSet = new Set(
    (link.filterValues || []).map((v) => String(v).trim().toUpperCase()).filter(Boolean)
  );
  const planned = columns.planned || [];
  const rows = [];

  for (let i = 0; i < planned.length; i++) {
    const plannedDate = parseSheetDate(planned[i]?.[0]);
    if (!plannedDate) continue; // Planned khaali / "No Req" -> skip (P!="" jaisa)

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

function friendlyError(err) {
  const msg = err?.errors?.[0]?.message || err?.message || String(err);
  if (/Unable to parse range/i.test(msg)) return `Tab "${msg.split(":").pop().trim()}" nahi mila - tab ka naam check karein`;
  if (err?.code === 403 || /permission/i.test(msg)) {
    return `Sheet padhne ki permission nahi hai - sheet ko ${serviceAccountEmail() || "service account"} ke saath Viewer share karein`;
  }
  if (err?.code === 404) return "Sheet nahi mili - URL check karein";
  return msg;
}

async function syncLink(linkOrId) {
  const link = linkOrId instanceof SheetLink ? linkOrId : await SheetLink.findById(linkOrId);
  if (!link) throw new Error("Sheet link nahi mila");

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
    link.lastError = friendlyError(err);
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

module.exports = { syncLink, syncAll, buildRows, extractSpreadsheetId, isColumn, serviceAccountEmail };
