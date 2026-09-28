const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { auth, adminOnly } = require("../middleware/auth");
const { passwordProblem } = require("../services/passwords");

const router = express.Router();

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const cleanEmail = (s) => String(s || "").toLowerCase().trim();

async function emailProblem(email, exceptId) {
  if (!email) return null;
  if (!isEmail(email)) return "Enter a valid email address";
  if (await User.exists({ email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })) {
    return "Another user already has this email address";
  }
  return null;
}

// For dropdowns - every signed-in user needs the list of doers
router.get("/list", auth, async (req, res) => {
  const users = await User.find({ active: true }).select("name department role").sort({ name: 1 }).lean();
  res.json(users);
});

router.get("/", auth, adminOnly, async (req, res) => {
  res.json(await User.find().sort({ active: -1, name: 1 }).lean());
});

router.post("/", auth, adminOnly, async (req, res) => {
  const { name, username, password, role, department, phone } = req.body || {};
  const email = cleanEmail(req.body?.email);
  if (!name || !username || !password) {
    return res.status(400).json({ message: "Name, username and password are required" });
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) return res.status(400).json({ message: pwProblem });
  const emProblem = await emailProblem(email);
  if (emProblem) return res.status(400).json({ message: emProblem });
  if (await User.exists({ username: String(username).toLowerCase().trim() })) {
    return res.status(400).json({ message: "This username is already taken" });
  }
  const user = await User.create({
    name,
    username,
    password: await bcrypt.hash(String(password), 10),
    role: role === "admin" ? "admin" : "doer",
    department,
    email,
    phone,
  });
  const out = user.toObject();
  delete out.password;
  res.status(201).json(out);
});

router.put("/:id", auth, adminOnly, async (req, res) => {
  const { name, role, department, phone, active, password } = req.body || {};
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });

  const isSelf = String(user._id) === String(req.user._id);
  if (isSelf && (active === false || role === "doer")) {
    return res.status(400).json({ message: "You cannot deactivate yourself or remove your own admin role" });
  }

  if (req.body?.email !== undefined) {
    const email = cleanEmail(req.body.email);
    const emProblem = await emailProblem(email, user._id);
    if (emProblem) return res.status(400).json({ message: emProblem });
    user.email = email;
  }
  if (name !== undefined) user.name = name;
  if (role !== undefined) user.role = role === "admin" ? "admin" : "doer";
  if (department !== undefined) user.department = department;
  if (phone !== undefined) user.phone = phone;
  if (active !== undefined) {
    if (user.active && !active) user.tokenVersion = (user.tokenVersion || 0) + 1; // sign out a deactivated user
    user.active = Boolean(active);
  }
  if (password) {
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ message: pwProblem });
    user.password = await bcrypt.hash(String(password), 10);
    user.tokenVersion = (user.tokenVersion || 0) + 1; // admin reset signs the user out everywhere
  }
  await user.save();
  const out = user.toObject();
  delete out.password;
  res.json(out);
});

module.exports = router;
