const mongoose = require("mongoose");

// One Task = one step's Planned / Actual / Status / Remarks block.
// App jobs and rows synced from Google Sheets both land here,
// so all scoring reads one collection (replacing Feeder + Performance-daily).
const taskSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["app", "sheet"], required: true },
    label: { type: String, required: true }, // Row name in the MIS, e.g. "Vendor Payment – Payment"
    doer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // app tasks
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process" },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", index: true },
    stepIndex: Number,
    stepName: String,
    tat: Number, // Copied from the step when the job is created, so later process edits don't change old jobs
    tatUnit: { type: String, enum: ["days", "hours"] },
    skipSundays: Boolean,

    // sheet tasks
    sheetLink: { type: mongoose.Schema.Types.ObjectId, ref: "SheetLink", index: true },
    sheetRow: Number,

    planned: Date,
    plannedDay: { type: String, index: true }, // "YYYY-MM-DD" IST
    actual: Date,
    actualDay: String,
    status: { type: String, enum: ["waiting", "pending", "done", "na"], default: "waiting" },
    remarks: { type: String, default: "" },
    doneBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

taskSchema.index({ doer: 1, plannedDay: 1 });

module.exports = mongoose.model("Task", taskSchema);
