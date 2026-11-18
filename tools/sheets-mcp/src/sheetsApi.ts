// The few Google Sheets calls the tools need. Tests use a fake with the same shape.
import fs = require("fs");
import type { SheetsApi } from "./types";

function credentials() {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  throw new Error("Google service account is not set. Set GOOGLE_SERVICE_ACCOUNT_FILE (full path to the key file) in the MCP server's env.");
}

function friendly(err: any): Error {
  const msg = err?.errors?.[0]?.message || err?.message || String(err);
  if (/Unable to parse range/i.test(msg)) return new Error("Tab or range not found – check the tab name (spelling, spaces, capitals) and the range");
  if (err?.code === 403 || /permission/i.test(msg)) return new Error("No permission – share the sheet with the service account's email (Viewer to read, Editor to write)");
  if (err?.code === 404) return new Error("Sheet not found – check the URL or id");
  return new Error(msg);
}

// The reading client has the read-only scope; the writing client is made only when something is written.
function googleSheets(): SheetsApi {
  const { google } = require("googleapis");
  let reader = null;
  let writer = null;
  const client = (write: boolean) => {
    if (write ? writer : reader) return write ? writer : reader;
    const scope = write ? "https://www.googleapis.com/auth/spreadsheets" : "https://www.googleapis.com/auth/spreadsheets.readonly";
    const made = google.sheets({ version: "v4", auth: new google.auth.GoogleAuth({ credentials: credentials(), scopes: [scope] }) });
    if (write) writer = made;
    else reader = made;
    return made;
  };

  return {
    async meta(spreadsheetId) {
      try {
        const r = await client(false).spreadsheets.get({
          spreadsheetId,
          fields: "properties.title,sheets.properties(title,sheetId,hidden,gridProperties(rowCount,columnCount))",
        });
        return {
          title: r.data.properties?.title || "",
          tabs: (r.data.sheets || []).map((s) => ({
            name: s.properties.title,
            gid: s.properties.sheetId,
            hidden: Boolean(s.properties.hidden),
            rows: s.properties.gridProperties?.rowCount || 0,
            cols: s.properties.gridProperties?.columnCount || 0,
          })),
        };
      } catch (err) {
        throw friendly(err);
      }
    },
    async values(spreadsheetId, range, render) {
      try {
        const r = await client(false).spreadsheets.values.get({
          spreadsheetId,
          range,
          valueRenderOption: render,
          dateTimeRenderOption: "SERIAL_NUMBER",
        });
        return r.data.values || [];
      } catch (err) {
        throw friendly(err);
      }
    },
    async write(spreadsheetId, data) {
      try {
        // USER_ENTERED so a date or number is stored like typing it; formulas are refused before this (guard.ts)
        await client(true).spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "USER_ENTERED", data: data.map((d) => ({ range: d.range, values: [[d.value]] })) },
        });
      } catch (err) {
        throw friendly(err);
      }
    },
  };
}

export = { googleSheets };
