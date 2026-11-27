import jwt = require("jsonwebtoken");
import User = require("../models/User");
import orgLib = require("../models/Org");
const { Department } = orgLib;
import sessionLib = require("../services/session");
const { readToken, endSession } = sessionLib;
import permissionsLib = require("../services/permissions");
const { can, isAdmin } = permissionsLib;

async function auth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ message: "Please sign in" });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] }); // only the kind this server signs
  } catch {
    endSession(res);
    return res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
  const user = await User.findById(decoded.id).lean<any>();
  if (!user || !user.active) {
    endSession(res);
    return res.status(401).json({ message: "This account is inactive" });
  }
  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
    endSession(res);
    return res.status(401).json({ message: "Your password was changed. Please sign in again." });
  }
  // the department's access (Users & Org → Access) sits between the role's defaults and the user's own
  if (user.department) user.deptPermissions = (await Department.findById(user.department).select("permissions").lean<any>())?.permissions || undefined;
  req.user = user;
  req.session = decoded;
  next();
}

function adminOnly(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ message: "Admins only" });
  next();
}

// Page-level permission check, e.g. permit("users", "add")
function permit(module, action) {
  return (req, res, next) => {
    if (!can(req.user, module, action)) {
      return res.status(403).json({ message: "You don't have permission to do this. Ask your admin." });
    }
    next();
  };
}

// Any one of several page ticks, e.g. permitAny(["doerTasks", "edit"], ["fmsTasks", "edit"])
function permitAny(...pairs) {
  return (req, res, next) => {
    if (!pairs.some(([module, action]) => can(req.user, module, action))) {
      return res.status(403).json({ message: "You don't have permission to do this. Ask your admin." });
    }
    next();
  };
}

export = { auth, adminOnly, permit, permitAny };
