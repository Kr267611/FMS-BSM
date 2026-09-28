const express = require("express");
const AuditLog = require("../models/AuditLog");
const { auth, permit } = require("../middleware/auth");

const router = express.Router();

router.get("/", auth, permit("audit", "view"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const filter = {};
  if (req.query.action) filter.action = { $regex: `^${String(req.query.action).replace(/[^a-z_.]/gi, "")}` };
  if (req.query.entityId) filter.entityId = String(req.query.entityId);
  const [total, rows] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  res.json({ total, page, limit, rows });
});

module.exports = router;
