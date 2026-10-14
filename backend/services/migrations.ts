import mongoose = require("mongoose");
import User = require("../models/User");
import Setting = require("../models/Setting");
import OrgLib = require("../models/Org");
const { Department } = OrgLib;
import permissionsLib = require("./permissions");
const { MODULE_ACTIONS, ROLE_DEFAULTS, REPORT_PAGES, FMS_LISTS, isAdmin, permissionsFor } = permissionsLib;

// Idempotent data upgrades, run on every start.
async function runMigrations() {
  await migrateDepartments();
  await migrateProcessesToV2();
  await migratePageAccess();
  await migratePageAccess2();
  await migratePageAccess3();
}

// ---- One tick per page (Oct 2026) ----
// Before: one "PC reports & MIS" tick opened all eight report pages (four of them hidden from doers in the menu),
// the Master FMS tick also opened Doer Conditions / Override TAT / Auto-calculate / Auto Complete, Import needed
// Master FMS add + Settings edit, and Bulk needed FMS entries (not for doers). Now each page has its own tick.
// Every user keeps exactly the pages they had: what the new role defaults do not give the same is written on the user.
// The old access is kept in permissionsV1.
const OLD_DEFAULTS = {
  reports: { hod: ["view", "edit"], pc: ["view", "edit"], tl: ["view", "edit"], auditor: ["view"], doer: ["view"] },
  fms: { hod: ["view"], pc: ["view"], auditor: ["view"] },
};
const STAFF_ONLY = ["doerTasks", "fmsTasks", "misMeeting", "auditorReport"]; // hidden from doers in the old menu
const NEW_PAGES = [...REPORT_PAGES, ...FMS_LISTS, "autoComplete", "fmsImport", "fmsBulk"];
const fit = (mod, acts) => [...new Set<any>((acts || []).filter((a) => MODULE_ACTIONS[mod]?.[a]))];
const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

// The legacy "reports" / "fms" ticks of one layer (department or user) as the new page ticks
function splitLayer(layer, role?) {
  if (!layer || typeof layer !== "object") return layer;
  const out = { ...layer };
  if (Array.isArray(layer.reports)) {
    for (const p of REPORT_PAGES) out[p] = role === "doer" && STAFF_ONLY.includes(p) ? [] : fit(p, layer.reports);
    delete out.reports;
  }
  if (Array.isArray(layer.fms)) {
    for (const p of FMS_LISTS) out[p] = layer.fms.includes("view") ? ["view"] : [];
    out.autoComplete = fit("autoComplete", layer.fms);
  }
  return out;
}

// The pages a user could open before the change
function oldPages(user, deptPerms) {
  const role = ROLE_DEFAULTS[user.role] ? user.role : "doer";
  const layered = (key, base) => {
    let v = base || [];
    if (Array.isArray(deptPerms?.[key])) v = deptPerms[key];
    if (Array.isArray(user.permissions?.[key])) v = user.permissions[key];
    return v;
  };
  const reports = layered("reports", OLD_DEFAULTS.reports[role]);
  const fms = layered("fms", OLD_DEFAULTS.fms[role]);
  const settings = layered("settings", []);
  const entries = layered("fmsEntries", ROLE_DEFAULTS[role].fmsEntries);
  const out: Record<string, any> = {};
  for (const p of REPORT_PAGES) out[p] = role === "doer" && STAFF_ONLY.includes(p) ? [] : fit(p, reports);
  for (const p of FMS_LISTS) out[p] = fms.includes("view") ? ["view"] : [];
  out.autoComplete = fit("autoComplete", fms);
  out.fmsImport = fms.includes("add") && settings.includes("edit") ? ["add"] : [];
  out.fmsBulk = entries.includes("view") && role !== "doer" ? ["view"] : [];
  return out;
}

// Part 2: the Audit List (was: the Auditor role, or Make Auditor), Auditor Settings (was: Settings edit) and the
// Ticket Report (was: Help Ticket – Manage view) get their own ticks
function oldPages2(user, deptPerms) {
  const role = ROLE_DEFAULTS[user.role] ? user.role : "doer";
  const layered = (key) => {
    let v = OLD_DEFAULTS2[key]?.[role] || [];
    if (Array.isArray(deptPerms?.[key])) v = deptPerms[key];
    if (Array.isArray(user.permissions?.[key])) v = user.permissions[key];
    return v;
  };
  return {
    auditList: role === "auditor" ? ["view"] : [],
    auditorSettings: layered("settings").includes("edit") ? ["edit"] : [],
    ticketReport: layered("tickets").includes("view") ? ["view"] : [],
  };
}
const OLD_DEFAULTS2 = { tickets: { hod: ["view", "edit"], pc: ["view", "edit"], tl: ["view", "edit"] } };

