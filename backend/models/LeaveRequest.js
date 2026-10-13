// @ts-check
const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;

// MIDAP "Leave Apply" / "Leave List": a request for days off, decided by the person's manager.
// Approving it makes a Leave (the days off the task engine knows about) and hands their work to the buddies.
const leaveRequestSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User", required: true, index: true },
    type: { type: ObjectId, ref: "LeaveType", required: true },
    from: { type: String, required: true }, // "YYYY-MM-DD"
    to: { type: String, required: true },
    halfDay: { type: Boolean, default: false },
    session: { type: String, enum: ["morning", "afternoon", null], default: null },
    days: { type: Number, required: true }, // working days asked for (0.5 for a half day)
    lwpDays: { type: Number, default: 0 }, // of those, unpaid because the balance ran out
    reason: { type: String, required: true },
    attachment: { type: String, default: "" }, // a photo id from /api/files
    // who covers the work while away (MIDAP "Action on Assigned Tasks")
    buddies: { checklist: { type: ObjectId, ref: "User" }, fms: { type: ObjectId, ref: "User" }, delegation: { type: ObjectId, ref: "User" } },
    status: { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending", index: true },
    appliedBy: { type: ObjectId, ref: "User" }, // the person, or a manager applying for them
    decidedBy: { type: ObjectId, ref: "User" },
    decidedAt: Date,
    note: { type: String, default: "" }, // the manager's remark
    leave: { type: ObjectId, ref: "Leave" }, // made on approval
    applied: { type: mongoose.Schema.Types.Mixed }, // what the approval did to the tasks
  },
  { timestamps: true }
);
leaveRequestSchema.index({ user: 1, from: 1 });

module.exports = mongoose.model("LeaveRequest", leaveRequestSchema);
