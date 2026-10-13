import mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    address: { type: String, trim: true, default: "" },
    // HRMS attendance geo-fence: phone punches must be within `radius` metres of this point (when set)
    location: {
      lat: Number,
      lng: Number,
      radius: { type: Number, default: 200 },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" },
    hod: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // access for everyone in the department, over their role's defaults: { module: ["view", …] } (a user's own access wins)
    permissions: { type: mongoose.Schema.Types.Mixed },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Branch = mongoose.model("Branch", branchSchema);
const Department = mongoose.model("Department", departmentSchema);

export = { Branch, Department };
