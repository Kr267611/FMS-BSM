const mongoose = require("mongoose");

// DataJobs ki ek row: kis Google Sheet ke kis step ko kis doer ke score me lena hai.
// Software sheet ko sirf PADHTA hai, kabhi edit nahi karta.
const sheetLinkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // Task Count row ka naam
    doer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    spreadsheetId: { type: String, required: true },
    tabName: { type: String, required: true },
    firstDataRow: { type: Number, required: true, min: 1 },
    plannedCol: { type: String, required: true, uppercase: true, trim: true },
    actualCol: { type: String, required: true, uppercase: true, trim: true },
    filterCol: { type: String, uppercase: true, trim: true, default: "" },
    filterValues: [String], // khaali = sab rows (sirf Planned != "")
    active: { type: Boolean, default: true },

    lastSyncAt: Date,
    lastCount: Number,
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SheetLink", sheetLinkSchema);
