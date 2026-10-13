import AuditLog = require("../models/AuditLog");

// Fire-and-forget: an audit write must never break the action it records.
function audit(req, action, { entity, entityId, summary, actor }: any = {}) {
  const who = actor || req?.user;
  AuditLog.create({
    actor: who?._id,
    actorName: who?.name,
    action,
    entity,
    entityId: entityId ? String(entityId) : undefined,
    summary,
    ip: req?.ip,
  }).catch((err) => console.error("Audit log write failed:", err.message));
}

export = { audit };
