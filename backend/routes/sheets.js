const express = require("express");
const SheetLink = require("../models/SheetLink");
const Task = require("../models/Task");
const User = require("../models/User");
const { auth, adminOnly } = require("../middleware/auth");
const { syncLink, syncAll, extractSpreadsheetId, isColumn, serviceAccountEmail } = require("../services/sheetSync");

const router = express.Router();
router.use(auth, adminOnly);

async function cleanBody(body) {
  const b = body || {};
  if (!b.name || !String(b.name).trim()) throw new Error("Naam daalein (Task Count me yahi dikhega)");
  const spreadsheetId = extractSpreadsheetId(b.sheetUrl || b.spreadsheetId);
  if (!spreadsheetId) throw new Error("Google Sheet ka URL sahi nahi hai - plain link paste karein");
  if (!b.tabName || !String(b.tabName).trim()) throw new Error("Tab ka naam daalein");
  const firstDataRow = Number(b.firstDataRow);
  if (!(firstDataRow >= 1)) throw new Error("Pehli data row ka number daalein (header row + 1)");
  if (!isColumn(b.plannedCol)) throw new Error("Planned column sahi daalein (jaise P)");
  if (!isColumn(b.actualCol)) throw new Error("Actual column sahi daalein (jaise Q)");
  if (b.filterCol && !isColumn(b.filterCol)) throw new Error("Filter column sahi daalein (jaise K)");
  if (!b.doer || !(await User.exists({ _id: b.doer, active: true }))) throw new Error("Doer chunein");

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
    if (!link) return res.status(404).json({ message: "Sheet link nahi mila" });
    Object.assign(link, await cleanBody(req.body));
    await link.save();
    // doer ya naam badla ho to purane tasks hata kar dobara sync
    await Task.deleteMany({ sheetLink: link._id });
    const result = link.active ? await syncLink(link) : { ok: true, count: 0 };
    res.json({ link, result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  const link = await SheetLink.findByIdAndDelete(req.params.id);
  if (!link) return res.status(404).json({ message: "Sheet link nahi mila" });
  await Task.deleteMany({ sheetLink: link._id });
  res.json({ message: "Sheet link hata diya" });
});

router.post("/sync-all", async (req, res) => {
  res.json(await syncAll());
});

router.post("/:id/sync", async (req, res) => {
  res.json(await syncLink(req.params.id));
});

module.exports = router;
