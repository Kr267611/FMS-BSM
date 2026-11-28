import express = require("express");
import SheetLink = require("../models/SheetLink");
import Task = require("../models/Task");
import User = require("../models/User");
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;
import sheetSyncLib = require("../services/sheetSync");
const { syncLink, syncAll, extractSpreadsheetId, isColumn, serviceAccountEmail, getSheets, friendlyError, linksOverlap, columnValues } = sheetSyncLib;
import sheetInspectLib = require("../services/sheetInspect");
const { inspectSheet } = sheetInspectLib;
import sheetFmsLib = require("../services/sheetFms");
const { previewSheetFms, importSheetFms, suggestDoer } = sheetFmsLib;
import auditLib = require("../services/audit");
const { audit } = auditLib;

const router = express.Router();
// Sheet Links need Settings (edit); making an FMS from a sheet tab needs Import FMS from Sheet
const FROM_SHEET = new Set<string>(["/fms-preview", "/fms-import"]);
const sheetLinks = permit("sheetLinks", "edit");
const fmsImport = permit("fmsImport", "add");
router.use(auth, (req, res, next) => (FROM_SHEET.has(req.path) ? fmsImport : sheetLinks)(req, res, next));

async function cleanBody(body) {
  const b = body || {};
  if (!b.name || !String(b.name).trim()) throw new Error("Enter a name (shown as the row name in the MIS)");
  const spreadsheetId = extractSpreadsheetId(b.sheetUrl || b.spreadsheetId);
  if (!spreadsheetId) throw new Error("Invalid Google Sheet URL. Paste the plain link.");
  if (!b.tabName || !String(b.tabName).trim()) throw new Error("Enter the tab name");
  const firstDataRow = Number(b.firstDataRow);
  if (!(firstDataRow >= 1)) throw new Error("Enter the first data row (header row + 1)");
  if (!isColumn(b.plannedCol)) throw new Error("Enter a valid Planned column (e.g. P)");
  if (!isColumn(b.actualCol)) throw new Error("Enter a valid Actual column (e.g. Q)");
  if (b.filterCol && !isColumn(b.filterCol)) throw new Error("Enter a valid filter column (e.g. K)");
  if (!b.doer || !(await User.exists({ _id: b.doer, active: true }))) throw new Error("Choose a doer");

  const filterValues = (Array.isArray(b.filterValues) ? b.filterValues : String(b.filterValues || "").split(","))
    .map((v) => String(v).trim())
    .filter(Boolean);

  return {
    name: String(b.name).trim(),
    doer: b.doer,
    spreadsheetId,
    tabName: String(b.tabName).trim(),
    firstDataRow,
    plannedCol: String(b.plannedCol).toUpperCase(),
    actualCol: String(b.actualCol).toUpperCase(),
    filterCol: b.filterCol ? String(b.filterCol).toUpperCase() : "",
    filterValues: b.filterCol ? filterValues : [],
    active: b.active === undefined ? true : Boolean(b.active),
  };
}

