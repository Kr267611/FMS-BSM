import User = require("../models/User");
import permissionsLib = require("./permissions");
const { isAdmin } = permissionsLib;

// Which people's tasks, MIS, leave, attendance and tickets a user may reach (their permissions decide what they may do).
// null = everyone (admin, auditor, HR, or "Sees everyone" set on the user); otherwise a list of user ids.
// What a user's reach is when it is not the whole company: set on the user, or the role's own
const ROLE_REACH = { hod: "department", pc: "department", tl: "team" };
const reachOf = (user) => (isAdmin(user) || ["auditor", "hr"].includes(user?.role) || user?.seesAll ? "all" : user?.reach || ROLE_REACH[user?.role] || "self");

async function visibleUserIds(user) {
  if (!user) return [];
  const reach = reachOf(user);
  if (reach === "all") return null;
  if (reach === "department") {
    const depts = [user.department, ...(user.managedDepartments || [])].filter(Boolean);
    const users = await User.find({ $or: [{ department: { $in: depts } }, { teamLeader: user._id }] }).select("_id").lean<any>();
    return [...new Set<any>([String(user._id), ...users.map((u) => String(u._id))])];
  }
  if (reach === "team") {
    const team = await User.find({ teamLeader: user._id }).select("_id").lean<any>();
    return [String(user._id), ...team.map((u) => String(u._id))];
  }
  return [String(user._id)];
}

async function canSeeUser(user, otherId) {
  const ids = await visibleUserIds(user);
  return ids === null || ids.includes(String(otherId));
}

export = { visibleUserIds, canSeeUser, reachOf, ROLE_REACH };
