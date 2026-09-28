const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Please sign in" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).lean();
    if (!user || !user.active) return res.status(401).json({ message: "This account is inactive" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admins only" });
  next();
}

module.exports = { auth, adminOnly };
