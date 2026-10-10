const express = require("express");
const SheetLink = require("../models/SheetLink");
const Task = require("../models/Task");
const User = require("../models/User");
const { auth, permit } = require("../middleware/auth");
const { syncLink, syncAll, extractSpreadsheetId, isColumn, serviceAccountEmail, getSheets, friendlyError } = require("../services/sheetSync");
const { inspectSheet } = require("../services/sheetInspect");

const router = express.Router();
router.use(auth, permit("settings", "edit"));

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

router.get("/", async (req, res) => {
  const links = await SheetLink.find().populate("doer", "name").sort({ name: 1 }).lean();
  res.json({ serviceAccountEmail: serviceAccountEmail(), links });
});

router.post("/", async (req, res) => {
  try {
    const link = await SheetLink.create(await cleanBody(req.body));
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
    Object.assign(link, await cleanBody(req.body));
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
    res.json(await inspectSheet(getSheets(), spreadsheetId, { tabName: req.body.tabName, gid }));
  } catch (err) {
    res.status(400).json({ message: friendlyError(err, { tabName: req.body.tabName }) });
  }
});

router.post("/sync-all", async (req, res) => {
  res.json(await syncAll());
});

router.post("/:id/sync", async (req, res) => {
  res.json(await syncLink(req.params.id));
});

module.exports = router;
