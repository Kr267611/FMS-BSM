const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { auth } = require("../middleware/auth");

const router = express.Router();

function publicUser(u) {
  return { _id: u._id, name: u.name, username: u.username, role: u.role, department: u.department };
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: "Username aur password daalein" });

  const user = await User.findOne({ username: String(username).toLowerCase().trim() }).select("+password");
  if (!user || !user.active || !(await bcrypt.compare(String(password), user.password))) {
    return res.status(401).json({ message: "Username ya password galat hai" });
  }
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: publicUser(user) });
});

router.get("/me", auth, (req, res) => res.json(publicUser(req.user)));

router.post("/change-password", auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ message: "Naya password kam se kam 6 akshar ka ho" });
  }
  const user = await User.findById(req.user._id).select("+password");
  if (!(await bcrypt.compare(String(oldPassword || ""), user.password))) {
    return res.status(400).json({ message: "Purana password galat hai" });
  }
  user.password = await bcrypt.hash(String(newPassword), 10);
  await user.save();
  res.json({ message: "Password badal gaya" });
});

module.exports = router;
