import mongoose = require("mongoose");

const { Schema } = mongoose;
const FIELD_TYPES = ["text", "longtext", "number", "date", "datetime", "select", "yesno", "user", "link", "photo"];

// Master FMS = the What / Who / When / How header block of an FMS sheet, as data.
// Entry fields are the columns on the left of the sheet; each step is one Planned / Actual / Status block.
const fieldSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: FIELD_TYPES, default: "text" },
    options: [String], // dropdown options (or suggestions for a text field)
    required: { type: Boolean, default: false },
    help: { type: String, default: "" },
    // Auto-calculated field, e.g. Days in Diff = { op: "days", a: "last_issue_date", b: "@entry" }
    formula: { op: String, a: String, b: String },
  },
  { _id: false }
);

const doerSchema = new Schema(
  {
    mode: { type: String, enum: ["fixed", "field", "map"], default: "fixed" },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    field: String, // mode "field": entry field holding the person
    keys: [String], // mode "map": 1-2 entry fields to look up, e.g. ["machine_no", "item_group"]
    map: [{ _id: false, match: [String], name: String, user: { type: Schema.Types.ObjectId, ref: "User" } }],
    fallback: { type: Schema.Types.ObjectId, ref: "User" },
    hint: String, // who the sheet names for this step, shown until a user is chosen
  },
  { _id: false }
);

const stepSchema = new Schema({
  key: { type: String, required: true }, // stable id used by conditions, e.g. "s3"
  name: { type: String, required: true },
  how: { type: String, default: "" },
  videoLink: { type: String, default: "" },
  effortMinutes: { type: Number, default: 0 }, // MIDAP "effort time": how long the step's work takes
  doer: { type: doerSchema, default: () => ({}) },
  // entry | afterDone | afterDue (escalation) | withStart (parallel), relative to `step`.
  // also: afterDone when `step` or one of these is done; days / ifLate: an escalation `days` after the planned day,
  // only if the step was not done by then
  start: { mode: { type: String, default: "entry" }, step: String, also: { type: [String], default: undefined }, days: Number, ifLate: Boolean },
  when: Schema.Types.Mixed, // run condition; false -> the step is skipped
  // planned = base (+ offset calendar days) + TAT; monthDay: `day` of the entry date's month
  plan: { from: String, step: String, field: String, day: Number, offset: Number },
  tat: { type: Number, default: 1 },
  tatUnit: { type: String, enum: ["minutes", "hours", "days"], default: "days" },
  tatOverrides: [{ _id: false, when: Schema.Types.Mixed, tat: Number, unit: String }],
  fields: [fieldSchema], // what the doer fills: Status, Remarks, Action Taken, photos…
});

const processSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    sopLink: { type: String, default: "" },
    pc: { type: Schema.Types.ObjectId, ref: "User" }, // global PC: follows up, closes entries
    auditor: { type: Schema.Types.ObjectId, ref: "User" }, // checks a sample of the finished steps (Auditor Settings)
    department: { type: Schema.Types.ObjectId, ref: "Department" },
    calendar: { mode: { type: String, enum: ["working", "calendar_skip", "calendar"], default: "working" } },
    fields: [fieldSchema],
    steps: [stepSchema],
    // "Status by PC": closing an entry completes its open steps and skips the rest
    closure: {
      enabled: { type: Boolean, default: true },
      label: { type: String, default: "Status by PC" },
      options: { type: [String], default: ["Closed"] },
    },
    // imported from a Google Sheet tab: where it came from and which column fed which field / step
    source: { type: Schema.Types.Mixed, default: undefined },
    // Sheet Sync (imported FMS): what the app writes back to the sheet and / or reads from it, per FMS, step and column
    sheetSync: { type: Schema.Types.Mixed, default: undefined },
    active: { type: Boolean, default: true },
    jobCounter: { type: Number, default: 0 },
    version: { type: Number, default: 2 },
    skipSundays: Boolean, // v1 only
  },
  { timestamps: true }
);

export = Object.assign(mongoose.model("Process", processSchema), { FIELD_TYPES, fieldSchema });