// The same sheet rows must not be counted twice (two links of one step whose filters let the same rows through)
async function checkClash(data, exceptId = null) {
  const others = await SheetLink.find({ spreadsheetId: data.spreadsheetId, tabName: data.tabName, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean<any>();
  const clash = others.find((o) => linksOverlap(o, data));
  if (clash) throw new Error(`"${data.name}" counts the same rows as the link "${clash.name}" – give each a filter with different values, or edit that link`);
}

router.get("/", async (req, res) => {
  const links = await SheetLink.find().populate("doer", "name").sort({ name: 1 }).lean<any>();
  res.json({ serviceAccountEmail: serviceAccountEmail(), links });
});

router.post("/", async (req, res) => {
  try {
    const data = await cleanBody(req.body);
    await checkClash(data);
    const link = await SheetLink.create(data);
    const result = await syncLink(link);
    res.status(201).json({ link, result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const link = await SheetLink.findById(req.params.id);
    if (!link) return res.status(404).json({ message: "Sheet link not found" });
    const data = await cleanBody(req.body);
    await checkClash(data, link._id);
    Object.assign(link, data);
    await link.save();
    // Drop the old tasks and resync, in case the doer or name changed
    await Task.deleteMany({ sheetLink: link._id });
    const result = link.active ? await syncLink(link) : { ok: true, count: 0 };
    res.json({ link, result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  const link = await SheetLink.findByIdAndDelete(req.params.id);
  if (!link) return res.status(404).json({ message: "Sheet link not found" });
  await Task.deleteMany({ sheetLink: link._id });
  res.json({ message: "Sheet link removed" });
});

// Paste a URL -> its tabs and the steps found in the chosen tab (read-only)
router.post("/inspect", async (req, res) => {
  const spreadsheetId = extractSpreadsheetId(req.body?.sheetUrl);
  if (!spreadsheetId) return res.status(400).json({ message: "Invalid Google Sheet URL. Paste the plain link." });
  const gid = String(req.body.sheetUrl).match(/[#&?]gid=(\d+)/)?.[1];
  try {
    const out = await inspectSheet(getSheets(), spreadsheetId, { tabName: req.body.tabName, gid });
    // each step's doer, read from the sheet's Who row / step name (the form fills it in; it can be changed)
    if (out.steps?.length) {
      const users = await User.find({ active: true }).select("name username department").populate("department", "name").lean<any>();
      out.steps = out.steps.map((s) => ({ ...s, ...suggestDoer(s, users) }));
    }
    res.json(out);
  } catch (err) {
    res.status(400).json({ message: friendlyError(err, { tabName: req.body.tabName }) });
  }
});

// Several steps of one sheet tab at once (one link per step, or per doer of a step split by a filter).
// Every row is checked first; nothing is saved when one is wrong. Then each new link is synced.
const MAX_BULK = 60;
router.post("/bulk", async (req, res) => {
  try {
    const shared = { sheetUrl: req.body?.sheetUrl, tabName: req.body?.tabName, firstDataRow: req.body?.firstDataRow };
    const rows = Array.isArray(req.body?.links) ? req.body.links : [];
    if (!rows.length) throw new Error("Tick at least one step");
    if (rows.length > MAX_BULK) throw new Error(`At most ${MAX_BULK} links at a time`);
    const all = [];
    for (const [i, r] of rows.entries()) {
      let data;
      try {
        data = await cleanBody({ ...r, ...shared });
        await checkClash(data);
      } catch (err) {
        throw new Error(`Row ${i + 1} (${r?.name || "no name"}): ${err.message}`);
      }
      const twin = all.find((d) => d.name.toLowerCase() === data.name.toLowerCase());
      if (twin) throw new Error(`Two rows are named "${data.name}" – each MIS row needs its own name`);
      const same = all.find((d) => linksOverlap(d, data));
      if (same) throw new Error(`"${data.name}" and "${same.name}" count the same rows – give each a filter with different values`);
      all.push(data);
    }
    const created = await SheetLink.insertMany(all);
    const results = [];
    for (const link of created) results.push({ _id: link._id, name: link.name, ...(await syncLink(link)) });
    audit(req, "sheetLink.bulk", { entity: "SheetLink", summary: `${created.length} sheet links for the tab "${shared.tabName}"` });
    res.status(201).json({ results });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// The values written in one column of the tab (to pick filter values from). Read-only.
router.post("/column-values", async (req, res) => {
  const spreadsheetId = extractSpreadsheetId(req.body?.sheetUrl);
  const col = String(req.body?.col || "").toUpperCase();
  const firstDataRow = Number(req.body?.firstDataRow);
  if (!spreadsheetId) return res.status(400).json({ message: "Invalid Google Sheet URL. Paste the plain link." });
  if (!req.body.tabName || !isColumn(col) || !(firstDataRow >= 1)) return res.status(400).json({ message: "Choose the tab, the column and the first data row" });
  try {
    res.json({ values: await columnValues(spreadsheetId, String(req.body.tabName), col, firstDataRow) });
  } catch (err) {
    res.status(400).json({ message: friendlyError(err, { tabName: req.body.tabName }) });
  }
});

// A whole Google Sheet FMS -> an FMS in the software: preview, then create it and bring in the rows
async function sheetFmsArgs(req): Promise<[any, string, string]> {
  const spreadsheetId = extractSpreadsheetId(req.body?.sheetUrl);
  if (!spreadsheetId) throw Object.assign(new Error("Invalid Google Sheet URL. Paste the plain link."), { status: 400 });
  if (!req.body.tabName) throw Object.assign(new Error("Choose the tab"), { status: 400 });
  return [getSheets(), spreadsheetId, String(req.body.tabName)];
}
const sheetError = (res, err, req) => res.status(err.status || 400).json({ message: err.status ? err.message : friendlyError(err, { tabName: req.body?.tabName }) });

router.post("/fms-preview", async (req, res) => {
  try {
    const args = await sheetFmsArgs(req);
    const links = await SheetLink.find({ spreadsheetId: args[1], tabName: args[2] }).select("name").lean<any>();
    res.json({ ...(await previewSheetFms(...args)), sheetLinks: links });
  } catch (err) {
    sheetError(res, err, req);
  }
});

router.post("/fms-import", async (req, res) => {
  try {
    const args = await sheetFmsArgs(req);
    const out = await importSheetFms(...args, req.body, req.user);
    audit(req, "fms.import", { entity: "Process", entityId: out.process._id, summary: `${out.process.name}: ${out.counts.entries} entries from the sheet tab "${args[2]}"` });
    res.status(201).json(out);
  } catch (err) {
    sheetError(res, err, req);
  }
});

router.post("/sync-all", async (req, res) => {
  res.json(await syncAll());
});

router.post("/:id/sync", async (req, res) => {
  res.json(await syncLink(req.params.id));
});

export = router;