// Part 3: HRMS – Setup split into Shifts & Late Policy / Leave Types / Leave Policies / Policy Assignment; HRMS –
// Attendance into the Register, the Requests and the Biometric Upload; Doer Leave (was: Users) and the Settings pages
// (Working Calendar – also open with the Master FMS –, Sheet Links, Reminders) get their own ticks
const OLD_DEFAULTS3 = {
  attendance: { hod: ["view", "edit"], pc: ["view", "edit"], tl: ["view", "edit"], hr: ["view", "add", "edit"] },
  hrSetup: { hr: ["view", "edit", "delete"] },
  users: { hod: ["view"], pc: ["view"], tl: ["view"], hr: ["view", "add", "edit"] },
  fms: { hod: ["view"], pc: ["view"], auditor: ["view"] },
};
const PAGES3 = ["attendance", "attendanceRequests", "biometric", "attendanceSetup", "leaveTypes", "leavePolicies", "policyAssignment", "doerLeave", "calendar", "sheetLinks", "reminders", "settings"];
function splitLayer3(layer) {
  if (!layer || typeof layer !== "object") return layer;
  const out = { ...layer };
  if (Array.isArray(layer.hrSetup)) {
    for (const p of ["attendanceSetup", "leaveTypes", "leavePolicies", "policyAssignment"]) out[p] = fit(p, layer.hrSetup);
    delete out.hrSetup;
  }
  if (Array.isArray(layer.attendance)) {
    out.attendanceRequests = fit("attendanceRequests", layer.attendance);
    out.biometric = layer.attendance.includes("add") ? ["add"] : [];
    out.attendance = fit("attendance", layer.attendance);
  }
  if (Array.isArray(layer.users)) out.doerLeave = fit("doerLeave", layer.users);
  if (Array.isArray(layer.settings)) {
    out.calendar = fit("calendar", layer.settings);
    out.sheetLinks = layer.settings.includes("edit") ? ["edit"] : [];
    out.reminders = layer.settings.includes("view") ? ["view"] : [];
    out.settings = fit("settings", layer.settings);
  }
  return out;
}
function oldPages3(user, deptPerms) {
  const role = ROLE_DEFAULTS[user.role] ? user.role : "doer";
  const layered = (key) => {
    let v = OLD_DEFAULTS3[key]?.[role] || [];
    if (Array.isArray(deptPerms?.[key])) v = deptPerms[key];
    if (Array.isArray(user.permissions?.[key])) v = user.permissions[key];
    return v;
  };
  const att = layered("attendance");
  const setup = layered("hrSetup");
  const users = layered("users");
  const settings = layered("settings");
  const fms = layered("fms");
  return {
    attendance: fit("attendance", att),
    attendanceRequests: fit("attendanceRequests", att),
    biometric: att.includes("add") ? ["add"] : [],
    attendanceSetup: fit("attendanceSetup", setup),
    leaveTypes: fit("leaveTypes", setup),
    leavePolicies: fit("leavePolicies", setup),
    policyAssignment: fit("policyAssignment", setup),
    doerLeave: fit("doerLeave", users),
    calendar: [...(settings.includes("view") || fms.includes("view") ? ["view"] : []), ...(settings.includes("edit") ? ["edit"] : [])],
    sheetLinks: settings.includes("edit") ? ["edit"] : [],
    reminders: settings.includes("view") ? ["view"] : [],
    settings: fit("settings", settings),
  };
}

// Every user keeps the pages they had: where the new ticks (role → department → own) give something else for
// `pages`, the old value is written as the user's own tick. split turns a layer's old ticks into the new ones.
// Safe to stop half-way (a restart, a lost connection): each department keeps its access from before this step
// (accessBefore.<step>) and each user is marked when done (accessUpgrades), so a second run neither redoes a person
// nor reads an already changed department as the old one.
async function keepOldPages(KEY, pages, oldOf, split = (layer, role?) => layer) {
  if (await Setting.exists({ key: KEY })) return;
  const STEP = KEY.replace(/\./g, "_");
  const depts = await Department.collection.find({}).project({ permissions: 1, permissionsV1: 1, accessBefore: 1 }).toArray();
  const oldDept = new Map<string, any>();
  const newDept = new Map<string, any>();
  for (const d of depts) {
    const done = d.accessBefore && STEP in d.accessBefore;
    const before = done ? d.accessBefore[STEP] || undefined : d.permissions;
    const next = done ? d.permissions : split(d.permissions);
    oldDept.set(String(d._id), before);
    newDept.set(String(d._id), next);
    if (!done) {
      const set: Record<string, any> = { [`accessBefore.${STEP}`]: d.permissions ?? null };
      if (d.permissions && JSON.stringify(next) !== JSON.stringify(d.permissions)) {
        set.permissions = next;
        if (d.permissionsV1 === undefined) set.permissionsV1 = d.permissions;
      }
      await Department.collection.updateOne({ _id: d._id }, { $set: set });
    }
  }
  let changed = 0;
  const users = await User.collection.find({ accessUpgrades: { $ne: KEY } }).project({ role: 1, department: 1, permissions: 1, permissionsV1: 1 }).toArray();
  for (const u of users) {
    if (isAdmin(u)) {
      await User.collection.updateOne({ _id: u._id }, { $addToSet: { accessUpgrades: KEY } });
      continue;
    }
    const dept = u.department ? String(u.department) : "";
    const before = oldOf(u, oldDept.get(dept));
    const own = { ...(split(u.permissions, u.role) || {}) };
    const now = permissionsFor({ ...u, permissions: own, deptPermissions: newDept.get(dept) || undefined });
    for (const p of pages) if (!same(now[p], before[p])) own[p] = before[p];
    const next = Object.keys(own).length ? own : undefined;
    const mark = { $addToSet: { accessUpgrades: KEY } };
    if (JSON.stringify(next) === JSON.stringify(u.permissions)) {
      await User.collection.updateOne({ _id: u._id }, mark);
      continue;
    }
    const backup = u.permissionsV1 === undefined ? { permissionsV1: u.permissions ?? null } : {}; // the first backup stays
    await User.collection.updateOne({ _id: u._id }, next ? { $set: { permissions: next, ...backup }, ...mark } : { $unset: { permissions: "" }, ...(Object.keys(backup).length ? { $set: backup } : {}), ...mark });
    changed++;
  }
  await Setting.create({ key: KEY, value: { at: new Date(), users: changed } });
  if (changed) console.log(`Page access (${KEY}): ${changed} user(s) keep their old pages as their own ticks`);
}

