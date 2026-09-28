const mongoose = require("mongoose");

// Ek FMS = ek Process. Header block ka What/Who/When/How yahan aata hai.
const fieldSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, enum: ["text", "number", "date", "select"], default: "text" },
  options: [String],
  required: { type: Boolean, default: false },
});

const stepSchema = new mongoose.Schema({
  name: { type: String, required: true },
  doer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  tat: { type: Number, required: true, min: 0 },
  tatUnit: { type: String, enum: ["days", "hours"], default: "days" },
  how: { type: String, default: "" },
});

const processSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    skipSundays: { type: Boolean, default: false },
    fields: [fieldSchema],
    steps: [stepSchema],
    active: { type: Boolean, default: true },
    jobCounter: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Process", processSchema);
