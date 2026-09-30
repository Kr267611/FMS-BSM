const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "hod", "pc", "tl", "auditor", "doer"], default: "doer" },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" },
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    // HOD / PC: the departments they oversee (their own department is always included)
    managedDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
    teamLeader: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Per-user overrides of the role's default permissions: { module: ["view","add",...] }
    permissions: { type: mongoose.Schema.Types.Mixed },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true },

    // Bumped on every password change or reset; tokens issued before that stop working
    tokenVersion: { type: Number, default: 0 },
    // Password reset: only a SHA-256 hash of the emailed token is stored
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    resetRequestedAt: { type: Date, select: false },

    // Brute-force protection and sign-in history
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: Date,
    lastLoginIp: String,
  },
  { timestamps: true }
);

// Email is optional, but two users can never share one
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string", $gt: "" } } }
);

module.exports = mongoose.model("User", userSchema);
