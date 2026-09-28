const jwt = require("jsonwebtoken");
const User = require("../models/User");

// The token carries the user's tokenVersion; changing or resetting the password bumps it,
// which signs the user out on every other device.
function issueToken(user) {
  return jwt.sign({ id: user._id, tv: user.tokenVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Please sign in" });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
  const user = await User.findById(decoded.id).lean();
  if (!user || !user.active) return res.status(401).json({ message: "This account is inactive" });
  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
    return res.status(401).json({ message: "Your password was changed. Please sign in again." });
  }
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admins only" });
  next();
}

module.exports = { auth, adminOnly, issueToken };
