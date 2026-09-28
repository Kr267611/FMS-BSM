const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { auth, issueToken } = require("../middleware/auth");
const { mailer, fromAddress } = require("../services/mailer");
const { passwordProblem } = require("../services/passwords");

const router = express.Router();

const RESET_TTL_MIN = 30;
const RESET_COOLDOWN_SEC = 60;

function publicUser(u) {
  return { _id: u._id, name: u.name, username: u.username, email: u.email, role: u.role, department: u.department };
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// Sign in with an email address or a username
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const id = String(username || "").toLowerCase().trim();
  if (!id || !password) return res.status(400).json({ message: "Enter your email and password" });

  const user = await User.findOne({ $or: [{ email: id }, { username: id }] }).select("+password");
  if (!user || !user.active || !(await bcrypt.compare(String(password), user.password))) {
    return res.status(401).json({ message: "Incorrect email or password" });
  }
  res.json({ token: issueToken(user), user: publicUser(user) });
});

router.get("/me", auth, (req, res) => res.json(publicUser(req.user)));

router.post("/change-password", auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ message: problem });

  const user = await User.findById(req.user._id).select("+password");
  if (!(await bcrypt.compare(String(oldPassword || ""), user.password))) {
    return res.status(400).json({ message: "The current password is incorrect" });
  }
  user.password = await bcrypt.hash(String(newPassword), 10);
  user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out other devices
  await user.save();
  res.json({ message: "Password updated. Other devices have been signed out.", token: issueToken(user) });
});

// Always answers the same way, so the form cannot be used to find out which emails exist
router.post("/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  const generic = { message: `If an account uses ${email || "that email"}, a reset link has been sent. It is valid for ${RESET_TTL_MIN} minutes.` };
  if (!email) return res.status(400).json({ message: "Enter your email address" });

  const transport = mailer();
  const appUrl = String(process.env.APP_URL || "").replace(/\/+$/, "");
  if (!transport || !appUrl) {
    console.error("Password reset is not configured: set SMTP_* and APP_URL.");
    return res.status(503).json({ message: "Password reset by email is not set up yet. Please ask your admin to reset your password." });
  }

  const user = await User.findOne({ email, active: true }).select("+resetRequestedAt");
  if (!user) return res.json(generic);
  if (user.resetRequestedAt && Date.now() - user.resetRequestedAt.getTime() < RESET_COOLDOWN_SEC * 1000) {
    return res.json(generic); // a link was just sent; don't flood the inbox
  }

  const token = crypto.randomBytes(32).toString("hex");
  user.resetTokenHash = hashToken(token);
  user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000);
  user.resetRequestedAt = new Date();
  await user.save();

  const link = `${appUrl}/reset-password?token=${token}`;
  try {
    await transport.sendMail({
      from: fromAddress(),
      to: user.email,
      subject: "Reset your FMS BSM password",
      text:
        `Hello ${user.name},\n\n` +
        `We received a request to reset the password for your FMS BSM account.\n\n` +
        `Reset your password: ${link}\n\n` +
        `This link is valid for ${RESET_TTL_MIN} minutes and can be used once. ` +
        `If you did not ask for this, you can ignore this email; your password will not change.\n\n- FMS BSM`,
    });
  } catch (err) {
    console.error("Password reset email failed:", err.message);
  }
  res.json(generic);
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !/^[a-f0-9]{64}$/.test(String(token))) {
    return res.status(400).json({ message: "This reset link is invalid. Request a new one." });
  }
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ message: problem });

  const user = await User.findOne({
    resetTokenHash: hashToken(String(token)),
    resetTokenExpires: { $gt: new Date() },
    active: true,
  });
  if (!user) return res.status(400).json({ message: "This reset link has expired or was already used. Request a new one." });

  user.password = await bcrypt.hash(String(password), 10);
  user.tokenVersion = (user.tokenVersion || 0) + 1; // sign out everywhere
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();
  res.json({ message: "Your password has been reset. You can now sign in." });
});

module.exports = router;
