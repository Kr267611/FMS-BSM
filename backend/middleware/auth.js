const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { readToken, endSession } = require("../services/session");
const { can } = require("../services/permissions");

async function auth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ message: "Please sign in" });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    endSession(res);
    return res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
  const user = await User.findById(decoded.id).lean();
  if (!user || !user.active) {
    endSession(res);
    return res.status(401).json({ message: "This account is inactive" });
  }
  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
    endSession(res);
    return res.status(401).json({ message: "Your password was changed. Please sign in again." });
  }
  req.user = user;
  req.session = decoded;
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admins only" });
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

module.exports = { auth, adminOnly, permit };
