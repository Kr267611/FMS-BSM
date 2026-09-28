const User = require("../models/User");
const { Department } = require("../models/Org");

// Idempotent data upgrades, run on every start.
async function runMigrations() {
  // v1 stored User.department as text ("QC"); v2 references a Department document.
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

module.exports = { runMigrations };
