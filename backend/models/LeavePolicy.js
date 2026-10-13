const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;

// MIDAP "Leave Policy": how much of each leave type a person gets and what happens when it runs out.
//   accrual  frontload – the whole year's quota from 1 January
//            monthly   – a twelfth each month, credited on `creditDay`
//   exhaust  lwp       – days above the balance become unpaid leave (LWP)
//            reject    – the request is refused
//            negative  – the balance may go below 0, down to -maxNegative
const ruleSchema = new mongoose.Schema(
  {
    type: { type: ObjectId, ref: "LeaveType", required: true },
    perYear: { type: Number, default: 0 },
    minAtOnce: { type: Number, default: 0 }, // 0 = no minimum
    maxAtOnce: { type: Number, default: 0 }, // 0 = no maximum
    carryLimit: { type: Number, default: 0 }, // days a year may carry into the next (with the type's carry forward on)
    encashLimit: { type: Number, default: 0 },
  },
  { _id: false }
);

const leavePolicySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, trim: true, default: "" },
    description: { type: String, default: "" },
    accrual: { type: String, enum: ["frontload", "monthly"], default: "frontload" },
    creditDay: { type: Number, default: 1, min: 1, max: 28 },
    capacity: { type: Number, default: 0 }, // most a balance can hold; 0 = no cap
    exhaust: { type: String, enum: ["lwp", "reject", "negative"], default: "lwp" },
    maxNegative: { type: Number, default: 0 },
    rules: [ruleSchema],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LeavePolicy", leavePolicySchema);
