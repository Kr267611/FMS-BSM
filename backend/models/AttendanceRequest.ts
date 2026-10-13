import mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema.Types;

// HRMS attendance regularization: a person asks to fix a day –
//   "missed": the punch-in and / or punch-out time they forgot (IST "HH:MM")
//   "onduty": they were on duty elsewhere (site visit, client, training) – mark the day P or H
// Their manager approves (the punches / the mark are added to the day) or rejects.
const attendanceRequestSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // "YYYY-MM-DD" (the shift's start day)
    kind: { type: String, enum: ["missed", "onduty"], required: true },
    inTime: String, // "09:30"
    outTime: String, // "18:30" – before the in time = the next morning (night shift)
    status: { type: String, enum: ["P", "H"] }, // onduty: the day becomes this
    reason: { type: String, required: true },
    state: { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending" },
    appliedBy: { type: ObjectId, ref: "User" },
    decidedBy: { type: ObjectId, ref: "User" },
    decidedAt: Date,
    note: String, // the manager's remark (needed to reject)
  },
  { timestamps: true }
);
attendanceRequestSchema.index({ user: 1, day: 1 });
attendanceRequestSchema.index({ state: 1, createdAt: -1 });

export = mongoose.model("AttendanceRequest", attendanceRequestSchema);
