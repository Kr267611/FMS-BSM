import mongoose = require("mongoose");

// A person's own Google account, connected on the AI page so the AI assistant can read their Drive and Sheets
// (read-only). The refresh token is stored encrypted (services/ai/googleAccess.ts) and never sent to the browser.
const googleConnectionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    email: { type: String, required: true },
    refreshToken: { type: String, required: true },
    scopes: [String],
    connectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export = mongoose.model("GoogleConnection", googleConnectionSchema);
