import mongoose = require("mongoose");

// Groups to organise checklists and delegations (MIDAP "Checklist / Delegation Group")
const taskGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
  },
  { timestamps: true }
);

export = mongoose.model("TaskGroup", taskGroupSchema);
