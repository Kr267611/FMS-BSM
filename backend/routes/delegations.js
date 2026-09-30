const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const { auth, permit } = require("../middleware/auth");
const { can } = require("../services/permissions");
const { visibleUserIds, canSeeUser } = require("../services/scope");
const { audit } = require("../services/audit");
const { todayKey } = require("../services/dates");
const d = require("../services/delegations");

const router = express.Router();
router.use(auth);

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const people = (q) => q.populate("doer", "name").populate("assignedBy", "name").populate("pc", "name").populate("auditor", "name");

// ?view=mine|byme|all &status=pending|overdue|done|all &q= &doer=
router.get("/", async (req, res) => {
  const me = String(req.user._id);
  const seeAll = can(req.user, "delegation", "view");
  const view = ["mine", "byme", "all"].includes(req.query.view) ? req.query.view : seeAll ? "all" : "mine";
  const filter = { kind: "delegation" };
  if (view === "mine") filter.doer = me;
  else if (view === "byme") filter.assignedBy = me;
  else {
    if (!seeAll) throw fail("You don't have permission to do this. Ask your admin.", 403);
    const visible = await visibleUserIds(req.user);
    if (visible !== null) filter.$or = [{ doer: { $in: visible } }, { assignedBy: me }];
  }
  if (req.query.doer && mongoose.isValidObjectId(req.query.doer)) {
    if (!(await canSeeUser(req.user, req.query.doer)) && view !== "byme") throw fail("You can only see tasks of people in your department", 403);
    filter.doer = req.query.doer;
  }
  const status = req.query.status || "pending";
  if (status === "pending") filter.status = "pending";
  else if (status === "overdue") Object.assign(filter, { status: "pending", planned: { $lt: new Date() } });
  else if (status === "done") filter.status = "done";
  const q = String(req.query.q || "").trim();
  if (q) filter.label = new RegExp(esc(q), "i");

  const sort = status === "done" || status === "all" ? { resolvedAt: -1, planned: -1 } : { planned: 1 };
  const list = await people(Task.find(filter).select("-log -values").sort(sort).limit(500)).lean();
  res.json({ today: todayKey(), view, tasks: list });
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const t = await people(Task.findById(req.params.id)).populate("log.by", "name").populate("revisions.by", "name").populate("revisions.decidedBy", "name").lean();
  if (!t || t.kind !== "delegation") throw fail("Delegation not found", 404);
  const me = String(req.user._id);
  const mine = String(t.doer?._id) === me || String(t.assignedBy?._id) === me;
  if (!mine && !(can(req.user, "delegation", "view") && (await canSeeUser(req.user, t.doer?._id)))) throw fail("You can only see tasks of people in your department", 403);
  res.json({ ...t, maxRevisions: d.MAX_REVISIONS, canManage: await d.canManage({ ...t, assignedBy: t.assignedBy?._id, doer: t.doer?._id }, req.user) });
});

router.post("/", permit("delegation", "add"), async (req, res) => {
  const t = await d.createDelegation(req.user, req.body);
  audit(req, "delegation.create", { entity: "Task", entityId: t._id, summary: t.label });
  res.status(201).json(t);
});

router.put("/:id", async (req, res) => {
  const { task, notes } = await d.updateDelegation(req.params.id, req.user, req.body);
  audit(req, "delegation.update", { entity: "Task", entityId: task._id, summary: `${task.label}${notes.length ? ": " + notes.join("; ") : ""}` });
  res.json(task);
});

router.delete("/:id", async (req, res) => {
  const t = await d.deleteDelegation(req.params.id, req.user);
  audit(req, "delegation.delete", { entity: "Task", entityId: t._id, summary: t.label });
  res.json({ ok: true });
});

// The doer asks for a new deadline: { planned | date + time, reason }
router.post("/:id/revision", async (req, res) => {
  const t = await d.requestRevision(req.params.id, req.user, req.body);
  audit(req, "delegation.revision_request", { entity: "Task", entityId: t._id, summary: t.label });
  res.json(t);
});

router.post("/:id/revision/:decision", async (req, res) => {
  if (!["approve", "reject"].includes(req.params.decision)) throw fail("Choose approve or reject");
  const approve = req.params.decision === "approve";
  const t = await d.decideRevision(req.params.id, req.user, approve, req.body);
  audit(req, approve ? "delegation.revision_approve" : "delegation.revision_reject", { entity: "Task", entityId: t._id, summary: t.label });
  res.json(t);
});

router.post("/:id/reopen", async (req, res) => {
  const t = await d.reopenDelegation(req.params.id, req.user, req.body);
  audit(req, "delegation.reopen", { entity: "Task", entityId: t._id, summary: t.label });
  res.json(t);
});

module.exports = router;