const migratePageAccess = () => keepOldPages("migration.pageAccess", NEW_PAGES, oldPages, splitLayer);
const migratePageAccess2 = () => keepOldPages("migration.pageAccess2", ["auditList", "auditorSettings", "ticketReport"], oldPages2);
const migratePageAccess3 = () => keepOldPages("migration.pageAccess3", PAGES3, oldPages3, splitLayer3);

// v1 stored User.department as text ("QC"); v2 references a Department document.
async function migrateDepartments() {
  const legacy = await User.collection.find({ department: { $type: "string" } }).project({ department: 1 }).toArray();
  if (!legacy.length) return;
  const byName = new Map();
  for (const u of legacy) {
    const name = String(u.department || "").trim();
    let id = null;
    if (name) {
      const key = name.toLowerCase();
      if (!byName.has(key)) {
        const existing = await Department.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
        byName.set(key, existing?._id || (await Department.create({ name }))._id);
      }
      id = byName.get(key);
    }
    await User.collection.updateOne({ _id: u._id }, id ? { $set: { department: id } } : { $unset: { department: "" } });
  }
  console.log(`Migrated ${legacy.length} user department(s) to Department records`);
}

// v1 FMS: every step had a fixed doer and followed the previous one. v2 keeps that behaviour:
// step 1 starts with the entry, each later step after the previous one is done, planned from its actual.
async function migrateProcessesToV2() {
  const db = mongoose.connection.db;
  const processes = db.collection("processes");
  const legacy = await processes.find({ version: { $ne: 2 } }).toArray();
  for (const p of legacy) {
    const keys = (p.steps || []).map((s, i) => s.key || `s${i + 1}`);
    const steps = (p.steps || []).map((s, i) => ({
      _id: s._id,
      key: keys[i],
      name: s.name,
      how: s.how || "",
      videoLink: "",
      doer: s.doer && s.doer.mode ? s.doer : { mode: "fixed", user: s.doer },
      start: i === 0 ? { mode: "entry" } : { mode: "afterDone", step: keys[i - 1] },
      tat: s.tat ?? 1,
      tatUnit: s.tatUnit || "days",
      tatOverrides: [],
      fields: [],
    }));
    const fields = (p.fields || []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type || "text",
      options: f.options || [],
      required: Boolean(f.required),
      help: "",
    }));
    await processes.updateOne(
      { _id: p._id },
      {
        $set: {
          steps,
          fields,
          calendar: { mode: p.skipSundays ? "calendar_skip" : "calendar" },
          closure: { enabled: false, label: "Status by PC", options: [] },
          version: 2,
        },
      }
    );
    const tasks = db.collection("tasks");
    for (let i = 0; i < keys.length; i++) {
      await tasks.updateMany({ process: p._id, stepIndex: i, stepKey: { $exists: false } }, { $set: { stepKey: keys[i] } });
    }
    await tasks.updateMany({ process: p._id, status: { $in: ["done", "na"] }, resolvedAt: { $exists: false } }, [
      { $set: { resolvedAt: { $ifNull: ["$actual", "$updatedAt"] } } },
    ]);
    await tasks.updateMany({ process: p._id, status: "pending", activatedAt: { $exists: false } }, [
      { $set: { activatedAt: { $ifNull: ["$planned", "$createdAt"] } } },
    ]);
    console.log(`Upgraded FMS "${p.name}" to engine v2 (${steps.length} steps)`);
  }
}

export = { runMigrations, migratePageAccess, migratePageAccess2, migratePageAccess3, oldPages, oldPages2, oldPages3, splitLayer, splitLayer3 };
