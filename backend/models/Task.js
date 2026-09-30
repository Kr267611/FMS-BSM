const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;
const PRIORITIES = ["normal", "high", "critical"];

// One Task = one Planned / Actual / Status / Remarks block.
// FMS steps ("app"), rows synced from Google Sheets, checklist occurrences and delegations all land here,
// so all scoring reads one collection (replacing Feeder + Performance-daily).
const taskSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["app", "sheet", "checklist", "delegation"], required: true },
    label: { type: String, required: true }, // Row name in the MIS, e.g. "Vendor Payment – Payment"; the task name for delegations
    doer: { type: ObjectId, ref: "User", index: true }, // set once the step starts
    priority: { type: String, enum: PRIORITIES, default: undefined },
    pc: { type: ObjectId, ref: "User" },
    auditor: { type: ObjectId, ref: "User" },

    // checklist occurrences
    checklist: { type: ObjectId, ref: "Checklist" },
    closeAt: Date, // auto-close: still pending at this time -> "expired" (counted as not done)

    // delegations
    assignedBy: { type: ObjectId, ref: "User" },
    details: String,
    proofRequired: Boolean,
    // deadline changes: requested by the doer before the deadline, approved or rejected by the assigner
    revisions: {
      type: [
        {
          _id: false,
          from: Date,
          to: Date,
          reason: String,
          by: { type: ObjectId, ref: "User" },
          at: Date,
          status: { type: String, enum: ["pending", "approved", "rejected"] },
          decidedBy: { type: ObjectId, ref: "User" },
          decidedAt: Date,
          note: String,
        },
      ],
      default: undefined,
    },
    reopenCount: Number,
    log: { type: [{ _id: false, at: Date, by: { type: ObjectId, ref: "User" }, action: String, note: String }], default: undefined },

    // app tasks
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process" },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", index: true },
    stepKey: String,
    stepIndex: Number,
    stepName: String,
    tat: Number, // the TAT used when the step started (after any override)
    tatUnit: { type: String, enum: ["minutes", "hours", "days"] },
    skipSundays: Boolean, // v1 only

    // sheet tasks
    sheetLink: { type: mongoose.Schema.Types.ObjectId, ref: "SheetLink", index: true },
    sheetRow: Number,

    // waiting: not started · pending: started, not done · done · na: Not Required (not scored)
    // skipped: its condition was false, or the entry was closed first (not scored)
    // expired: a checklist task auto-closed without being done (scored as pending)
    status: { type: String, enum: ["waiting", "pending", "done", "na", "skipped", "expired"], default: "waiting" },
    planned: Date,
    plannedDay: { type: String, index: true }, // "YYYY-MM-DD" IST
    actual: Date,
    actualDay: String,
    triggerAt: Date, // an escalation step waits until this time
    activatedAt: Date,
    resolvedAt: Date,
    skipReason: String,
    autoClosed: Boolean, // completed because the PC closed the entry
    values: { type: mongoose.Schema.Types.Mixed, default: undefined }, // the step's fields: Status, Action Taken…
    remarks: { type: String, default: "" },
    doneBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true, optimisticConcurrency: true }
);

taskSchema.index({ doer: 1, plannedDay: 1 });
taskSchema.index({ status: 1, triggerAt: 1 });
// One task per checklist per day, so generating twice (or from two servers) never duplicates
taskSchema.index({ checklist: 1, plannedDay: 1 }, { unique: true, partialFilterExpression: { checklist: { $exists: true } } });
taskSchema.index({ status: 1, closeAt: 1 });
taskSchema.index({ assignedBy: 1, kind: 1, status: 1 });

module.exports = mongoose.model("Task", taskSchema);
module.exports.PRIORITIES = PRIORITIES;
