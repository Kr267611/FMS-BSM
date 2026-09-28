const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Login karein" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).lean();
    if (!user || !user.active) return res.status(401).json({ message: "User active nahi hai" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Session khatam ho gaya, dobara login karein" });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Sirf admin ke liye" });
  next();
}

module.exports = { auth, adminOnly };
