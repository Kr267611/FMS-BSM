const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { auth, adminOnly } = require("../middleware/auth");

const router = express.Router();

// Dropdown ke liye - sab logged-in users ko doers ki list chahiye
router.get("/list", auth, async (req, res) => {
  const users = await User.find({ active: true }).select("name department role").sort({ name: 1 }).lean();
  res.json(users);
});

router.get("/", auth, adminOnly, async (req, res) => {
  res.json(await User.find().sort({ active: -1, name: 1 }).lean());
});

router.post("/", auth, adminOnly, async (req, res) => {
  const { name, username, password, role, department, email, phone } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ message: "Naam, username aur password zaroori hai" });
  }
  if (String(password).length < 6) return res.status(400).json({ message: "Password kam se kam 6 akshar ka ho" });
  if (await User.exists({ username: String(username).toLowerCase().trim() })) {
    return res.status(400).json({ message: "Ye username pehle se hai" });
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
  const { name, role, department, email, phone, active, password } = req.body || {};
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User nahi mila" });

  const isSelf = String(user._id) === String(req.user._id);
  if (isSelf && (active === false || role === "doer")) {
    return res.status(400).json({ message: "Aap khud ko band ya doer nahi bana sakte" });
  }

  if (name !== undefined) user.name = name;
  if (role !== undefined) user.role = role === "admin" ? "admin" : "doer";
  if (department !== undefined) user.department = department;
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;
  if (active !== undefined) user.active = Boolean(active);
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ message: "Password kam se kam 6 akshar ka ho" });
    user.password = await bcrypt.hash(String(password), 10);
  }
  await user.save();
  const out = user.toObject();
  delete out.password;
  res.json(out);
});

module.exports = router;
