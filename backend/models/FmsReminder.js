const mongoose = require("mongoose");

const { ObjectId, Mixed } = mongoose.Schema.Types;

// MIDAP "FMS Reminder" and "Override Configure Notification": an email to the doer of a pending FMS step
// before it is due, when it is due, or after it is overdue (repeated). A rule with a condition is the
// "override": when it applies, the plain rule of the same step and timing is not sent.
const fmsReminderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    process: { type: ObjectId, ref: "Process", required: true },
    step: { type: String, default: "" }, // "" = every step
    timing: { type: String, enum: ["before", "due", "overdue"], default: "due" },
    hours: { type: Number, default: 0 }, // before: hours before planned; overdue: hours after planned
    repeatHours: { type: Number, default: null }, // overdue: send again every N hours
    maxTimes: { type: Number, default: 1 },
    ccPc: { type: Boolean, default: false },
    ccTeamLeader: { type: Boolean, default: false },
    when: Mixed, // condition on the entry fields
    subject: { type: String, default: "" },
    message: { type: String, default: "" },
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);

fmsReminderSchema.index({ process: 1, active: 1 });

module.exports = mongoose.model("FmsReminder", fmsReminderSchema);
