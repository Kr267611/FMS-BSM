const mongoose = require("mongoose");

// Who changed what, and when. Written for every create / update / delete and sign-in event.
const auditLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  actorName: String,
  action: { type: String, required: true }, // e.g. "user.create", "task.done", "auth.login_failed"
  entity: String, // e.g. "User", "Task"
  entityId: String,
  summary: String,
  ip: String,
});

auditLogSchema.index({ entity: 1, entityId: 1, at: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
