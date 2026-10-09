const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const bcrypt = require("bcryptjs");
const connectDB = require("./config/db");
const User = require("./models/User");
const { startScheduler } = require("./services/scheduler");
const { runMigrations } = require("./services/migrations");

const app = express();
// Behind Vercel's rewrite and Render's proxy: take the client IP from X-Forwarded-For (used by rate limits)
app.set("trust proxy", true);
app.disable("x-powered-by");
// No CORS: the browser only talks to the app's own URL (Vercel forwards /api here),
// so other sites cannot call the API with a user's session cookie.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
// Photos (/api/files) have their own, larger body limit
const jsonBody = express.json({ limit: "1mb" });
app.use((req, res, next) => (req.path.startsWith("/api/files") ? next() : jsonBody(req, res, next)));

// Connect once per process. On Vercel each cold start runs this on its first request;
// locally start() has already done it before listening.
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set. See backend/.env.example.");
      await connectDB();
      await runMigrations();
      await ensureAdmin();
    })().catch((err) => {
      readyPromise = null; // retry on the next request
      throw err;
    });
  }
  return readyPromise;
}
app.use(async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (err) {
    console.error("Startup failed:", err.message);
    res.status(500).json({ message: "Server is not configured correctly. Check the server logs." });
  }
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/processes", require("./routes/processes"));
app.use("/api/jobs", require("./routes/jobs"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/fms-rules", require("./routes/fmsRules"));
app.use("/api/audits", require("./routes/audits"));
app.use("/api/checklists", require("./routes/checklists"));
app.use("/api/delegations", require("./routes/delegations"));
app.use("/api/sheets", require("./routes/sheets"));
app.use("/api/mis", require("./routes/mis"));
app.use("/api/reminders", require("./routes/reminders"));
app.use("/api/cron", require("./routes/cron"));
app.use("/api/org", require("./routes/org"));
app.use("/api/audit", require("./routes/audit"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/files", require("./routes/files"));
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api", (req, res) => res.status(404).json({ message: "API route not found" }));

// In production this server also serves the React build (single deploy)
const dist = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.name === "CastError") return res.status(400).json({ message: "Invalid ID" });
  if (err.name === "ValidationError") return res.status(400).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

// First run: if there is no admin, create one from ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL.
// If the admin already exists without an email, ADMIN_EMAIL is attached so they can sign in with it.
async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const email = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();

  if (await User.exists({ role: "admin" })) {
    if (email && !(await User.exists({ email }))) {
      const r = await User.updateOne({ username, role: "admin", email: "" }, { email });
      if (r.modifiedCount) console.log(`Admin "${username}" can now sign in with ${email}`);
    }
    await resetAdminPasswordFromEnv(username, email);
    return;
  }
  if (await User.exists({ username })) {
    throw new Error(`No admin exists and the username "${username}" belongs to a doer. Change ADMIN_USERNAME.`);
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("Set ADMIN_PASSWORD to create the first admin.");
  }
  await User.create({ name: "Admin", username, email, password: await bcrypt.hash(password, 10), role: "admin" });
  console.log(`Created admin user "${username}"${email ? ` (${email})` : ""}`);
}

// Recovery for a lost admin password on hosts without a shell (e.g. Render free plan):
// set ADMIN_RESET_PASSWORD, redeploy, sign in, then delete the variable.
async function resetAdminPasswordFromEnv(username, email) {
  const newPassword = process.env.ADMIN_RESET_PASSWORD;
  if (!newPassword) return;
  const who = [{ username }, ...(email ? [{ email }] : [])];
  const admin =
    (await User.findOne({ role: "admin", $or: who }).select("+password")) ||
    (await User.findOne({ role: "admin" }).sort({ createdAt: 1 }).select("+password"));
  if (!admin) return;
  // Only when it differs, so a forgotten variable doesn't sign everyone out on every restart
  if (await bcrypt.compare(newPassword, admin.password)) return;
  admin.password = await bcrypt.hash(newPassword, 10);
  admin.tokenVersion = (admin.tokenVersion || 0) + 1;
  await admin.save();
  console.warn(`Password for admin "${admin.username}" was reset from ADMIN_RESET_PASSWORD. Delete that variable now.`);
}

// Long-running server (local / Render). On Vercel this file is imported instead,
// the app is served as a function and Vercel Cron replaces the scheduler.
async function start() {
  await ready();
  const port = Number(process.env.PORT) || 5050;
  const server = app.listen(port, () => console.log(`FMS BSM server: http://localhost:${port}`));
  if (process.env.DISABLE_SCHEDULER !== "1") startScheduler();

  // Close the database cleanly on shutdown so local dev data is saved
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await connectDB.closeDB().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  start().catch((err) => {
    // One readable line first; hosting logs interleave the long stack/topology dump
    const reason = err?.reason?.error?.message || err?.cause?.message || "";
    console.error(`STARTUP FAILED: ${err?.name || "Error"}: ${err?.message}${reason ? ` (${reason})` : ""}`);
    if (/IP|whitelist|access list|ServerSelection/i.test(`${err?.name} ${err?.message}`)) {
      console.error("Hint: in MongoDB Atlas, add 0.0.0.0/0 under Network Access (IP Access List).");
    } else if (/auth/i.test(String(err?.message))) {
      console.error("Hint: the username or password in MONGO_URI is wrong.");
    }
    setTimeout(() => process.exit(1), 500); // let the log lines flush
  });
}

module.exports = app;
module.exports.start = start;
module.exports.ensureAdmin = ensureAdmin;
