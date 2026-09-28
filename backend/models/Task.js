const mongoose = require("mongoose");

// One Task = one step's Planned / Actual / Status / Remarks block.
// App entries and rows synced from Google Sheets both land here,
// so all scoring reads one collection (replacing Feeder + Performance-daily).
const taskSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["app", "sheet"], required: true },
    label: { type: String, required: true }, // Row name in the MIS, e.g. "Vendor Payment – Payment"
    doer: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }, // set once the step starts

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
    status: { type: String, enum: ["waiting", "pending", "done", "na", "skipped"], default: "waiting" },
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
    doneBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, optimisticConcurrency: true }
);

taskSchema.index({ doer: 1, plannedDay: 1 });
taskSchema.index({ status: 1, triggerAt: 1 });

module.exports = mongoose.model("Task", taskSchema);
