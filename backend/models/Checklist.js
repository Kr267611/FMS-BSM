const mongoose = require("mongoose");
const { fieldSchema } = require("./Process");
const { PRIORITIES } = require("./Task");

const { ObjectId } = mongoose.Schema.Types;
const FREQUENCIES = ["daily", "weekly", "monthly", "interval"];
const HOLIDAY_RULES = ["skip", "next", "previous"];

// A recurring task (MIDAP "Checklist"). The scheduler turns it into one Task per due day.
const checklistSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    how: { type: String, default: "" },
    videoLink: { type: String, default: "" },
    doer: { type: ObjectId, ref: "User", required: true },
    pc: { type: ObjectId, ref: "User" },
    auditor: { type: ObjectId, ref: "User" },
    group: { type: ObjectId, ref: "TaskGroup" },
    priority: { type: String, enum: PRIORITIES, default: "normal" },
    effortMinutes: { type: Number, default: 0 }, // MIDAP "effort time" of one occurrence

    // daily · weekly on `days` (0 = Sunday) · monthly on `dates` (31 = last day) every `every` months · every `every` days
    frequency: {
      type: { type: String, enum: FREQUENCIES, required: true },
      days: [Number],
      dates: [Number],
      every: Number,
    },
    start: { type: String, required: true }, // "YYYY-MM-DD"
    end: String,
    dueTime: { type: String, default: "18:00" }, // IST
    createBefore: { type: Number, default: 0 }, // days the task shows up before it is due
    onHoliday: { type: String, enum: HOLIDAY_RULES, default: "skip" }, // due day is a week-off or holiday
    autoCloseDays: { type: Number, default: null }, // still pending this many days after the due day -> closed as not done

    fields: [fieldSchema], // what the doer fills: reading, photo…
    active: { type: Boolean, default: true },
    generatedUntil: String, // tasks exist up to this day
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);

checklistSchema.index({ doer: 1, active: 1 });

module.exports = mongoose.model("Checklist", checklistSchema);
module.exports.FREQUENCIES = FREQUENCIES;
module.exports.HOLIDAY_RULES = HOLIDAY_RULES;
