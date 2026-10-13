import mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema.Types;

// One person's attendance for one day: every punch (phone, biometric machine or entered by a manager),
// a manager's mark when they set the day by hand, and the day's result worked out from those.
const punchSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    source: { type: String, enum: ["app", "biometric", "manual"], required: true },
    lat: Number,
    lng: Number,
    accuracy: Number, // metres, as the phone reported it
    distance: Number, // metres from the branch's location
    outside: { type: Boolean, default: false }, // outside the branch's geo-fence (allowed by the settings)
    photo: String, // selfie (uploads id)
    by: { type: ObjectId, ref: "User" }, // who entered it (manual / biometric import)
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // "YYYY-MM-DD" – the shift's start day (a night shift's punches next morning count here)
    shift: { type: ObjectId, ref: "Shift" },
    punches: [punchSchema],
    // a manager set the day by hand; this wins over the punches
    manual: {
      status: { type: String, enum: ["P", "H", "A"] },
      note: String,
      by: { type: ObjectId, ref: "User" },
      at: Date,
    },
  },
  { timestamps: true }
);
attendanceSchema.index({ user: 1, day: 1 }, { unique: true });
attendanceSchema.index({ day: 1 });

export = mongoose.model("Attendance", attendanceSchema);
