const mongoose = require("mongoose");
const User = require("../models/User");
const { Department } = require("../models/Org");

// Idempotent data upgrades, run on every start.
async function runMigrations() {
  await migrateDepartments();
  await migrateProcessesToV2();
}

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

module.exports = { runMigrations };
