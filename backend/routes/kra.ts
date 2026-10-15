import express = require("express");
import mongoose = require("mongoose");
import KraPolicy = require("../models/KraPolicy");
import Process = require("../models/Process");
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;
import permissionsLib = require("../services/permissions");
const { can, ROLES } = permissionsLib;
import scopeLib = require("../services/scope");
const { visibleUserIds, canSeeUser } = scopeLib;
import auditLib = require("../services/audit");
const { audit } = auditLib;
import taskFiltersLib = require("../services/taskFilters");
const { peopleFor } = taskFiltersLib;
import kra = require("../services/kra");

// KRA / KPI: policies (KRA Policies tick) and monthly scorecards (KRA Scorecards tick; everyone sees their own)
const router = express.Router();
router.use(auth);

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const text = (v, n) => String(v ?? "").trim().slice(0, n);

// What a KPI can measure, the kinds of work, the roles and the FMS (for the policy form)
router.get("/meta", permit("kraPolicies", "view"), async (req, res) => {
  const processes = await Process.find().select("name active").sort({ name: 1 }).lean<any>();
  res.json({ metrics: kra.METRICS, kinds: kra.KINDS, roles: ROLES, processes, thisMonth: kra.monthOf(), maxAchievement: kra.MAX_ACHIEVEMENT });
});

router.get("/policies", permit("kraPolicies", "view"), async (req, res) => {
  const list = await KraPolicy.find().sort({ active: -1, name: 1 }).lean<any>();
  const month = kra.monthOf();
  res.json(list.map((p) => ({ ...p, current: kra.versionFor(p, month) || p.versions[p.versions.length - 1], upcoming: p.versions.filter((v) => v.from > month) })));
});

router.get("/policies/:id", permit("kraPolicies", "view"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid ID");
  const p = await KraPolicy.findById(req.params.id).populate("versions.by", "name").lean<any>();
  if (!p) throw fail("KRA policy not found", 404);
  res.json(p);
});

// A new policy counts from this month
router.post("/policies", permit("kraPolicies", "add"), async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 120);
  if (!name) throw fail("Name the policy");
  if (await KraPolicy.exists({ name })) throw fail("A KRA policy with this name already exists");
  const version = await kra.cleanVersion(b);
  const p = await KraPolicy.create({ name, description: text(b.description, 500), active: b.active === undefined ? true : Boolean(b.active), versions: [{ from: kra.monthOf(), ...version, by: req.user._id, at: new Date() }] });
  audit(req, "kra.policy_create", { entity: "KraPolicy", entityId: p._id, summary: `${p.name}: ${version.kras.length} KRA(s), from ${kra.monthOf()}` });
  res.status(201).json(p);
});

// A change counts from next month (effective "next", the default), so this month keeps what it was scored with;
// or from this month (effective "now"), with the reason. Name, description and on / off change at once.
router.put("/policies/:id", permit("kraPolicies", "edit"), async (req, res) => {
  const p = await KraPolicy.findById(req.params.id);
  if (!p) throw fail("KRA policy not found", 404);
  const b = req.body || {};
  const notes = [];
  if (b.name !== undefined) {
    const name = text(b.name, 120);
    if (!name) throw fail("Name the policy");
    if (name !== p.name && (await KraPolicy.exists({ name, _id: { $ne: p._id } }))) throw fail("A KRA policy with this name already exists");
    if (name !== p.name) notes.push(`renamed from ${p.name}`), (p.name = name);
  }
  if (b.description !== undefined) p.description = text(b.description, 500);
  if (b.active !== undefined && Boolean(b.active) !== p.active) (p.active = Boolean(b.active)), notes.push(p.active ? "switched on" : "switched off");
  if (b.kras !== undefined || b.appliesTo !== undefined) {
    const current: any = p.versions[p.versions.length - 1];
    const version = await kra.cleanVersion({ appliesTo: b.appliesTo ?? current?.appliesTo, kras: b.kras ?? current?.kras });
    const now = b.effective === "now";
    const reason = text(b.reason, 300);
    if (now && reason.length < 3) throw fail("Say why this month's scorecards change");
    const from = now ? kra.monthOf() : kra.addMonths(kra.monthOf(), 1);
    // a later version planned already is replaced; one of the same month is updated
    p.versions = p.versions.filter((v: any) => v.from < from) as any;
    p.versions.push({ from, ...version, by: req.user._id, at: new Date(), reason } as any);
    notes.push(`KRAs from ${from}${now ? ` (this month: ${reason})` : ""}`);
  }
  p.markModified("versions");
  await p.save();
  audit(req, "kra.policy_update", { entity: "KraPolicy", entityId: p._id, summary: `${p.name}${notes.length ? ": " + notes.join("; ") : ""}` });
  res.json(p);
});

router.delete("/policies/:id", permit("kraPolicies", "delete"), async (req, res) => {
  const p = await KraPolicy.findByIdAndDelete(req.params.id);
  if (!p) throw fail("KRA policy not found", 404);
  audit(req, "kra.policy_delete", { entity: "KraPolicy", entityId: p._id, summary: p.name });
  res.json({ ok: true });
});

// One person's scorecard: ?user= (default: me) &month=YYYY-MM (default: this month)
router.get("/scorecard", async (req, res) => {
  const user = req.query.user ? String(req.query.user) : String(req.user._id);
  if (!mongoose.isValidObjectId(user)) throw fail("Invalid person");
  if (user !== String(req.user._id) && !(can(req.user, "scorecards", "view") && (await canSeeUser(req.user, user)))) throw fail("You can see only your own scorecard", 403);
  const month = req.query.month ? String(req.query.month) : kra.monthOf();
  const [card] = await kra.scorecards([user], month);
  res.json(card || { month, none: true });
});

// The scorecards of the people one may see: ?month= &department= &branch=
router.get("/scorecards", permit("scorecards", "view"), async (req, res) => {
  const month = req.query.month ? String(req.query.month) : kra.monthOf();
  const people = await peopleFor(await visibleUserIds(req.user), req.query);
  const list = await kra.scorecards(people, month);
  list.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.user.name.localeCompare(b.user.name));
  res.json({ month, scorecards: list });
});

export = router;
