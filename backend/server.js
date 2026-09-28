const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const connectDB = require("./config/db");
const User = require("./models/User");
const { startScheduler } = require("./services/scheduler");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Connect once per process. On Vercel each cold start runs this on its first request;
// locally start() has already done it before listening.
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set. See backend/.env.example.");
      await connectDB();
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
app.use("/api/sheets", require("./routes/sheets"));
app.use("/api/mis", require("./routes/mis"));
app.use("/api/reminders", require("./routes/reminders"));
app.use("/api/cron", require("./routes/cron"));
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

// First run: if there is no admin, create one from ADMIN_USERNAME / ADMIN_PASSWORD in .env
async function ensureAdmin() {
  if (await User.exists({ role: "admin" })) return;
  const username = process.env.ADMIN_USERNAME || "admin";
  if (await User.exists({ username })) {
    throw new Error(`No admin exists and the username "${username}" belongs to a doer. Change ADMIN_USERNAME.`);
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("Set ADMIN_PASSWORD to create the first admin.");
  }
  await User.create({ name: "Admin", username, password: await bcrypt.hash(password, 10), role: "admin" });
  console.log(`Created admin user "${username}" (password is in backend/.env)`);
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
