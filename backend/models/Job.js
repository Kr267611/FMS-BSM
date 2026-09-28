const mongoose = require("mongoose");

// One Job = one FMS sheet row (the entry data on the left side).
const jobSchema = new mongoose.Schema(
  {
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process", required: true, index: true },
    jobNo: { type: String, required: true },
    startDate: { type: Date, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["open", "closed"], default: "open" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Job", jobSchema);
