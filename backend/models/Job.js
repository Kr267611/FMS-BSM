const mongoose = require("mongoose");

// Ek Job = FMS sheet ki ek row (left side ka entry data).
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
