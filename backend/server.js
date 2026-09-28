const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const connectDB = require("./config/db");
const User = require("./models/User");
const { startScheduler } = require("./services/scheduler");

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is missing in backend/.env. See .env.example.");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/processes", require("./routes/processes"));
app.use("/api/jobs", require("./routes/jobs"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/sheets", require("./routes/sheets"));
app.use("/api/mis", require("./routes/mis"));
app.use("/api/reminders", require("./routes/reminders"));
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
    console.error(`No admin exists and the username "${username}" belongs to a doer. Change ADMIN_USERNAME in .env.`);
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error("Set ADMIN_PASSWORD in backend/.env to create the first admin.");
    process.exit(1);
  }
  await User.create({ name: "Admin", username, password: await bcrypt.hash(password, 10), role: "admin" });
  console.log(`Created admin user "${username}" (password is in backend/.env)`);
}

async function start() {
  await connectDB();
  await ensureAdmin();
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
    console.error(err);
    process.exit(1);
  });
}

module.exports = { app, start };
