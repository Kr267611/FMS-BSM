const User = require("../models/User");

// Which doers' tasks and MIS a user may see.
// null = everyone (admin, auditor); otherwise a list of user ids.
async function visibleUserIds(user) {
  if (!user) return [];
  if (user.role === "admin" || user.role === "auditor") return null;
  if (user.role === "hod" || user.role === "pc") {
    const depts = [user.department, ...(user.managedDepartments || [])].filter(Boolean);
    const users = await User.find({ $or: [{ department: { $in: depts } }, { teamLeader: user._id }] }).select("_id").lean();
    return [...new Set([String(user._id), ...users.map((u) => String(u._id))])];
  }
  return [String(user._id)];
}

async function canSeeUser(user, otherId) {
  const ids = await visibleUserIds(user);
  return ids === null || ids.includes(String(otherId));
}

module.exports = { visibleUserIds, canSeeUser };
