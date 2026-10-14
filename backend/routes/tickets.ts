import express = require("express");
import mongoose = require("mongoose");
import TicketCategory = require("../models/TicketCategory");
import Ticket = require("../models/Ticket");
import User = require("../models/User");
import orgLib = require("../models/Org");
const { Department } = orgLib;
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;
import auditLib = require("../services/audit");
const { audit } = auditLib;
import tickets = require("../services/tickets");

// Help Ticket: raise, my tickets, the ticket list, categories, settings, report
const router = express.Router();
router.use(auth);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const text = (v, n) => String(v ?? "").trim().slice(0, n);
const config = permit("ticketSetup", "edit"); // categories and settings (Help Ticket – Setup)

// ---------- categories ----------
router.get("/categories", async (req, res) => {
  await tickets.ensureCategories();
  const q = req.query.all ? {} : { active: true };
  res.json(await TicketCategory.find(q).populate("solver", "name").populate("department", "name").sort({ name: 1 }).lean<any>());
});
async function cleanCategory(b: any = {}) {
  const name = text(b.name, 60);
  if (!name) throw fail("Enter the category name");
  if (b.solver && !(mongoose.isValidObjectId(b.solver) && (await User.exists({ _id: b.solver, active: true })))) throw fail("The solver must be an active user");
  if (b.department && !(mongoose.isValidObjectId(b.department) && (await Department.exists({ _id: b.department })))) throw fail("Department not found");
  const tat = Number(b.tatHours);
  if (!(tat > 0 && tat <= 24 * 60)) throw fail("Enter the TAT in hours (more than 0)");
  return {
    name,
    description: text(b.description, 200),
    solver: b.solver || null,
    department: b.department || null,
    tatHours: Math.round(tat * 4) / 4,
    priority: ["normal", "high", "critical"].includes(b.priority) ? b.priority : "normal",
    active: b.active !== false,
  };
}
router.post("/categories", config, async (req, res) => {
  const v = await cleanCategory(req.body);
  if (await TicketCategory.exists({ name: v.name })) throw fail("A category with this name already exists");
  const c = await TicketCategory.create(v as any);
  audit(req, "ticket.category_create", { entity: "TicketCategory", entityId: c._id, summary: `${c.name}, ${c.tatHours} h` });
  res.status(201).json(c);
});
router.put("/categories/:id", config, async (req, res) => {
  const v = await cleanCategory(req.body);
  if (await TicketCategory.exists({ name: v.name, _id: { $ne: req.params.id } })) throw fail("A category with this name already exists");
  const c = await TicketCategory.findByIdAndUpdate(req.params.id, v, { returnDocument: "after" });
  if (!c) throw fail("Category not found", 404);
  audit(req, "ticket.category_update", { entity: "TicketCategory", entityId: c._id, summary: `${c.name}, ${c.tatHours} h` });
  res.json(c);
});
router.delete("/categories/:id", config, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  if (await Ticket.exists({ category: req.params.id })) throw fail("Tickets were raised in this category. Switch it off (Active) instead.");
  const c = await TicketCategory.findByIdAndDelete(req.params.id);
  if (!c) throw fail("Category not found", 404);
  audit(req, "ticket.category_delete", { entity: "TicketCategory", entityId: c._id, summary: c.name });
  res.json({ message: "Category deleted" });
});

// ---------- settings ----------
router.get("/settings", async (req, res) => res.json(await tickets.getSettings()));
router.put("/settings", config, async (req, res) => {
  const s = await tickets.saveSettings(req.body);
  audit(req, "ticket.settings", { entity: "Setting", summary: `MIS score ${s.countInMis ? "on" : "off"}, auto-close after ${s.autoCloseDays} day(s)` });
  res.json(s);
});

// ---------- report ----------
router.get("/report", permit("ticketReport", "view"), async (req, res) => {
  const from = isDay(req.query.from) ? String(req.query.from) : "";
  const to = isDay(req.query.to) ? String(req.query.to) : "";
  res.json(await tickets.report(req.user, { from, to }));
});

// ---------- tickets ----------
// ?view=mine|assigned|all|unassigned &status= (open|working|solved|closed|cancelled|active) &category= &q= &late=1 &from= &to=
router.get("/", async (req, res) => {
  const q: any = req.query;
  res.json(await tickets.list(req.user, { view: String(q.view || "mine"), status: String(q.status || ""), category: String(q.category || ""), q: String(q.q || ""), late: String(q.late || ""), from: isDay(q.from) ? q.from : "", to: isDay(q.to) ? q.to : "" }));
});
router.post("/", permit("myTickets", "view"), async (req, res) => {
  const t = await tickets.raise(req.user, req.body);
  audit(req, "ticket.raise", { entity: "Ticket", entityId: t._id, summary: `${tickets.code(t.number)} ${t.title}` });
  res.status(201).json({ _id: t._id, code: tickets.code(t.number), solver: t.solver || null, planned: t.planned || null });
});
router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Ticket not found", 404);
  res.json(await tickets.detail(req.user, req.params.id));
});

const ACTIONS = {
  assign: (me, id, b) => tickets.assign(me, id, b.solver),
  start: (me, id, b) => tickets.startWork(me, id, b.note),
  solve: (me, id, b) => tickets.solve(me, id, { solution: b.solution, photos: b.photos }),
  confirm: (me, id, b) => tickets.confirm(me, id, { rating: b.rating, note: b.note }),
  reopen: (me, id, b) => tickets.reopen(me, id, { reason: b.reason }),
  cancel: (me, id, b) => tickets.cancel(me, id, { reason: b.reason }),
  comment: (me, id, b) => tickets.comment(me, id, b.note),
};
for (const [name, act] of Object.entries(ACTIONS)) {
  router.post(`/:id/${name}`, async (req, res) => {
    const t = await act(req.user, req.params.id, req.body || {});
    if (name !== "comment") audit(req, `ticket.${name}`, { entity: "Ticket", entityId: t._id, summary: `${tickets.code(t.number)} ${t.status}` });
    res.json(await tickets.detail(req.user, req.params.id));
  });
}

export = router;
