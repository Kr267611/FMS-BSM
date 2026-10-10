const mongoose = require("mongoose");

// MIDAP "Doer Holiday": days one person is away (leave, sick, training). Their checklist tasks on those days are
// not required, their FMS steps and delegations due then move to the first working day after, and a new FMS
// step does not fall due on them.
const leaveSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    from: { type: String, required: true }, // "YYYY-MM-DD" IST, first day away
    to: { type: String, required: true }, // last day away
    reason: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // what applying it changed, shown on the list: { notRequired, moved, movedTo }
    applied: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);
leaveSchema.index({ user: 1, from: 1 });

module.exports = mongoose.model("Leave", leaveSchema);
