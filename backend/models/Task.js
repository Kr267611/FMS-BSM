const mongoose = require("mongoose");

// Ek Task = ek step ka Planned / Actual / Status / Remarks block.
// App ke jobs aur Google Sheet se aaye rows - dono yahin aate hain,
// isliye scoring ek hi jagah se hoti hai (Feeder + Performance-daily ki jagah).
const taskSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["app", "sheet"], required: true },
    label: { type: String, required: true }, // Task Count ki row ka naam, e.g. "Vendor Payment – Payment"
    doer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // app tasks
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process" },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", index: true },
    stepIndex: Number,
    stepName: String,
    tat: Number, // job bante waqt step ka TAT copy - baad me process badle to purane jobs na badlein
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
