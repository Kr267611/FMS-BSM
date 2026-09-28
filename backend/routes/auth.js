const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const { mailer, fromAddress } = require("../services/mailer");
const { passwordProblem } = require("../services/passwords");
const { startSession, endSession, rateLimit } = require("../services/session");
const { Department } = require("../models/Org");
const { permissionsFor } = require("../services/permissions");
const { audit } = require("../services/audit");

const router = express.Router();

const MAX_FAILED = 5;
const LOCK_MIN = 15;
const RESET_TTL_MIN = 30;
const RESET_COOLDOWN_SEC = 60;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many sign-in attempts from this network. Please wait 15 minutes.",
});
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many password reset requests. Please wait 15 minutes.",
});

// What the app needs about the signed-in user, including effective permissions for the menu
async function publicUser(u) {
  const dept = u.department ? await Department.findById(u.department).select("name").lean() : null;
  return {
    _id: u._id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    department: dept?.name || "",
    permissions: permissionsFor(u),
  };
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const minutesLeft = (date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60000));

// Sign in with an email address or a username
router.post("/login", loginLimiter, async (req, res) => {
  const { username, password, remember } = req.body || {};
  const id = String(username || "").toLowerCase().trim();
  if (!id || !password) return res.status(400).json({ message: "Enter your email and password" });

  const user = await User.findOne({ $or: [{ email: id }, { username: id }] }).select("+password +failedLogins +lockUntil");
  if (user?.lockUntil && user.lockUntil > new Date()) {
    return res.status(423).json({
      message: `This account is locked after too many wrong passwords. Try again in ${minutesLeft(user.lockUntil)} minute(s), or reset your password.`,
    });
  }

  const ok = user && user.active && (await bcrypt.compare(String(password), user.password));
  if (!ok) {
    if (user) {
      user.failedLogins = (user.failedLogins || 0) + 1;
      if (user.failedLogins >= MAX_FAILED) {
        user.failedLogins = 0;
        user.lockUntil = new Date(Date.now() + LOCK_MIN * 60 * 1000);
        audit(req, "auth.locked", { entity: "User", entityId: user._id, summary: `${user.name} locked after ${MAX_FAILED} wrong passwords`, actor: user });
      }
      await user.save();
      audit(req, "auth.login_failed", { entity: "User", entityId: user._id, summary: user.name, actor: user });
    }
    return res.status(401).json({ message: "Incorrect email or password" });
  }

  user.failedLogins = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  user.lastLoginIp = req.ip;
  await user.save();
  startSession(res, user, Boolean(remember));
  audit(req, "auth.login", { entity: "User", entityId: user._id, summary: user.name, actor: user });
  res.json({ user: await publicUser(user) });
});

router.post("/logout", (req, res) => {
  endSession(res);
  res.json({ message: "Signed out" });
});

router.get("/me", auth, async (req, res) => res.json(await publicUser(req.user)));

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
  startSession(res, user, Boolean(req.session?.r)); // keep this device signed in
  audit(req, "auth.password_changed", { entity: "User", entityId: user._id, summary: user.name });
  res.json({ message: "Password updated. Other devices have been signed out." });
});

// Always answers the same way, so the form cannot be used to find out which emails exist
router.post("/forgot-password", resetLimiter, async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  if (!email) return res.status(400).json({ message: "Enter your email address" });
  const generic = { message: `If an account uses ${email}, a reset link has been sent. It is valid for ${RESET_TTL_MIN} minutes.` };

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

router.post("/reset-password", resetLimiter, async (req, res) => {
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
  user.failedLogins = 0;
  user.lockUntil = undefined; // a reset also unlocks the account
  await user.save();
  audit(req, "auth.password_reset", { entity: "User", entityId: user._id, summary: user.name, actor: user });
  res.json({ message: "Your password has been reset. You can now sign in." });
});

module.exports = router;
