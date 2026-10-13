const mongoose = require("mongoose");

// MIDAP "Leave Type Configure": Casual Leave, Sick Leave, Half-Day Leave…
const leaveTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, trim: true, default: "" }, // e.g. CL, SL
    description: { type: String, default: "" },
    paid: { type: Boolean, default: true }, // unpaid leave has no quota
    gender: { type: String, enum: ["all", "male", "female", "other"], default: "all" },
    carryForward: { type: Boolean, default: false },
    maxCarryForward: { type: Number, default: 0 }, // days; 0 = no limit when carry forward is on
    encashable: { type: Boolean, default: false },
    requiresDocument: { type: Boolean, default: false }, // e.g. a medical certificate
    color: { type: String, default: "#14877a" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LeaveType", leaveTypeSchema);
