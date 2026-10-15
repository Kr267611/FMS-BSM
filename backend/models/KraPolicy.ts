import mongoose = require("mongoose");

const { ObjectId, Mixed } = mongoose.Schema.Types;

// KRA policy: the Key Result Areas of a group of people (by department, role, or named people), each with a weight,
// and under each its KPIs: a measure, a target, and whether higher or lower is better.
// Every change is a new version from a month on ("YYYY-MM"), so a month already passed keeps the KRAs, targets and
// people it was scored with. The checked shape of a version: services/kra.ts (cleanVersion).
const versionSchema = new mongoose.Schema(
  {
    from: { type: String, required: true }, // first month this version counts for
    appliesTo: { type: Mixed, default: () => ({ departments: [], roles: [], users: [] }) },
    kras: { type: Mixed, default: () => [] }, // [{ key, name, weight, kpis: [{ key, name, metric, kind, process, target, weight }] }]
    by: { type: ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const kraPolicySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    active: { type: Boolean, default: true },
    versions: [versionSchema], // oldest first; the last one is the current one
  },
  { timestamps: true }
);

export = mongoose.model("KraPolicy", kraPolicySchema);
