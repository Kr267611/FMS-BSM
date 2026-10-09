const mongoose = require("mongoose");

const { ObjectId, Mixed } = mongoose.Schema.Types;

// MIDAP "FMS Auto Complete" / "Split FMS": when a step of one FMS is done (and the condition holds),
// an entry is created in another FMS with values copied from the first one.
const autoCompleteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    source: {
      process: { type: ObjectId, ref: "Process", required: true },
      step: { type: String, required: true }, // step key, e.g. "s2"
    },
    when: Mixed, // optional condition on the source entry and its steps
    target: { type: ObjectId, ref: "Process", required: true },
    // each target field gets: an entry field, a value the doer filled in the step, a fixed value, or "FMS #entry"
    map: [{ _id: false, to: String, from: { type: String, enum: ["entry", "step", "fixed", "entryNo"] }, key: String, value: String }],
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);

autoCompleteSchema.index({ "source.process": 1, "source.step": 1, active: 1 });

module.exports = mongoose.model("AutoComplete", autoCompleteSchema);
