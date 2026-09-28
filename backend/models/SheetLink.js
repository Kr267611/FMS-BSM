const mongoose = require("mongoose");

// One DataJobs row: which Google Sheet step feeds which doer's score.
// The software only READS the sheet and never edits it.
const sheetLinkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // Row name in the MIS
    doer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    spreadsheetId: { type: String, required: true },
    tabName: { type: String, required: true },
    firstDataRow: { type: Number, required: true, min: 1 },
    plannedCol: { type: String, required: true, uppercase: true, trim: true },
    actualCol: { type: String, required: true, uppercase: true, trim: true },
    filterCol: { type: String, uppercase: true, trim: true, default: "" },
    filterValues: [String], // empty = all rows (only Planned != "")
    active: { type: Boolean, default: true },

    lastSyncAt: Date,
    lastCount: Number,
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SheetLink", sheetLinkSchema);
