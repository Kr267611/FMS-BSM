import mongoose = require("mongoose");

// HRMS "Late Policy": how many late marks a month are forgiven and what the ones after that cost.
// Example: freeLates 3, every 3, penalty "half" -> the 4th–6th late = half a day cut, 7th–9th = another half…
const latePolicySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, trim: true, default: "" },
    freeLates: { type: Number, default: 3 }, // late marks a month with no cut
    every: { type: Number, default: 3 }, // after the free ones, each group of this many late marks…
    penalty: { type: String, enum: ["half", "full"], default: "half" }, // …costs half a day or a full day
    countEarly: { type: Boolean, default: false }, // early going counts like a late mark
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export = mongoose.model("LatePolicy", latePolicySchema);
