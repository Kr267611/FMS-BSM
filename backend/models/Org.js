const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    address: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" },
    hod: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Branch = mongoose.model("Branch", branchSchema);
const Department = mongoose.model("Department", departmentSchema);

module.exports = { Branch, Department };
