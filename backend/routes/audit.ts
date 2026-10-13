import express = require("express");
import AuditLog = require("../models/AuditLog");
import authLib = require("../middleware/auth");
const { auth, permit } = authLib;

const router = express.Router();

router.get("/", auth, permit("audit", "view"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const filter: Record<string, any> = {};
  if (req.query.action) filter.action = { $regex: `^${String(req.query.action).replace(/[^a-z_.]/gi, "")}` };
  if (req.query.entityId) filter.entityId = String(req.query.entityId);
  const [total, rows] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean<any>(),
  ]);
  res.json({ total, page, limit, rows });
});

export = router;
