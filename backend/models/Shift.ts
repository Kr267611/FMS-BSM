import mongoose = require("mongoose");

// HRMS attendance: a working shift. Late / early going and half days are counted against it.
// A shift whose end is before its start runs past midnight (night shift).
const shiftSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true }, // e.g. General, Night, Shift A
    code: { type: String, trim: true, default: "" },
    start: { type: String, required: true }, // "09:30" IST
    end: { type: String, required: true }, // "18:30"; "06:00" with start "22:00" = night shift
    graceMinutes: { type: Number, default: 10 }, // punch-in up to start + grace is on time
    earlyGraceMinutes: { type: Number, default: 10 }, // punch-out from end - grace is not early going
    fullDayMinutes: { type: Number, default: 480 }, // worked at least this = present
    halfDayMinutes: { type: Number, default: 240 }, // at least this = half day; less = absent
    color: { type: String, default: "#14877a" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export = mongoose.model("Shift", shiftSchema);
