const mongoose = require("mongoose");

// One Job = one FMS sheet row (the entry data on the left side).
const jobSchema = new mongoose.Schema(
  {
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process", required: true, index: true },
    jobNo: { type: String, required: true },
    startDate: { type: Date, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // open: steps still running · closed: every step finished, or closed by the PC (closeStatus set)
    status: { type: String, enum: ["open", "closed"], default: "open" },
    closeStatus: String,
    closeRemarks: String,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    closedAt: Date,
    searchText: { type: String, default: "" }, // lower-case field values for the entries search box
  },
  { timestamps: true }
);

jobSchema.index({ process: 1, startDate: -1 });

module.exports = mongoose.model("Job", jobSchema);
